# uxship

**Ship design, not screenshots.**（把设计交付出去，而不是交付截图。）

**本地优先的设计画布 agent harness。** 一套 MCP 契约，把 AI 生成的设计写进设计工具的**画布**——
落成**原生、可编辑的图层**，而不是一张图或一个不可编辑的容器；也能把画布上的设计**读回代码**。

> **状态：预发布。** 服务端、两个宿主适配器与 `mcp-response-budget` 已完成并有测试覆盖
> （CI 在 Node 20/22/24 上共 **1683 例全绿**）。**尚未发布到 npm**，暂时从源码构建。
> 文档仍在补齐中。英文正文见 [`README.md`](README.md)。

---

## 它是什么

uxship 通过 [Model Context Protocol](https://modelcontextprotocol.io) 把 AI agent 接到设计工具的
画布上。两个方向，一套工具面：

| 方向 | 发生什么 |
|---|---|
| **设计 → 画布** | Agent 写 HTML + Tailwind。uxship 先做预处理（图标 / 图表 / 组件），再用**真实浏览器引擎渲染并实测布局**，最后把实测结果落成画布上的原生图层。 |
| **画布 → 代码** | 选中区域导出为结构化 DSL，再转 HTML + Tailwind、设计令牌（CSS 变量 / DTCG）与 SVG 资源。 |

## 快速开始（源码构建）

```bash
git clone https://github.com/BenXsha/uxship.git && cd uxship
npm run install:server && npm run install:plugin && npm run install:penpot
npm run build:server

# 启动服务端（HTTP/SSE 走 127.0.0.1:15490，插件 hub 走 127.0.0.1:15489）
node mcp-server/dist/index.js --http
```

然后把你的 MCP 客户端指向 `http://127.0.0.1:15490/sse`，打开对应宿主的插件
（`plugin-mastergo/` 或 `plugin-penpot/`），在插件面板里点 **「连接」**。

连接是**刻意由用户手动建立**的：何时允许 AI 操作你的画布应该由你决定，服务端不会自己去接。

```bash
npm run server:status     # 服务端在跑吗、插件连上了吗
npm run server:stop
```

## 为什么存在

| | |
|---|---|
| **一套契约，多个画布** | 同一套工具面同时驱动 MasterGo 与 Penpot；第三个画布是**适配器**而不是 fork —— [`docs/adapter-spec.md`](docs/adapter-spec.md) |
| **本地优先** | 无账号、无遥测、无上传链路；渲染与预处理都在本机 —— [`docs/why-local-first.md`](docs/why-local-first.md) |
| **为 agent 预算而设计** | 默认工具面 67 → 20（**−68%**）；结果按**结构**截断（绝不切坏 JSON）并如实上报损失。数字可复现：[`docs/benchmarks.md`](docs/benchmarks.md) |
| **不静默降级** | 宿主表达不了的能力会被显式上报（`skipped` / `available: false` / `hostType`），而不是悄悄丢掉 |

## 支持的画布

**MasterGo** 与 **Penpot**，共用一套契约。两者**并不等价**：字体、单边描边、渐变、网格、令牌模型，
甚至"换组件"这类操作是宿主原生还是模拟实现，都有差异。完整清单（以及**哪些降级是正常的**）见
[`docs/host-differences.md`](docs/host-differences.md)。

## 文档

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | 分层、传输、渲染管线、适配器接缝 |
| [`docs/adapter-spec.md`](docs/adapter-spec.md) | 宿主端口的 54 个成员、能力探测、如何接一个新画布 |
| [`docs/host-differences.md`](docs/host-differences.md) | 已知的双宿主差异清单（每条附判定依据） |
| [`docs/dsl-spec.md`](docs/dsl-spec.md) | 中间表示（DSL） |
| [`docs/mcp-tools.md`](docs/mcp-tools.md) | 工具面、profile、渐进披露 |
| [`docs/benchmarks.md`](docs/benchmarks.md) | 上下文成本、测量方法、以及**没测什么** |
| [`docs/comparison.md`](docs/comparison.md) | 诚实定位（含本项目落后之处） |
| [`docs/why-local-first.md`](docs/why-local-first.md) | 本地优先买到了什么、代价是什么 |
| [`packages/response-budget/README.md`](packages/response-budget/README.md) | 可独立使用的截断库 |
| [`skills/design/`](skills/design/) | 管线所期望的、面向 agent 的设计规则 |

## 仓库结构

```text
mcp-server/                 MCP 服务端：工具、渲染管线、传输、会话路由
plugin-mastergo/            MasterGo 宿主适配器（插件 + UI）
plugin-penpot/              Penpot 宿主适配器（插件 + UI）
packages/response-budget/   独立发布的输出截断库（ESM + CJS）
skills/design/              Agent 消费的设计规则与模板
docs/                       架构与参考文档
scripts/                    门禁、打包、基准、开发工具
```

## 开发

需要 Node 20 / 22 / 24。完整门禁（与 CI 同一套）：

```bash
(cd mcp-server     && npx tsc --noEmit && npm test)     # 699 例
(cd plugin-mastergo && yarn typecheck && yarn test)     # 374 例
(cd plugin-penpot   && yarn typecheck && yarn test)     # 592 例
(cd packages/response-budget && npm test)               #  18 例
npm run build:server && npm run build:plugin && npm run build:penpot
npm run license:check && npm run docs:check && npm run skill:check
```

门禁背后的理由（为什么有些检查看起来异常具体）见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 安全

默认只监听回环，但服务端能创建和删除你文档里的图层。要在回环之外暴露之前先读
[`SECURITY.md`](SECURITY.md)。漏洞请走
[私有安全通告](https://github.com/BenXsha/uxship/security/advisories/new)，不要开公开 issue。

## 声明

与任何设计工具厂商**无关**，未获其背书或赞助。MasterGo、Penpot、Figma 及其他产品名称、标识与
品牌归各自所有者所有。

## 许可

[Apache-2.0](LICENSE) —— 随仓库分发的第三方资产见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
