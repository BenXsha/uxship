# uxship

**Ship design, not screenshots.**

A local-first design-canvas agent harness. One MCP contract that renders AI-generated design into a
design tool's canvas as native, editable layers — and reads canvas design back out to code.

> **Status: pre-release.** The server, both host adapters and `mcp-response-budget` are complete and
> tested (1 683 tests green in CI on Node 20/22/24). **Nothing is published to npm yet** — build from
> source for now. Documentation is still being filled in.

---

## What it is

uxship connects an AI agent to a design tool's canvas over the
[Model Context Protocol](https://modelcontextprotocol.io). The agent writes into the canvas as real
layers — not an image, not an embedded frame — and reads the canvas back out as structured data.

Two directions, one tool surface:

| Direction | What happens |
|---|---|
| **Design → canvas** | The agent authors HTML + Tailwind. uxship preprocesses it (icons, charts, components), renders it through a real browser engine to measure actual layout, then writes the measured result into the canvas as native layers. |
| **Canvas → code** | A canvas selection exports to a structured DSL, then to HTML + Tailwind, design tokens (CSS variables / DTCG) and SVG assets. |

## Quick start (from source)

```bash
git clone https://github.com/BenXsha/uxship.git && cd uxship
npm run install:server && npm run install:plugin && npm run install:penpot
npm run build:server

# run the server (HTTP/SSE on 127.0.0.1:15490, plugin hub on 127.0.0.1:15489)
node mcp-server/dist/index.js --http
```

Then point your MCP client at `http://127.0.0.1:15490/sse`, open the plugin for your design tool
(`plugin-mastergo/` or `plugin-penpot/`), and click **Connect** in its panel. The connection is
deliberately user-initiated: when an agent may write to your document is your call, and the server
never attaches itself.

```bash
npm run server:status     # is it up, is a plugin connected
npm run server:stop
```

## Why it exists

| | |
|---|---|
| **One contract, any canvas** | The same tool surface drives MasterGo and Penpot today; a third canvas is an adapter, not a fork — [`docs/adapter-spec.md`](docs/adapter-spec.md) |
| **Local-first** | No account, no telemetry, no upload path. Rendering and preprocessing run on your machine — [`docs/why-local-first.md`](docs/why-local-first.md) |
| **Built for agent budgets** | 67 tools → 20 by default (**−68%**), and results truncated by shape — never mid-JSON — with the loss reported. Measured, reproducible: [`docs/benchmarks.md`](docs/benchmarks.md) |
| **Never silently degrades** | When a host cannot represent something it is reported (`skipped`, `available: false`, `hostType`), not dropped |

## Supported canvases

**MasterGo** and **Penpot**, through one contract. They are not equivalent — fonts, single-side
strokes, gradients, grids, token models and even native component operations differ. That list, and
which degradations are *normal*, is in [`docs/host-differences.md`](docs/host-differences.md).

## Documentation

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Layers, transports, the render pipeline, the adapter seam |
| [`docs/adapter-spec.md`](docs/adapter-spec.md) | The 54-member host port, capability probing, adding a canvas |
| [`docs/host-differences.md`](docs/host-differences.md) | Every known MasterGo/Penpot difference, with evidence |
| [`docs/dsl-spec.md`](docs/dsl-spec.md) | The intermediate representation |
| [`docs/mcp-tools.md`](docs/mcp-tools.md) | Tool surface, profiles, progressive disclosure |
| [`docs/benchmarks.md`](docs/benchmarks.md) | Context cost, method, and what is *not* measured |
| [`docs/comparison.md`](docs/comparison.md) | Honest positioning, including where this is behind |
| [`docs/why-local-first.md`](docs/why-local-first.md) | What local-first buys, and what it costs |
| [`packages/response-budget/README.md`](packages/response-budget/README.md) | The standalone truncation library |
| [`skills/design/`](skills/design/) | Agent-facing design rules the pipeline expects |

## Repository layout

```text
mcp-server/                 MCP server: tools, render pipeline, transports, session routing
plugin-mastergo/            MasterGo host adapter (plugin + UI)
plugin-penpot/              Penpot host adapter (plugin + UI)
packages/response-budget/   Standalone output-truncation library (ESM + CJS)
skills/design/              Design rules and templates consumed by agents
docs/                       Architecture and reference documentation
scripts/                    Gates, packaging, benchmarks, dev tooling
```

## Development

Node 20, 22 or 24. The full gate — the same one CI runs:

```bash
(cd mcp-server     && npx tsc --noEmit && npm test)     # 699 tests
(cd plugin-mastergo && yarn typecheck && yarn test)     # 374 tests
(cd plugin-penpot   && yarn typecheck && yarn test)     # 592 tests
(cd packages/response-budget && npm test)               #  18 tests
npm run build:server && npm run build:plugin && npm run build:penpot
npm run license:check && npm run docs:check && npm run skill:check
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules and the reasoning behind the gates.

## Status and roadmap

Done: the MCP contract, both host adapters, the render pipeline, output budgeting, the standalone
truncation package, CI on three Node versions, licence/secret/docs gates.

Not yet done, and not pretended otherwise:

- [ ] First npm release (names are free; the publishing identity is not yet settled)
- [ ] English documentation polish and `zh-CN` mirrors
- [ ] Reproducible render-fidelity benchmarks (see [`docs/benchmarks.md`](docs/benchmarks.md))
- [ ] Example projects and end-to-end demos
- [ ] More host adapters ([`docs/adapter-spec.md`](docs/adapter-spec.md) exists so this can come from
      the community)

## Security

Local-first by default, but the server can create and delete layers in your documents. Read
[`SECURITY.md`](SECURITY.md) before exposing it beyond loopback. Report vulnerabilities through
[private advisories](https://github.com/BenXsha/uxship/security/advisories/new), not public issues.

## Disclaimer

Not affiliated with, endorsed by, or sponsored by any design tool vendor. MasterGo, Penpot, Figma and
all other product names, logos and brands are property of their respective owners.

## License

[Apache-2.0](LICENSE) — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for redistributed
third-party assets.

---

<details>
<summary>中文简介（完整版：<a href="README.zh-CN.md">README.zh-CN.md</a>）</summary>

**uxship** 是一个**本地优先**的设计画布 agent harness：一套 MCP 工具契约，把 AI 生成的设计写进设计工具的**画布**（原生可编辑图层，不是截图），也能把画布上的设计**读回代码**。

- **一套契约，多个画布**：同一套工具面同时驱动 MasterGo 与 Penpot；新增宿主是**适配器**，不是 fork。
- **本地优先**：无账号、无遥测、无上传链路，渲染与预处理都在本机完成。
- **为 agent 预算而设计**：默认工具面 67 → 20（**−68%**），结果按结构截断（绝不切坏 JSON）并如实上报损失。
- **不静默降级**：宿主表达不了的能力会被显式上报，而不是悄悄丢掉。

当前为**预发布**状态：代码与测试已就绪（CI 三个 Node 版本共 1683 例全绿），但**尚未发布到 npm**，暂时从源码构建。完整中文说明见 [`README.zh-CN.md`](README.zh-CN.md)，架构与参考文档见 [`docs/`](docs/)。

</details>
