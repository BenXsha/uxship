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

## Images: the engine delivers a fill, Penpot does not land it

An image reaches the pipeline three ways. Two of them end in an `IMAGE` fill, and that fill currently
stops at the Penpot adapter while MasterGo renders it.

| Authored as | Engine → DSL | MasterGo | Penpot |
|---|---|---|---|
| `<img src>` | fill `{type:'image', imageUrl, imageData?}` | IMAGE fill → `imageRef` | **skipped** (Gap 2) |
| CSS `background-image: url(…)` | fill `{type:'image', …}`, one per layer | IMAGE fill → `imageRef` | **skipped** (Gap 2) |
| node-level `imageUrl` (hand-written DSL) | `element.imageUrl` | image node | **works** — `uploadMediaUrl`, cached per URL |

### Gap 1 (fixed) — the engine used to drop every `<img>` fill

Until 2026-10-03 `useClientRender` (both `plugin-penpot/ui/composables/useClientRender.ts` and
`plugin-mastergo/ui/composables/useClientRender.ts`) extracted the `<img>` as `imgFill`, then
`extractBackgroundFills()` returned `null` whenever an `imgFill` existed — and the caller only
assigned the node's fills when that result was truthy, so the `imgFill` was never attached:

```ts
if (imgFill) return null                            // extractBackgroundFills
…
if (fills) node.fills = imgFill ? [imgFill] : fills // never ran when imgFill was set
```

The `<img>` node came out with the right name, size and radius but **no `fills` key at all**. The
fill is now assigned explicitly, and the harness check that had gone red (`远程图片被识别为图片填充`)
is green again. It is recorded here because it is why "images work" was believed while no HTML image
had ever reached a canvas — and because the fill now arrives at the adapter and meets Gap 2.

### Gap 2 — the Penpot adapter never wires IMAGE fills

`toPenpotFills()` has an IMAGE branch that **always** reports a skip and continues, even when the DSL
carries `imageData` (`plugin-penpot/lib/host/penpot-paint.ts`). MasterGo consumes
`imageData` / `imageUrl` into an `imageRef` (`plugin-mastergo/lib/api/dsl-renderer.ts`), so the
server-side prefetch `enrichDslWithImageData()` (`mcp-server/src/utils/code-to-design-service.ts`)
is **dead code** — exported, never called, and only MasterGo would have benefited.

Penpot only has the node-level `imageUrl` path (`penpot.ts` `case 'imageUrl'` → `uploadMediaUrl` /
`uploadMediaData`, cached by URL). The engine never emits `imageUrl` for HTML, so in practice HTML
images never reach a Penpot canvas.

### Gap 3 — the capability flag contradicted the adapter

`probe()` reported `props.imageFills: true` while the fill path skipped every IMAGE fill. That is the
same "host has it / adapter does not" case `gridLayout` is careful about, so `imageFills` is now
`false` until Gap 2 is wired; `imageFromUrl` stays `true` because the node-level path really works.

### What Penpot can and cannot express

Checked against the vendor types at the host version in use (`api_types.yml` at tag `2.18.1`,
byte-for-byte the same as `develop`) and the published `@penpot/plugin-types`:

- **No image scale mode.** `Fill` exposes only `fillImage`; `imageScaleMode` / `scaleMode` appears
  nowhere in the API. `FILL` / `FIT` / `TILE` cannot be requested, and the adapter currently drops
  the field silently — it should be reported in `skipped` like any other unrepresentable property.
- `ImageData` does carry `keepAspectRatio?: boolean` ("keep the aspect ratio of the image when
  resizing", default false), but the API member list marks it `readonly`. Whether Penpot honours it
  when present on the object assigned to `fillImage` is a live-host probe, not something the types
  settle.
- **Our `PenpotImageData` declaration had drifted** (`typings/penpot.d.ts`): `data` was declared a
  base64 `string` and `id` optional, while the vendor type is `id: string` and
  `data(): Promise<Uint8Array>`. Nothing read either field, so the drift was latent — corrected now.

### Server-side rules that decide whether a remote URL lands

From the Penpot 2.18.1 backend (`app/media.clj`, `app/media/validation.clj`, `app/common/media.cljc`):

| Rule | Value | Consequence |
|---|---|---|
| Allowed image MIME types | `jpeg`, `png`, `webp`, `gif`, `svg+xml` — five only | `avif` / `bmp` / `tiff` are rejected `media-type-not-allowed` |
| `media-max-file-size` | 30 MiB default | larger files rejected; our prefetch caps at **10 MiB** and only allows HTTPS, so it is stricter |
| `uploadMediaUrl` transport | backend fetches the URL, max 3 redirects | works from the plugin iframe without CORS, but sends no client cookies / auth |
| `Content-Length` | **required** | a chunked response with no length fails as `unknown-size` |
| SVG | sanitized (`sanitize-svg`), no thumbnail | scripts / `foreignObject` are stripped before storage |
| Processing | ImageMagick, rate-limited (`process-image/by-profile`, `process-image/global`) | bulk image renders can hit a quota; cost is per upload, not per reference |

`uploadMediaData` goes through the same MIME and size validation, so any future `imageData` path has
to respect the same five formats and 30 MiB.

### Export (`node_export_image`)

- `Export` is `{type, scale?, suffix?, skipChildren?}` — **no alpha / background / quality option**.
  Transparency is whatever the format keeps: PNG and WEBP keep it, JPEG flattens it. There is no way
  to ask for a matte or a background colour.
- 2.18.1 accepts `png | jpeg | webp | svg | pdf` for `type` (older `@penpot/plugin-types` releases
  omit `webp` — do not read the published types as the host's capability set). `scale` is the only
  sizing knob, so `constraint: WIDTH/HEIGHT` is converted to a scale and the response says so;
  SVG / PDF scale is host-dependent and not assumed to have taken effect.
- `suffix` and `skipChildren` are unused by our contract.

### Component carry-over does not include images

`swapComponent` / `carryOverOverrides` carry **text content and hidden state, by layer name**, and
nothing else (`lib/api/swapComponentHandlers.ts`). An image fill is an override like any other: it is
not carried onto a replacement, and `resetOverrides` (the `carryOverOverrides: false` path) discards
it. An instance swap therefore keeps the master's image, never the instance's.

### Still to measure on a live host

Code and vendor types settle the above. These need a running Penpot with a connected plugin, and are
listed so "not yet measured" is not read as "verified":

1. whether an `ImageData` carrying `keepAspectRatio: true` changes the fill's fit when assigned to
   `fillImage`;
2. behaviour at the 30 MiB boundary and with a `Content-Length`-less URL;
3. whether `webp` export succeeds end-to-end through `shape.export` on 2.18.1.

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

## Local file access is bounded by a trust-root list

`code_to_design.filePath`, `node_export_image.saveToPath` and `node_export_batch.savePath` must
resolve inside one of the server's **trust roots**; anything else is refused, and the error lists the
roots currently in effect (plus how to add one). The roots are, in order:

1. `UXSHIP_ALLOWED_BASE_DIRS` — extra roots you declare, separated by `path.delimiter` (the escape
   hatch when the files live somewhere else);
2. the server's **working directory** — the most common intent;
3. the root of the repository/package the **server code itself** lives in.

Root 3 exists because roots 1–2 alone made the behaviour depend on *how* the server was launched:
started from `mcp-server/` it could not render the repository's own `examples/*.html`, and a client
that spawns the server itself leaves the working directory at the package location — so a user's own
project files were all out of range. The symptom was `Access denied: … must be within the project
directory` on a path that was obviously fine, which reads like a broken tool rather than a policy.

Two properties worth knowing before blaming the guard:

- the check is a prefix test done correctly — a sibling directory sharing the prefix
  (`/work/proj-evil` vs `/work/proj`) is rejected, and `..`/duplicate separators are normalised
  first (`mcp-server/tests/path-guard.test.ts` covers both);
- **roots are parents, not sandboxes.** Anything under a trusted root is allowed, so a directory
  inside the repository is reachable even if it is not under the server's working directory.

## Instruments

Before concluding "the host can't do this", gather evidence:

1. **Runtime probe** — `plugin_capabilities`. Flags are measured, not declared; a private or
   enterprise build can lag the public typings.
2. **Vendor types** — grep the API definition and read the description text, not just the name.
3. **Record it** — paste the matched text (or the evidence of no match) into the comment or doc.

Every mis-scoped fallback in this repository traces back to skipping one of those three.
