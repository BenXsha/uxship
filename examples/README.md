# Examples

Runnable demonstrations of what the pipeline does, with the results that were actually observed on a
real canvas.

| Demo | What it proves | Status |
|---|---|---|
| [01 — HTML → canvas](#demo-1--html--tailwind-一次成页) | HTML + Tailwind → measured by a real browser → native canvas layers | **Verified** (engine + Penpot) |
| [02 — Team library reuse](#demo-2--团队库复用) | Library component instantiated with a chosen variant | **Blocked here** — no library connected |
| [03 — Swap component in place](#demo-3--换组件原位替换) | A plain object becomes a component instance, in place | **Verified** (Penpot) |

Neither GIF is in the repository. Recording one requires a live canvas plus a screen recorder; the
PNG in `01-html-to-canvas.penpot.png` is a real export from a real canvas, taken with
`node_export_image`.

---

## Demo 1 — HTML + Tailwind 一次成页

`01-html-to-canvas.html` is a normal page: flex containers, gradients, shadows, radius, Iconify icons
via `data-icon`. Two artifacts are checked in:

- `01-html-to-canvas.expected-dsl.txt` — the **engine-measured** DSL (real browser, no canvas);
- `01-html-to-canvas.penpot.png` — the same page **exported from a real Penpot canvas**.

### Reproduce the engine half (no design tool needed)

```bash
npx playwright install chromium     # one-off; ~170 MB

cd plugin-penpot
yarn harness:build
node scripts/serve.mjs --root harness-dist --port 4406 &

# Ubuntu 23.10+ blocks unprivileged user namespaces via AppArmor, so Chromium's sandbox
# cannot start ("No usable sandbox!"). The flag is opt-in on purpose — see scripts/chrome.mjs.
CHROME_FLAGS=--no-sandbox node scripts/harness-render.mjs ../examples/01-html-to-canvas.html
```

The render is deterministic — the same page measured twice gives identical numbers — so the
checked-in output works as a regression baseline.

### Reproduce the canvas half

With a plugin connected:

```text
code_to_design { filePath: ".../01-html-to-canvas.html" }
```

### What the canvas run actually produced

50 layers, `skipped: []`, `unresolvedClasses: []`, `hasDegradation: false`, and
`timing: { clientRenderMs: 40, hostRenderMs: 7319 }` — the browser half is negligible; the time is
host API calls, exactly as described in [`../docs/host-differences.md`](../docs/host-differences.md).

Reading the canvas back and comparing against the engine's numbers:

| Node | Engine | Canvas | |
|---|---|---|---|
| Root page | 1200 × 606 | 1200 × 606 | ✅ |
| Top Bar | 1200 × 64 | 1200 × 64 | ✅ |
| Top Actions | 220 × 36 | 220 × 36 | ✅ |
| Hero | 1200 × 294 | 1200 × 294 | ✅ |
| Hero Copy | 560 × 166 | 560 × 166 | ✅ |
| Hero Stats | 512 × 182 | 512 × 182 | ✅ |
| Feature Grid | 1200 × 248 | 1200 × 248 | ✅ |
| Feature Card A / B / C | 357 × 168 | 357 × 168 | ✅ |
| **Brand** (hug-width) | **131** × 24 | **143** × 24 | ⚠️ |

**Every explicitly sized node matched exactly — 10 of 10.** The one difference is a *hug-width*
container: `Brand` has no declared width, so its size follows its text, and the host's font metrics
measure that text 12px wider than the browser does. That is the general rule worth remembering:
**fixed sizes survive the trip; hug sizes depend on the host's text measurement.**

The run also emitted one `layoutWarnings` entry — worth knowing the mechanism exists:

```text
文本「宿主表达不了的能力如实上」盒宽偏紧（单行自然宽 308 / 盒宽 307）→ 已按单行收敛；
建议给容器或文本显式宽度并留 ≥8px 余量
```

So a too-tight text box is reported with a concrete suggestion rather than silently clipped. (The
`Card Body C` line in the HTML is 1px tight because of the text-measurement offset below; add ~8px of
slack in real designs.)

### One thing to know when reading text sizes

Text nodes are reported a few pixels **wider** than their CSS box, consistently and reproducibly:
an unconstrained column reports `363` for a `360` box, an explicit `w-[200px]` reports `203`, an
explicit `560px` reports `563`. `w-[Npx]` genuinely does constrain a `<p>` — the offset is a
text-measurement artifact, not a layout bug. Container sizes are exact.

---

## Demo 2 — 团队库复用

**Could not be demonstrated here.** `team_library_list` reports one library — the open document
itself — with `componentCount: 0` and `externalCount: 0`, and the response says why:

```text
没有外部库组件：团队库需先在 Penpot 里连接（本插件暂未接线 connectLibrary）
```

So this demo needs, in order: a library connected inside Penpot, then the plugin-side `connectLibrary`
wiring. The runbook once that exists:

```text
1. team_library_sync            # index the library; cached in .uxship/team-library.json
2. team_library_list            # confirm it is visible
3. team_component_search        # find the component; note ukey / name / variants
4. team_component_import        # instantiate, or reference it from HTML
```

In HTML the same thing is declarative:

```html
<section data-library-component="Design System/Primary Button"
         data-library-variant="State=hover"
         data-name="Submit"></section>
```

Precedence the pipeline follows: **team library component > `component_render` preset > bare
element.** With a library available, reuse it — that is what keeps a brand consistent across pages.

---

## Demo 3 — 换组件原位替换

**Verified on a real canvas.** Starting from the page rendered in Demo 1:

```text
node_convert_to_component { nodeId: <Feature Card A>, name: "FeatureCard" }
  → componentId d99821dd-…bfba56bd

node_swap_component { nodeId: <Feature Card B>, componentId: <that>, keepSize: true }
  → total 1, replaced 1, failed 0, carriedOver 2
```

What the canvas then showed, read back with `design_describe`:

- `Feature Card B` is an **instance**, still the 2nd child of `Feature Grid`, at the same
  `x=421 / y=398` and the same `357 × 168` — parent, layer order and geometry survived, which is the
  whole point of replacing in place rather than deleting and re-adding.
- `Feature Card C` was untouched.
- **Its content changed to the master's**: the children are now `Card Title A` / `Card Body A` and the
  title reads 设计生成. B's children were named `Card Title B` / `Card Body B`, so nothing matched the
  master's layer names and no override was carried for them.

That last point is the load-bearing rule, demonstrated rather than asserted:

> Overrides and component swaps are resolved **by layer name**. Names that drift break the chain.

And it was not silent — the tool reported what it did and why:

```text
源对象不是组件实例 → 用合成实现（原生 swapComponent 要求实例）
父层是 flex 布局 → 位置由布局决定（已插回原图层顺序，位置随之保持一致）
```

Two takeaways for real work:

1. If you want the replacement to keep its own text, name its children the same as the master's
   (`Card Title`, not `Card Title B`) — or pass `overrides` explicitly.
2. A native `shape.swapComponent` exists, but it needs an *instance* on the other side; a plain
   object necessarily goes through the synthesised path. The response says which one ran.

---

## Contributing a demo

Add the source **and** the artifact produced by actually running it — the measured DSL, the exported
PNG, or the tool response. A demo whose expected output was written by hand encodes what the author
believed rather than what the pipeline does, and it rots silently.
