# uxship

**Ship design, not screenshots.**

A local-first design-canvas agent harness. One MCP contract that renders AI-generated design into a design tool's canvas — and reads canvas design back out to code.

> **Status: pre-release.** The first public release is being prepared (de-branding, asset license audit, CI, docs). Star or watch this repo to catch it.

---

## What it is

uxship connects an AI agent to a design tool's canvas over the [Model Context Protocol](https://modelcontextprotocol.io). The agent writes into the canvas as real, editable layers — and reads the canvas back out as structured design data.

Two directions, one tool surface:

| Direction | What happens |
|---|---|
| **Design → canvas** | The agent authors HTML + Tailwind. uxship preprocesses it (icons, charts, components), renders it through a real browser engine for accurate layout, then writes the result into the canvas as native layers. |
| **Canvas → code** | A canvas selection exports to a structured DSL, then to HTML + Tailwind, design tokens (CSS variables / DTCG), and SVG assets. |

## Design principles

- **One contract, any canvas.** The same MCP tool surface drives more than one design tool through a host adapter layer, so a second canvas is an adapter — not a rewrite.
- **Local-first.** Rendering and preprocessing run on your machine. Design data does not leave your network.
- **Built for agent budgets.** Tool surfaces are disclosed progressively and tool results are truncated structurally, never mid-JSON, so large design files do not blow up the context window.
- **Never silently degrade.** When a host cannot represent something, it is reported, not dropped.

## Roadmap

- [ ] First public release
- [ ] English documentation + architecture notes
- [ ] Host adapter specification — bring your own canvas
- [ ] Benchmarks: context cost, tool-selection accuracy, render fidelity

## Status of this README

This is a placeholder. Full documentation lands with the first public release.

## Disclaimer

Not affiliated with, endorsed by, or sponsored by any design tool vendor. MasterGo, Penpot, Figma and all other product names, logos, and brands are property of their respective owners.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

---

<details>
<summary>中文简介</summary>

**uxship** 是一个**本地优先**的设计画布 agent harness：通过一套 MCP 工具契约，把 AI 生成的设计写进设计工具的**画布**，也能把画布上的设计**读回代码**。

- **设计 → 画布**：Agent 写 HTML + Tailwind，经服务端预处理（图标 / 图表 / 组件）与浏览器实测渲染，落成画布上的原生可编辑图层。
- **画布 → 代码**：选中区域导出为结构化 DSL，再转 HTML + Tailwind、设计令牌（CSS 变量 / DTCG）与 SVG 资源。
- **本地优先**：渲染与预处理都在本机，设计数据不出内网。
- **为 agent 预算而设计**：工具面渐进披露 + 结构保持式截断，大设计文件不撑爆上下文。
- **不静默降级**：宿主表达不了的能力会被如实上报，而不是悄悄丢掉。

当前为**预发布**状态，首个公开版本正在准备中。

</details>
