# Tool surface

Every tool definition you expose is re-sent to the model on **every** request. The tool surface is
therefore treated as a budget, not as a feature list — this document explains how it is shaped and how
to see the current truth.

## Progressive disclosure

The server never exposes all of its tools at once. The initial surface is chosen by profile, and more
can be loaded on demand at runtime.

| Profile | Tools | Chars | What it is |
|---|---|---|---|
| `gen` *(default)* | 20 | 11 593 | The design-generation path: write HTML, render, read back |
| `core` | 17 | 10 807 | Node CRUD, document context, search — no pipelines or assets |
| `design` | 46 | 29 602 | The design domain in full |
| `tokens` | 21 | 13 546 | Variables, styles, team libraries, components |
| `ops` | 18 | 6 093 | Pages, canvas view, sessions, task progress, codebase analysis |
| `agent` | 3 | 1 144 | The Design Agent trio |
| `full` | 67 | 36 837 | Everything |

`gen` is **~68% smaller** than `full`. Numbers are the serialized JSON of the tool definitions, not an
estimate; see [benchmarks](benchmarks.md) for how they are produced.

Set with `UXSHIP_MCP_PROFILE` (comma-separated, or `full`). A few tools are resident in every
profile — session management, task progress, and `plugin_capabilities` — because they are needed
before you know which profile you want.

### Loading more at runtime

```text
mcp_tools { action: "status" }                     # what is loaded, what is available
mcp_tools { action: "enable", profile: ["design"] }  # load a profile
mcp_tools { action: "enable", tool: ["node_export_image"] }
```

The client then receives a tool-list-changed notification. This matters for accuracy as well as
cost: a tool that is not loaded does not exist as far as the model is concerned, so a small default
surface is also a way of steering behaviour towards the intended path.

## Tool families

| Family | Examples | Notes |
|---|---|---|
| Design generation | `code_to_design`, `dsl/render`, `template`/`tree` | The main line: author HTML+Tailwind, render, land on canvas |
| Canvas → code | `dsl_export_node`, `dsl_export_selection`, `design_to_code`, `design_to_code_update` | Exports DSL, HTML, tokens (CSS variables / DTCG) and SVG |
| Nodes | `node_create`, `node_update`, `node_delete`, `node_clone`, `node_move`, `node_get` | Batch forms exist for create/update |
| Search & describe | `search_nodes`, `design_describe`, `design_review` | Structure summaries, not full dumps |
| Components | `component_list`, `component_search`, `component_render`, `component_state_matrix`, `node_convert_to_component`, `node_swap_component` | Preset coverage varies by host |
| Team libraries | `team_library_list`, `team_component_search`, `team_component_import`, `team_style_list`, `team_style_import`, `team_library_sync` | Requires plugin mode |
| Tokens & styles | `variable_*`, `style_list_*`, `style_apply`, `library_register_styles` | Binding semantics differ by host |
| Icons | `icon_search`, `icon_render` | Iconify, ~200k icons; rendered as native editable paths |
| Selection & canvas | `selection_get`, `selection_set`, `canvas_zoom_to_node`, `canvas_zoom_to_rect` | Renders focus the result by default |
| Sessions & tasks | `session_list`, `session_switch`, `task_plan`, `task_step`, `task_complete` | Resident in all profiles |
| Diagnostics | `plugin_capabilities`, `mcp_tools`, `health_get`, `node_export_image` | Probed capability flags, not declarations |

## Output side

Input cost is only half the bill: results are re-sent on every subsequent turn. Tools whose responses
grow with document size are listed in `HEAVY_OUTPUT_TOOLS` and have their results truncated
structurally — arrays by item, long strings by tail, structure and keys preserved, always valid JSON,
with the loss recorded in `_truncated` and a narrowing hint in `_budget.hint`.

Two deliberate exclusions:

- tools with their own byte limits or on-disk handoff (`node_export_image`, `node_export_batch`) —
  stacking a second limit would make two mechanisms fight;
- small diagnostic results (`health_get`, `dsl_spec`, `mcp_tools`) — truncating the material an agent
  needs to make decisions is worse than the bytes it saves.

A test fails when a new `*_list` / `*_search` tool is not in the allow-list, because the failure mode
is silent: the tool works, the context quietly grows.

## Seeing the current surface

```bash
# local, exact
node -e "…"                      # see benchmarks.md for the measuring script
mcp_tools { action: "status" }   # inside a session, what is exposed right now
```

Tool names, descriptions and profile membership are core, not adapter, concerns — a host adapter
contributes behaviour, never API. See [`adapter-spec.md`](adapter-spec.md).
