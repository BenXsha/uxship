# DSL specification

The DSL is the intermediate representation between the canvas and everything else. It is what the
render pipeline produces, what the host adapters consume, and what `design_to_code` turns into HTML
or design tokens.

**You rarely write DSL by hand.** The normal path is HTML + Tailwind through `code_to_design`, which
renders, measures and emits the DSL for you. The DSL matters when you are reading a canvas
(`dsl_export_*`), writing a template, or building a host adapter.

## Authoritative source

The machine-readable spec is served at runtime:

- `dsl_spec` — the tool returns version, the common property list, per-element properties and worked
  examples.

This document is the human-readable companion and deliberately does **not** duplicate the property
tables; a second copy would drift. When they disagree, `dsl_spec` wins.

Current version: **2.0**.

## Shape of a node

```jsonc
{
  "type": "frame",              // required — element kind
  "name": "Card",               // required — becomes the layer name
  "id": "1:2",                  // canvas-assigned; omit when creating
  "position": { "x": 0, "y": 0 },   // relative to the PARENT, in px
  "size": { "width": 320, "height": 180 },
  "isVisible": true,
  "isLocked": false,
  "rotation": 0,
  "opacity": 1,
  "fills": [ /* Fill[] */ ],
  "strokes": [ /* Stroke[] */ ],
  "strokeWidth": 1,
  "effects": [ /* shadows, blurs */ ],
  "cornerRadius": 12,
  "constraints": { /* … */ },
  "blendMode": "NORMAL",
  "children": [ /* nested nodes */ ],
  "layoutMode": "VERTICAL",     // auto-layout
  "itemSpacing": 16,
  "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
  "primaryAxisAlignItems": "MIN",
  "counterAxisAlignItems": "MIN"
}
```

### Element kinds

`frame`, `rectangle`, `ellipse`, `text`, `group`, `line`, `pen`, `polygon`, `star`, `component`,
`instance`, `boolean_operation`.

`pen` is the vector element (`path` is accepted as an alias; `vector` is not a valid name). Not every
host can create every kind — see `capabilities.nodeKinds` in
[`adapter-spec.md`](adapter-spec.md).

## Position is relative to the parent

`position` is **parent-relative**, not absolute page coordinates. The adapter converts. Inside an
auto-layout parent, position is determined by layout, so do not compute it: set the layout fields and
let the engine place children. This is one of the few places where guessing produces plausible but
wrong output.

## Layout

Auto-layout is the main line; CSS Grid is not wired on every host. The fields mirror the usual flex
model:

| Field | Meaning |
|---|---|
| `layoutMode` | `NONE` / `HORIZONTAL` / `VERTICAL` |
| `itemSpacing` | gap between children on the main axis |
| `padding` | per-side padding |
| `primaryAxisAlignItems` | main-axis alignment |
| `counterAxisAlignItems` | cross-axis alignment (`STRETCH` is not universally supported) |
| `layoutSizingHorizontal` / `layoutSizingVertical` | `FIXED` or `HUG` — declare it, or children may collapse |
| `layoutWrap` | wrapping |

Two traps that come up constantly:

- **Defaults are not zero.** Some hosts default spacing and padding to non-zero values, so an
  unset field can add gaps you did not ask for. The conversion engine writes explicit zeros when you
  did not specify — hand-written DSL must do the same.
- **Declare child sizing.** A child in a flex container without an explicit width policy renders as
  hug/auto and collapses. Say `FIXED` with a width, or `HUG` deliberately.

## Text

Text content lives in `content`; the raw host field name (`characters`) is an adapter detail. Font
handling differs sharply between hosts — on at least one host, naming a font family that the host
does not have silently falls back to the default, so a font family is only emitted when the CSS names
a concrete one. See [`host-differences.md`](host-differences.md).

## Fills, strokes, effects

- `fills` is an **ordered** array, and the order convention differs between the DSL/CSS side and some
  hosts (first-topmost vs first-bottommost). The engine normalises this; do not hand-reverse.
- Multi-layer CSS `background` / `background-image` maps to one DSL fill per layer.
- Some host limitations have no DSL equivalent and are reported rather than silently dropped — per-side
  strokes and conic gradients are the usual two.

## Templates and trees

Two structured forms exist so repetitive HTML is not expanded by hand:

- `type: "template"` — `grid`, `table`, `list`, `form`, `pagination`, `carousel` and friends, driven
  by a small config object;
- `type: "tree"` — recursive nested data with indentation and connectors.

In HTML authoring the equivalent is a `data-table='{"columns":…,"data":…}'` attribute, which the
server expands into a template instead of N repeated rows.

## Reading and writing

| Direction | Tool |
|---|---|
| HTML + Tailwind → canvas | `code_to_design` |
| DSL → canvas | `dsl/render` |
| Canvas → DSL | `dsl_export_node`, `dsl_export_selection` |
| Canvas/DSL → code | `design_to_code`, `design_to_code_update` |

Exports are annotated: layer names are made semantic first (`__svg`, `__header`, …) so the generated
code has meaningful identifiers rather than `div_3`.

## Degradation

Anything the target host cannot represent comes back as a structured skip (`skipped`, `available:
false`, `hostType`) rather than being dropped. If a response contains no degradation notice, that is
the claim that everything applied — which is only meaningful because adapters never swallow.
