# Architecture

One MCP contract, more than one canvas. This document describes the layers and, more importantly,
where the seams are — because the seams are what a new host adapter plugs into.

## Layers

```
   agent (any MCP client)
        │  stdio  │  HTTP + SSE (default 127.0.0.1:15490)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ mcp-server                                                   │
│                                                              │
│  tool registry ── profiles (gen / design / tokens / ops / …) │
│        │                                                     │
│  tool handlers ── output budget (structure-preserving cut)    │
│        │                                                     │
│  render pipeline   preprocess → browser render → DSL          │
│        │                                                     │
│  bridge router ── session ⇄ backend partition (fail-closed)   │
└──────────────────────────────────────────────────────────────┘
        │  WebSocket hub (default 127.0.0.1:15489, one port)
        ▼
   plugin-mastergo / plugin-penpot          ← host adapters
        │  mg.*             /  penpot.*
        ▼
   canvas (MasterGo / Penpot)
```

## Transports

- **stdio** for a client that spawns the server as a subprocess.
- **HTTP + SSE** for a long-lived server: `GET /sse` then `POST /messages` (full MCP), `POST /mcp`
  (trimmed endpoint, `tools/call` only), `GET /health` for probes.

The recommended mode is HTTP/SSE: a plugin's connection survives server restarts and agent turns,
whereas a stdio server is tied to one client process.

## One hub, partitioned by session

Both hosts connect to the **same** WebSocket port. A client declares its backend during
`initialize`, and the router keeps sessions apart by that declaration:

- an unclaimed client is **not** adopted (`fail-closed`), and a client declaring a different backend
  is rejected — so "connected but tools landed somewhere else" is designed out rather than debugged;
- `session_list` reports each session's `backend`, `codename`, document and page;
- `session_switch` moves subsequent calls to another session, or a single call can target one with
  `_sessionId`.

The connection itself is **user-initiated**: the plugin panel has a Connect button, and the server
never auto-attaches to a canvas. When you decide an agent may write to your document is your call,
so an empty `session_list` means "ask the user to click Connect", not "retry".

## Tool surface and profiles

Every tool definition is paid for on **every** request, so the surface is disclosed progressively.
Measured from the current registry (characters are the serialized schema):

| profile | tools | chars |
|---|---|---|
| `gen` *(default)* | 20 | 11 593 |
| `core` | 17 | 10 807 |
| `design` | 46 | 29 602 |
| `tokens` | 21 | 13 546 |
| `ops` | 18 | 6 093 |
| `agent` | 3 | 1 144 |
| `full` | 67 | 36 837 |

`gen` is ~68% smaller than `full`. A client that needs more calls the `mcp_tools` tool
(`enable` with a profile name or a tool name); the server then sends a tool-list-changed
notification. Tool selection in profiles is a product decision, not an accident: `full` includes
tools whose descriptions are expensive and rarely needed.

## Output budget

Input cost is only half the bill — tool **results** are re-sent on every subsequent turn, and a
single `dsl_export_node` or `*_list` over a large document can return tens of kilobytes. Naive
truncation (`slice()`) is worse than the problem: the model then reads invalid JSON and may treat a
partial design as the whole thing.

The server instead truncates **by shape** — arrays by item, long strings by tail, structure and key
names preserved, always valid JSON — and records what was lost (`_truncated`, `_budget.hint`). The
implementation is standalone and independently published: see
[`packages/response-budget/README.md`](../packages/response-budget/README.md).

## Design → canvas

```
HTML + Tailwind (authored by the agent)
   → server preprocessing        icons (Iconify), charts (ECharts SSR), components
   → browser render (client)     real layout engine, getBoundingClientRect
   → DSL                         positions and styles now measured, not guessed
   → host adapter                native, editable layers
```

The browser render step is the interesting one. Layout engines disagree, and an agent-authored
Tailwind page is full of flex and intrinsic sizing that cannot be resolved by reading the markup.
Rendering it for real and measuring the result means the canvas gets final numbers rather than the
engine's guess. It also means the client (a plugin iframe) does part of the work, which is why the
pipeline has a server half and a client half.

## Canvas → code

```
canvas selection
   → DSL export        semantic layer names, structure, styles
   → HTML + Tailwind   and/or design tokens (CSS variables / DTCG) / SVG assets
```

Exports carry the same principle as the rest of the system: what cannot be represented is reported
in the response (`skipped`, `available: false`) rather than dropped.

## The adapter seam

A host adapter's job is to translate DSL operations into host API calls, and to report what the host
cannot do. Concretely, it must:

1. answer a **capability probe** (`plugin_capabilities`) truthfully at runtime — declarations are not
   evidence, because a private/enterprise build can lag the public typings;
2. implement the DSL operation set, including text/style/layout, or return
   `available: false` with a reason and an alternative;
3. report degradations structurally, so the server can pass them on instead of pretending success;
4. keep host-specific concepts out of the shared layer.

`plugin-penpot` is the reference second implementation. See
[`docs/adapter-spec.md`](adapter-spec.md) for the interface and a step-by-step for adding a canvas,
and [`docs/host-differences.md`](host-differences.md) for what "different host, different limits"
looks like in practice.

## Why the cost model is unusually visible

Penpot's plugin API is a **synchronous** proxy between the plugin iframe and the host: reads and
writes block until the host answers, so concurrency cannot overlap them. Measured on a 43-node page:
browser render ≈ 28 ms, host application ≈ 5 737 ms across ≈ 585 host calls — about **10 ms per
call**.

The practical consequence: the way to make rendering faster is to make **fewer host calls**, not more
parallel ones. Both the Penpot adapter and the engine pipelines are written with that in mind, and a
test pins the host-call count for a representative render so a regression fails in CI rather than on
someone's machine.

## Where to look

| Concern | Path |
|---|---|
| Entry point, CLI flags, transports | `mcp-server/src/index.ts` |
| HTTP/SSE endpoints | `mcp-server/src/server/http-server.ts` |
| Session ⇄ backend routing | `mcp-server/src/server/bridge-router.ts` |
| Plugin WebSocket hub | `mcp-server/src/server/ws-bridge.ts` |
| Tool definitions | `mcp-server/src/utils/tools/` |
| Tool dispatch, output budget wiring | `mcp-server/src/utils/tool-handlers.ts` |
| Profile definitions | `mcp-server/src/utils/tool-profiles.ts` |
| HTML preprocessing | `mcp-server/src/utils/html-preprocessor.ts` |
| Output truncation (standalone pkg) | `packages/response-budget/` |
| Host adapter: MasterGo | `plugin-mastergo/lib/` |
| Host adapter: Penpot | `plugin-penpot/lib/` (host coupling in `lib/host/`) |
| Agent-facing design rules | `skills/design/` |
