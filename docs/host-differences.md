# Host differences

One contract, two canvases. This is the single list of where MasterGo and Penpot actually differ, so
you can tell a host limitation from a bug.

Everything here was measured against real hosts. Where the vendor's own types were the deciding
evidence, that is stated — because member names lie (see [Component flags](#component-flags-read-the-description-not-the-name)).

## First: which host am I on?

| Check | What it tells you |
|---|---|
| `session_list` | Each session carries `backend` (`mastergo` / `penpot`), a codename, and the document/page it points at |
| `plugin_capabilities` | The `host`, plus per-capability flags. These are **probed at runtime**, not declared |
| Routing | `session_switch` for the rest of the session, or `_sessionId` for one call |

Backend attribution is **fail-closed**: a client that does not declare itself is not adopted, and one
declaring the other backend is rejected. If tools seem to land in the wrong document, read `backend`
before retrying.

## Identical across hosts

Do not write two versions of these:

- DSL and HTML+Tailwind authoring (the same dialect drives both);
- the `code_to_design` pipeline (HTML → measured browser render → DSL → canvas);
- `position` semantics: coordinates are **relative to the parent**, and the renderer converts. Inside
  a flex parent, layout decides position — do not compute it;
- Tailwind preflight is handled by the engine: do not write `box-sizing`, and do not rely on Tailwind
  global styles;
- `data-icon` (Iconify SVG → native editable paths);
- text wrapping conventions (`<p>` inside a `section`; keep sibling element types consistent in a row).

## Penpot hard constraints

### Fonts: a family that does not exist silently falls back

Penpot's font list is a Google Fonts mirror (~1 911 families). Common names — Inter, PingFang,
Microsoft YaHei, Source Han Sans — are **not** in it, and neither is an omitted family: everything
falls back to the host default. Measured on a single login page, an unqualified render produced
**20 "font not applied" warnings**.

Chinese text works with **`Noto Sans TC`**, which is in the list.

The engine therefore only emits a font name when the CSS names a concrete family. Specify one
explicitly, e.g. on the root node: `style="font-family:'Noto Sans TC'"`.

### Single-side strokes are simulated, and corners overlap

Penpot's plugin API has no per-side stroke fields (`stroke-width-top` and friends exist only in
Penpot's internal model — the plugin parser accepts an 11-key whitelist). The adapter merges
same-colour, same-width edges into one multi-subpath path drawn on top.

**Known cost:** when two adjacent edges differ in colour or width, the corner overlaps into a `w × w`
square (CSS mitres the join instead). This is a deliberate trade for editability, not a bug — do not
"fix" it. Four equal edges fall back to a native full stroke.

### conic / diamond gradients degrade to a flat colour

Penpot's `Gradient` supports only `linear` and `radial`. `GRADIENT_ANGULAR` (conic) and
`GRADIENT_DIAMOND` are reduced to the first colour stop and reported as a degradation.

### CSS Grid is not wired up

The host has `board.addGridLayout()`, but this adapter does not implement `layoutMode: 'GRID'`. Do
not emit `GRID`; the pipeline's main line is flex auto-layout.

### Pages cannot be deleted through the plugin API

`Page` exposes `id`, `name`, `root`, `getShapeById`, `findShapes`, `createFlow` — no delete. So
`page/delete` returns `available: false` with an alternative; deleting a page is a UI action.

### Component flags: read the description, not the name

| Member | Vendor description | Actual meaning |
|---|---|---|
| `isComponentInstance()` | "inside a component instance" | Inside an instance — main or copy, including descendants |
| `isComponentMainInstance()` | "inside a component **main** instance" | Inside the main → use this to detect a main |
| `isComponentCopyInstance()` | "inside a component **copy** instance" | Inside a copy |
| `isComponentRoot()` | "the **root of a component tree**" | Root of the tree — **true for copies too**, so it does not distinguish main from copy |

Treating `isComponentRoot()` as "is the main" once classified a user's selected copy as a main. The
lesson generalises: grep the vendor type file and read the member's description text.

### Team libraries must be connected in Penpot first

The Penpot plugin can **read** the libraries a file has connected, but it never calls the host's
`connectLibrary` — so a library has to be connected in Penpot's UI before any `team_library_*` /
`team_component_*` call can see it. Observed: `team_library_list` returns only the open document
(`externalCount: 0`, `componentCount` 0) and the response says why.

This is an **adapter limitation, not a host one**: `library.availableLibraries()` and
`library.connectLibrary(id)` both exist in the Penpot plugin API, and the test fake already
implements them — the wiring is simply not done. Until it is, connect the library in the UI.

### Host calls are synchronous: cost is call *count*, not elapsed parallelism

`penpot.*` is a synchronous proxy between the plugin iframe and the host — `createBoard()` returns an
object, `shape.width` and `shape.name = …` are blocking reads and writes. `Promise.all` cannot
overlap them.

Measured on a 43-node page: browser render **28 ms**, host application **5 737 ms** across ≈585 host
calls — roughly **10 ms per call**. Making rendering faster means making fewer calls. A test pins the
call count for a representative render so a regression fails in CI rather than on a user's machine.

Two consequences worth remembering:

- **Do not A/B render time across document states.** The same 43-node page rendered twice on an
  unchanged document gave 6 623 / 6 630 ms (7 ms apart — the instrument is sound), but the same
  render took 5.7 s → 6.6 s after the file grew, while making *fewer* calls. Compare call counts
  (arithmetic) or the client segment (document-independent), not wall clock on a live canvas.
- To verify a paint-behaviour change, read the node's `fills` / `strokes` rather than timing it.

## Harmless degradations — do not chase these

A `skipped` list containing the following is normal:

| Degradation | Why it appears | Impact |
|---|---|---|
| `clipsContent` | Only boards clip in Penpot; the request is rejected on frames | None — the engine sends it per layer, Penpot honours it only where it applies |
| `layoutPositioning` | Non-flex children have no layout child | None — those children are positioned by coordinates anyway |
| `strokeJoin` (non-`MITER`) | Penpot's stroke model has no line-join member | Visible but usually mild: rounded/beveled corners render mitred. `MITER` is not reported, because both sides already agree |

To judge whether something is genuinely wrong, look at three things instead of counting
degradations:

1. is `unresolvedClasses` non-empty (a Tailwind class that matched nothing)?
2. do icons actually have ink in the right box?
3. is `hasStructuralSkips` set?

## Design tokens: different models

| | MasterGo | Penpot |
|---|---|---|
| Organisation | Variables / Collections, with **multiple modes** (light/dark) | `TokenSet` + `TokenTheme` — a theme is *which sets are active*, so there are **no modes**; values live in a `default` pseudo-mode |
| Type vocabulary | one set | another set → responses carry `type` (MasterGo-like) and **`hostType`** (raw) |
| Binding | write each property | **real binding**: `token.applyToShapes()` / `shape.applyToken()`, so editing the token updates the whole document — assigning a property directly **breaks** the binding |

Read `variable/list` responses by `model` (`penpot-tokens` / `mastergo-variables`) rather than
assuming modes.

Two Penpot-specific traps:

- **Token names are paths.** `.` separates segments (`system.color.primary`), and a leaf cannot also
  be a prefix — creating `system.color.primary.hover` when `system.color.primary` exists is rejected.
  Flatten sub-roles with hyphens: `system.color.primary-hover`.
- **Library styles cannot be deleted** (`LibraryColor` / `LibraryTypography` expose no `remove`), so
  registration must upsert by name. Registering the same panel twice previously doubled the palette
  permanently.

## Same tool, different implementation

Read the response fields to tell which path ran.

| Tool | MasterGo | Penpot |
|---|---|---|
| `node_swap_component` | Synthesised in the adapter (create instance, reinsert in place, carry position/size/name/text, delete the original) | Host-native `shape.swapComponent` → response has **`native: true`**; falls back to the synthesised path when the source is not a copy |
| `node_align` | Align/distribute objects relative to each other | Same, via the host's align/distribute calls |
| `component_render` | 33 preset types | Implemented as DSL templates, **15 of 33**; unimplemented types return **`available: false`** with the supported list |
| `teamLibrary/importStyle` | Copies styles from the team library into the file | No copy needed — connecting the library is enough, so "import" confirms availability; `ukey` is MasterGo-only → `available: false` |

Note that `node_align` (aligning objects to each other) is not container alignment
(`primaryAxisAlignItems` / `counterAxisAlignItems` inside a flex container).

## Local file access is bounded by the server's working directory

`code_to_design.filePath`, `node_export_image.saveToPath` and `node_export_batch.savePath` must
resolve inside the directory the **server was started in** (`process.cwd()`); anything else is
refused with `Access denied: … must be within the project directory`. Two consequences worth knowing
before blaming the tool:

- **Where you launch the server decides which files it can touch.** Started from `mcp-server/`, it
  cannot render `examples/*.html`; started from the repository root, it can. The shipped
  process-manager/systemd setups use the repository root for exactly this reason.
- The check is a prefix test done correctly: a sibling directory sharing the prefix
  (`/work/proj-evil`) is rejected, and `..`/duplicate separators are normalised first
  (`mcp-server/tests/path-guard.test.ts` covers both).

Starting the server from a parent of the files you want to reach is enough; there is no separate
allow-list setting.

## Instruments

Before concluding "the host can't do this", gather evidence:

1. **Runtime probe** — `plugin_capabilities`. Flags are measured, not declared; a private or
   enterprise build can lag the public typings.
2. **Vendor types** — grep the API definition and read the description text, not just the name.
3. **Record it** — paste the matched text (or the evidence of no match) into the comment or doc.

Every mis-scoped fallback in this repository traces back to skipping one of those three.
