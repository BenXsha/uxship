# Examples

Runnable demonstrations of what the pipeline does, and an honest note on what each one needs in
order to run.

| Demo | What it proves | Needs a canvas? | Status |
|---|---|---|---|
| [01 — HTML to canvas](#demo-1--html--tailwind-一次成页) | HTML + Tailwind → measured by a real browser → DSL | No | **Verified here** |
| [02 — Team library reuse](#demo-2--团队库复用) | Library component instantiated with a chosen variant | **Yes** (+ a team library) | Runbook only |
| [03 — Swap component in place](#demo-3--换组件原位替换) | A plain object becomes a component instance, in place | **Yes** (+ components) | Runbook only |

The GIF/screenshot deliverables for demos 2 and 3 are **not** in the repository. They require a live
design tool to record, and this project will not ship a "demo" that was never actually run.

---

## Demo 1 — HTML + Tailwind 一次成页

`01-html-to-canvas.html` is a normal page: flex containers, gradients, shadows, radius, Iconify
icons via `data-icon`. `01-html-to-canvas.expected-dsl.txt` is the **engine-measured DSL** it
produces, checked in so a regression shows up as a diff.

### Run it (no design tool needed)

Requires Node 20+ and a Chromium for the harness to drive:

```bash
npx playwright install chromium     # one-off; ~170 MB

cd plugin-penpot
yarn harness:build
node scripts/serve.mjs --root harness-dist --port 4406 &

# Ubuntu 23.10+ blocks unprivileged user namespaces via AppArmor, so Chromium's
# sandbox cannot start ("No usable sandbox!"). The flag is opt-in on purpose —
# see scripts/chrome.mjs. On macOS you can omit it.
CHROME_FLAGS=--no-sandbox node scripts/harness-render.mjs ../examples/01-html-to-canvas.html
```

Expected output starts like:

```text
Demo Page                       frame        1200 x 606
  Demo Page                       frame        1200 x 606     VERTICAL counter=FIXED
    Top Bar                         frame        1200 x 64      HORIZONTAL pad=0/40/0/40 ...
```

Bytes differ only in indentation width; sizes, layout modes and padding should match the checked-in
file exactly (the render is deterministic — the same page measured twice gives identical numbers).

### What this covers, and what it deliberately does not

Covers the client half: Tailwind resolution, flex layout, text measurement, gradient/shadow/radius,
and `data-icon` → native path. These are the parts that go wrong in ways that look like host bugs, so
being able to measure them **without** a canvas is what makes "engine wrong" vs "host didn't honour
it" a two-minute question instead of a guessing game.

Does **not** cover server-side preprocessing (`data-table`, `<chart>`, `<component>` are expanded on
the server, not by the client engine) or anything that requires writing to a canvas. For that, use
`code_to_design` against a connected plugin.

### One thing to know when reading text sizes

Text nodes are reported a few pixels **wider** than their CSS box. Measured on small probes: a `380px`
column reports `363` only when unconstrained, an explicit `w-[200px]` reports `203`, and an explicit
`560px` reports `563`. The offset is consistent and reproducible, so it is a text-measurement artifact
— **do not read a 2–3px text overflow as a layout bug**. Layout containers themselves are exact
(`w-[512px]` measures `512`).

---

## Demo 2 — 团队库复用

Instantiate a team-library component with a chosen variant, instead of hand-drawing a lookalike.

**Needs:** a live Penpot (or MasterGo) session with a team library that contains at least one
component with variants.

```text
1. team_library_sync            # index the library once; cached in .uxship/team-library.json
2. team_library_list            # confirm the library is visible
3. team_component_search        # find the component, note its ukey / name / variants
4. team_component_import        # instantiate with a specific variant, or reference it from HTML
```

In HTML, the same thing is declarative — the render imports the instance for you:

```html
<section data-library-component="Design System/Primary Button"
         data-library-variant="State=hover"
         data-name="Submit"></section>
```

Precedence the pipeline follows: **team library component > `component_render` preset > bare
element.** With a library available, reuse it — that is what keeps a brand consistent across pages.

## Demo 3 — 换组件原位替换

Replace objects **in place** so the parent, layer order and geometry survive — the operation people
usually do by deleting and re-adding, which loses the text overrides and the position.

```text
node_swap_component { nodeIds: ["1:2","1:3"], ukey: "ukey:xxx", keepOriginal: false }
```

- On an **instance**, it swaps the main component (equivalent to the host's "replace component").
- On a **plain object** (frame / rectangle / text / group / …), it inserts an instance at the same
  parent and index, inherits position and size, carries text over by layer name, then removes the
  original.
- `COMPONENT` / `COMPONENT_SET` are refused as swap *targets*, because replacing a main component
  would break every instance referencing it.

In HTML: `data-swap-node-id="1:2"` + `data-swap-ukey` / `data-swap-component="Library/Name"`.
Rendering then performs the swap and creates no new node — so an empty `rootNodeIds` in the result is
expected, not a failure.

---

## Contributing a demo

Add the HTML (or the tool-call script) **and** the expected artifact produced by actually running it.
A demo whose expected output was written by hand is a liability: it silently encodes what the author
believed rather than what the pipeline does.
