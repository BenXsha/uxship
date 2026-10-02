# Benchmarks

The project's claims about context cost are meant to be checkable, not taken on faith. This page
records what was measured, how to reproduce it, and — importantly — what has **not** been measured.

Raw data: [`benchmarks-raw.json`](benchmarks-raw.json).

## Reproduce

```bash
npm run build:server                              # the script measures dist, not source
node scripts/benchmark-context.mjs                 # human-readable
node scripts/benchmark-context.mjs --json          # machine-readable
node scripts/benchmark-context.mjs --out docs/benchmarks-raw.json
```

The script touches no canvas and needs no host, so anyone can reproduce these numbers exactly.

## 1. Tool surface

Every tool definition is re-sent on every request, so the size of the exposed surface is a recurring
cost. Measured in serialized JSON characters:

| Profile | Tools | Chars | vs `full` |
|---|---|---|---|
| `gen` *(default)* | 20 | 11 580 | **−68.5%** |
| `core` | 17 | 10 799 | −70.7% |
| `design` | 46 | 29 567 | −19.7% |
| `tokens` | 21 | 13 528 | −63.3% |
| `ops` | 18 | 6 105 | −83.4% |
| `agent` | 3 | 1 144 | −96.9% |
| `full` | 67 | 36 814 | — |

Reading this honestly:

- The saving is real and mechanical: it is the same tool definitions, minus the ones the profile
  excludes. Nothing is summarised or rewritten.
- **It is not free.** A tool left out of the default profile is invisible to the model until it is
  enabled, so a task needing an unlisted tool pays one extra round trip. The default is chosen for
  the common design-generation path, not for every workflow.
- Characters are not tokens. Treat the ratios as the signal; expect the token ratio to differ
  somewhat by tokeniser.

## 2. Output-side truncation

Input is only half the bill — results are re-sent on every later turn. Measured with a synthetic
500-node `search_nodes` payload at the default 24 000-char budget:

| | Value |
|---|---|
| Before | 31 913 chars |
| After | 3 441 chars |
| Saved | **89.2%** |
| Items kept | 50 / 500 |
| Still valid JSON | yes (`JSON.parse` round-trips) |

Note the result sits **well under** the budget. The budget is a ceiling, not a fill target:
truncation walks a fixed ladder (arrays 50 → 25 → 12 → 6 → 3 → 1; strings 4 000 → 2 000 → 1 000 →
400 → 200 chars) and stops at the first rung that fits.

That trade is deliberate — predictable, much smaller output — but it does mean data that *would*
have fitted is withheld. Raising `maxChars` re-applies the same ladder at the higher ceiling.

## 3. Render fidelity — a first real data point

Measured on **one page, one host** (Penpot, 2026-10-02): the page in [`../examples/`](../examples/)
rendered through the engine, written to a canvas, then read back and compared node by node.

| | Result |
|---|---|
| Explicitly sized nodes matching exactly | **10 / 10** |
| Degradations (`skipped`) | 0 |
| Unresolved Tailwind classes | 0 |
| Engine client render | 40 ms |
| Host application | 7 319 ms |
| Hug-width container | **differs**: engine 131 px, canvas 143 px |

The rule this suggests, and the thing to check first when a canvas “looks off”:

> **Fixed sizes survive the trip; hug sizes depend on the host's text measurement.**

A node with a declared width came back byte-identical. A node whose width follows its text
(`Brand`, a label-sized frame) came back 12 px wider, because the host measured the same string
differently than the browser did. That is not a bug in either side — it is the boundary of what
measuring in a browser can promise.

The run also produced a structured `layoutWarnings` entry for a text box that was 1 px too tight
(single-line natural width 308 in a 307 box), with a concrete suggestion to leave ≥8 px of slack.
Worth knowing: too-tight text is reported, not silently clipped.

### Still not measured here

- **Pixels.** This compares node geometry, not rendered images. A visual diff would also catch
  stroke/fill/effect differences.
- **More than one page, or more than one host.** One clean page proves the mechanism, not a
  distribution; a page of dense nested flex would be a more interesting sample.
- **Cross-host divergence.** Same DSL on MasterGo and Penpot, diffed field by field.

## 4. What has **not** been measured

Stated explicitly, because a benchmark page that only shows favourable numbers is marketing:

| Not measured | Why | What would be needed |
|---|---|---|
| **Render fidelity** (pixel diff, canvas vs browser) | Partially measured now — see below — but only one page, one host, and sizes rather than pixels | A scripted pixel-diff suite across a sample of pages, per host |
| **Cross-host production diff** | Same reason — requires both hosts open on the same document | Run the same DSL on both hosts, diff the resulting node trees field by field |
| **Tool-selection accuracy** | Would need a task corpus and a scoring rubric; the risk is that it measures the corpus, not the tool | A labelled set of design tasks with expected tool sequences |
| **End-to-end latency** | Host-call bound and environment-dependent | See below — call counts are the honest proxy |
| **Token counts** | Tokeniser-specific | Measure with a specific model's tokeniser and say which |

### On latency

The measurement worth knowing is **host call count**, not wall-clock time. On Penpot the plugin API
is a synchronous proxy (roughly 10 ms per call, measured), so rendering time is dominated by how many
host calls a render makes. A regression test pins that count for a representative render.

The demo run bears this out: a 50-layer page spent **40 ms** in the client render and **7 319 ms**
applying to the canvas — about 0.5% of the time is layout, the rest is host writes.

Do **not** compare render time before/after a change on a live canvas: the same render measured
6 623 ms and 6 630 ms on an unchanged document, then 5.7 s → 6.6 s as the file grew while making
*fewer* calls. Compare call counts (arithmetic) or the client-side segment, which does not depend on
document size. Details in [`host-differences.md`](host-differences.md).

## Method notes

- Tool-surface characters are `JSON.stringify(toolList).length` with escaping, i.e. the actual
  payload, not a sum of field lengths.
- Profiles are read from the compiled `dist`, so the numbers describe what a client receives.
- The truncation figure uses the library's default budget and a synthetic payload with a
  representative shape (many similar objects); different shapes shift the ratio. The *guarantees*
  (valid JSON, structure preserved, loss reported) are invariant and covered by tests; the *ratio* is
  not.
