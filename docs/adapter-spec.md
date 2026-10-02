# Host adapter specification

How to put uxship on a canvas it has never seen. A new host is an **adapter**, not a fork: the shared
layer speaks DSL, and everything host-specific lives behind one port.

Read [`architecture.md`](architecture.md) first for where this sits, and
[`host-differences.md`](host-differences.md) for what "different host, different limits" looks like in
practice.

## The contract

The design is hexagonal. The server and the render pipeline are the core; the canvas is driven
through a **port** that each host implements.

```text
        core (DSL as intermediate representation)
                    │
            HostAdapter port
        ┌───────────┼───────────┐
   mastergo      penpot      memory      ← implementations
   adapter       adapter     adapter
                                 └ in-memory, for tests and the render harness
```

`memory` is the proof that the port is real: a third implementation that drives no canvas at all is
what the conformance tests and the harness run against.

### Three rules the port encodes

1. **DSL is the IR; host naming lives only in implementations.** Property bundles use the project's
   DSL field names (`layoutMode`, `itemSpacing`, `primaryAxisAlignItems`, …). Translating those into
   a host's vocabulary (`flex.dir`, `rowGap`, `justifyContent`, …) is the adapter's job and nobody
   else's. Handlers must never reach past the port into host objects.
2. **Unsupported capability → explicit report, never a silent drop.** `applyProperties` returns
   `{ applied: string[], skipped: PropertySkip[] }`, so every property that did not stick arrives
   back with a reason. Silent property loss is the worst possible outcome: the agent concludes the
   design is complete.
3. **Mutations are uniformly `async`.** Hosts disagree — Penpot is mostly synchronous, MasterGo has
   genuinely async operations — so the port is async everywhere. Uniformity is worth more than
   matching each host's shape, and it keeps signatures stable.

### Node handles are structural

`HostNode` is `{ id, type, name? }`. Host-native shape objects satisfy it without a wrapper. Handlers
must operate on `HostNode` only; touching host-private fields is a portability leak, and the
`host-isolation` test exists to catch exactly that in the Penpot adapter.

## The port surface

54 members, grouped by concern. All of them are required unless noted; capabilities that are absent
at runtime are declared through `getCapabilities()` and reported as unavailable rather than failing
late.

| Concern | Members |
|---|---|
| Capabilities | `getCapabilities`, `init` |
| Nodes | `createNode`, `getNodeById`, `removeNode`, `cloneNode`, `appendChild`, `setParentIndex`, `group` |
| Properties | `applyProperties`, `readProperties` |
| Fonts | `loadFonts`, `listFonts` |
| Export | `exportNode`, `booleanOperation` |
| Components | `createComponent`, `detachInstance`, `listComponents`, `instantiateComponent`, `switchVariant`, `createVariants` |
| Tokens | `listTokenSets`, `createToken`, `updateToken`, `renameToken`, `deleteToken`, `applyToken`, `readNodeTokens`, `setTokenSetActive`, `propagateToken` |
| Styles | `listColorStyles`, `listTextStyles`, `createColorStyle`, `createTextStyle`, `updateColorStyle`, `updateTextStyle`, `applyStyle` |
| Rich text | `applyTextRuns`, `readTextRuns` |
| Codegen | `generateCss` |
| Document | `getDocumentInfo`, `getDocumentCodename`, `setDocumentCodename`, `listPages`, `getCurrentPage`, `getPageRootNodes`, `switchPage`, `createPage`, `renamePage` |
| Selection & view | `getSelection`, `setSelection`, `zoomToNodes` |
| UX | `notify`, `waitForLayoutUpdate` |

## Capabilities are probed, not declared

```ts
interface HostCapabilities {
  host: HostId
  nodeKinds: NodeKind[]                     // what this host can create
  props: {
    fills, perSideStrokes, gradients, imageFills, imageFromUrl,
    effects, backgroundBlur, autoLayout, gridLayout, textAutoResize,
    /* …token binding, variants, … */
  }
}
```

Two rules:

- **Probe at runtime.** Typings describe what the vendor shipped, not what the copy in front of you
  supports. Enterprise builds lag. A capability that cannot be verified must be reported as absent,
  not assumed present.
- **Report the gap at use time, not the call site's convenience.** If `perSideStrokes` is false and
  the DSL asks for one, the adapter emulates or reports; it does not quietly draw a full border.

## Degradation semantics

A degradation is a structured fact, not a warning in a log:

| Field | Meaning |
|---|---|
| `applied` / `skipped` (`applyProperties`) | per-property outcome with a reason |
| `skipped[]` on a render | host-side operations that did not stick |
| `available: false` + reason + alternative | a tool or capability that cannot run here |
| `unresolvedClasses` | authored Tailwind classes that matched nothing |
| `hostType` alongside `type` | the host's own vocabulary when it differs from the DSL's |
| `native: true` | this host had a native path (e.g. component swap), rather than our fallback |

Consumers should treat "degradation present" as information, and "degradation missing" as the claim
that everything applied. That only holds if adapters never swallow.

## Adding a host

1. **Implement the port.** Start from `plugin-penpot/lib/host/` — in particular `types.ts` (the port
   and its types) and `memory.ts` (a complete implementation that drives no canvas; the cheapest
   reference to read first).
2. **Keep host coupling in one directory.** `plugin-penpot/lib/host/` holds everything that touches
   `penpot.*`. Handlers and the DSL renderer stay host-neutral. A `host-isolation` test asserts that
   host globals do not leak outside that directory.
3. **Declare capabilities honestly.** Where the host cannot do something, return
   `available: false` with a reason and, when there is one, an alternative — mirroring how
   `component_render` lists the subset it supports.
4. **Run the conformance cases.** The shared cases run against a fake host, so a new adapter is
   testable without the real tool open. `plugin-penpot/tests/helpers/` shows the pattern for
   standing up a minimal fake.
5. **Pin the cost.** If host calls are synchronous (as in Penpot), add a test that pins the call
   count for a representative render. It is the only regression signal that survives a live canvas.
6. **Document the differences.** Add a section to [`host-differences.md`](host-differences.md) —
   including the degradations that are *normal* on that host, so they are not reported as bugs.

## Non-goals

- **Adapters are not sandboxes for core logic.** If a behaviour is needed by every host, it belongs
  in the core, above the port.
- **Adapters do not own the tool surface.** Tool names, descriptions and profiles are core. An
  adapter contributes behaviour, not API.
- **No emulation that changes meaning.** Emulating a per-side stroke by drawing overlapping
  rectangles is acceptable *if* the trade-off is documented and reported. Silently converting a
  design feature into something visually similar but semantically different is not.
