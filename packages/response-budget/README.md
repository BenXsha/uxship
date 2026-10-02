# mcp-response-budget

**Cut tool results by *shape*, never mid-JSON.**

MCP tool results are paid context: every byte a tool returns is re-sent to the model on every
subsequent turn. A single `dsl_export_node` on a large page, or a `*_list` over a big document,
easily returns tens of kilobytes — and the naive fix (`text.slice(0, 24_000)`) is worse than the
problem, because the model then reads **broken JSON** and may silently treat a truncated design as
a complete one.

This package truncates while keeping the payload parseable, the structure intact, and the loss
explained.

```bash
npm install mcp-response-budget
```

Zero runtime dependencies. ESM + CJS + types.

## Usage

```ts
import { applyResponseBudget } from 'mcp-response-budget'

const { payload, budget } = applyResponseBudget('search_nodes', pluginResult, { maxChars: 24_000 })

if (budget?.truncated) {
  // payload: still valid JSON, structure preserved, with _truncated notes + a budget.hint
  // budget: { maxChars, actualChars, truncated, notes, hint }
}
```

### Before / after

A 500-node search result, default budget (24 000 chars). These numbers are measured, not
illustrative — reproduce them with `node scripts/benchmark-context.mjs` in the uxship repo:

```jsonc
// before — 31 913 chars
{ "total": 500, "nodes": [ { "id": "n0", "name": "xxxx…" }, /* …500 items… */ ] }

// after — 3 441 chars, still valid JSON
{
  "total": 500,
  "nodes": [ { "id": "n0", "name": "xxxx…" }, /* …50 items… */ ],
  "_truncated": { "field": "nodes", "shown": 50, "total": 500 },
  "_budget": {
    "maxChars": 24000,
    "actualChars": 3441,
    "truncated": true,
    "notes": [ { "field": "nodes", "shown": 50, "total": 500 } ],
    "hint": "输出已被截断（原 31913 字符 > 上限 24000）：收窄搜索条件（name / types / colors）或调小 limit；需要整体概览时改用 design_describe 拿摘要"
  }
}
```

Note the result is **far below** the 24 000-char budget: the budget is a **ceiling, not a fill
target**. Truncation walks a fixed ladder — arrays to 50 / 25 / 12 / 6 / 3 / 1 items, strings to
4 000 / 2 000 / 1 000 / 400 / 200 chars — and stops at the first rung that fits. It does not try to
use the budget up.

That is a deliberate trade: output size becomes predictable and much smaller, at the cost of
withholding data that might have fitted. If you would rather approach the ceiling, raise `maxChars`
and the same ladder applies at the new ceiling.

## The three guarantees

1. **Always valid JSON.** Never a half-cut string. The result you return can be `JSON.parse`d.
2. **Structure preserved.** Arrays are cut by item, long strings by tail; key names and nesting
   depth survive. Scalars pass through untouched. The input is never mutated.
3. **Loss is explained.** `_truncated` records `field` / `shown` / `total` at the nearest enclosing
   object, and `_budget.hint` says what to narrow. Silent truncation is the worst outcome — the
   model would mistake a partial design for the whole thing.

When arrays and long strings can't bring the payload under budget (e.g. thousands of small fields),
it falls back to an envelope: `{ preview, _truncated }`, with a floor on how much of the budget the
preview gets. The output length never exceeds `maxChars`.

## API

| Export | Purpose |
|---|---|
| `applyResponseBudget(toolName, payload, opts?)` | Returns `{ payload, budget? }`. `opts.maxChars` defaults to `DEFAULT_MAX_CHARS`; `0` or negative means **no limit** (returns the payload untouched, no `budget`). |
| `hintFor(toolName, originalChars, maxChars)` | The tool-aware narrowing advice used in `budget.hint`. Unknown tools get a generic, still-actionable hint. |
| `DEFAULT_MAX_CHARS` | `24_000` (≈6–8k tokens). |
| `HEAVY_OUTPUT_TOOLS` | The allow-list of tool names this is meant to be applied to. Tools with their own byte limits or on-disk handoff are deliberately excluded. |
| `BudgetInfo`, `TruncationNote` | Types. |

Applying the budget is the caller's decision: this package never inspects a transport, and only
tools in `HEAVY_OUTPUT_TOOLS` are expected to be wrapped.

## Notes for contributors to this repo

`src/index.ts` here is the **single source**. Because `mcp-server`'s `tsc` runs with
`rootDir: ./src`, it cannot import this package directly, so
`mcp-server/src/utils/response-budget.ts` is a **byte-identical copy** kept in step by:

```bash
npm run sync:response-budget     # write the copy
npm run check:response-budget    # verify (runs in CI)
```

Edit `src/index.ts`, never the copy.

## License

Apache-2.0
