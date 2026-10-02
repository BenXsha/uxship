# plugin-penpot — uxship for Penpot

uxship 设计管线在 **Penpot** 上的宿主插件。同一份 DSL、同一套客户端渲染引擎与 UI，
通过一层显式的 `HostAdapter` 端口落到第二个设计工具的画布上。

---

## 30 秒上手

```bash
cd plugin-penpot
yarn install
yarn build          # → dist/（插件站点根目录）
yarn serve          # → http://127.0.0.1:4400/manifest.json
```

然后在 Penpot 里：

1. 打开任意设计文件 → **Plugins 菜单**（macOS `⌘⌥P` / Win·Linux `Ctrl+Alt+P`）
2. 填入 manifest URL：`http://127.0.0.1:4400/manifest.json`
3. 打开插件面板，点 **冒烟渲染**

> ⚠️ Chromium 142+ 会弹「私有网络访问」授权（`design.penpot.app` → `localhost`），必须允许；
> Brave 需要对 Penpot 站点关闭 Shield。这是官方也记录的限制。

**冒烟渲染 / 完整样例按钮不依赖任何服务端** —— 它直接把内置 DSL 渲染到画布。
存在的意义是把两条链的排障彻底解耦：

```
插件 ↔ 宿主 ↔ 画布        ← 用自测按钮验证（本仓库已闭环）
插件 ↔ hub ↔ AI          ← 已打通（服务端内置 Penpot 桥，见下）
```

自测画不出东西 → 问题在宿主适配；自测画得出 → 问题一定在网络/协议侧。

---

## 接上 AI（P2 已完成）

服务端（`mcp-server`）内置了**共联单 hub**：一个端口同时接两种插件，
而这个端口就是本插件的默认 hub 地址，无需额外起进程：

```bash
cd ../mcp-server && npm run build && npm start   # 一个 15489 端口，两种插件都连它
```

链路：

```
                                           ┌─ sess_penpot_* → 本插件 UI(WS) ──postMessage──► 插件沙箱 ──► Penpot
AI IDE ──HTTP/SSE/MCP──► BridgeRouter ──ws 15489 ─┤
                                           └─ sess_*        → plugin-mastergo
```

**为什么共用一个端口**：两种插件讲的是同一套 JSON-RPC 协议，按 `initialize` 自述的后端分区
（会话前缀 `sess_` / `sess_penpot_`）即可，用户只需记一个端口。
代价是归属依赖自述 —— 因此**没自述的客户端在共联模式下不会被收编**（宁可不给归属，也不猜）。
需要端口即判别（排障时两条链互不干扰）时开分端口模式：
`UXSHIP_MCP_SEPARATE_PORTS=1`（此时 Penpot 在 4404，本插件用
`PENPOT_HUB_URL=ws://localhost:4404` 重新构建即可）。

**路由靠会话 id 前缀**（`sess_penpot_*`），所以：

| 你想做的事 | 怎么做 |
|---|---|
| 看两个设计工具都连了哪些会话 | `session_list`（每项带 `backend` 字段） |
| 把后续操作全部指向 Penpot | `session_switch({ sessionId: 'sess_penpot_xxx' })` |
| 只让本次调用走 Penpot | 工具参数加 `_sessionId: 'sess_penpot_xxx'` |
| 只有一个后端在线 | 不传会话即自动选中它 |

### 集成契约（改 handler 前先读）

1. **handler 返回裸数据**，不要自己包 `{content:[{type:'text',...}]}`。
   服务端负责包成 MCP `CallToolResult` —— 这与 plugin-mastergo 完全一致
   （两边都是「直接回传 dispatcher 的 response」）。自包会导致双层包裹。
2. `initialize` 响应会带回 `serverInfo.backend`，插件面板会显示它；
   若显示的不是 `penpot`，说明会话被归到了错的后端（面板会显式告警）。
3. 当前活跃的 MCP 客户端只能同时操作一个后端？**不是** ——
   路由按每次调用的会话决定，同一个客户端可以交替操作两个工具。

---

## 架构

```
plugin-penpot/
├── index.html                 # 插件 UI 入口（构建后为 dist/index.html）
├── manifest.json → public/    # Penpot 插件清单（version:2 + 相对路径 + permissions）
├── lib/                       # 插件沙箱（Penpot 的 `code` 上下文，无 DOM，有全局 penpot）
│   ├── main.ts                #   只做三件事：装宿主、开 UI、把请求交给 dispatcher
│   ├── dispatcher.ts          #   JSON-RPC 调度（移植自 plugin-mastergo，注入 host）
│   ├── cache-policy.ts        #   响应缓存白名单（移植）
├── lib/host/                  # HostAdapter 端口 + penpot/memory 两个实现
│   ├── types.ts               #   ★ HostAdapter 接口（本轮核心产物）
│   ├── penpot.ts              #   Penpot 实现（唯一的 penpot.* 出口）
│   ├── memory.ts              #   内存实现（单测 / 离线下跑）
│   ├── color.ts               #   ★ 颜色四形态归一（hex / rgb() / rgba() / {r,g,b,a}）
│   ├── gradient.ts            #   ★ 填充类型归一 + 渐变几何换算（含 conic 降级）
│   ├── svg-import.ts          #   ★ 简单 SVG → 单条可编辑矢量路径（Path.d）
│   ├── apply-order.ts         #     属性应用顺序（正确性约束，见文件头）
│   └── index.ts               #     安装 / 探测 / 安全取用
│   ├── dsl/                   #   DSL 层（与宿主无关）
│   │   ├── types.ts           #     DSL 子集（字段名与 MasterGo 侧逐字一致）
│   │   ├── renderer.ts        #     DSL → HostAdapter 调用（纯编排，零宿主 API）
│   │   └── sample.ts          #     内置样例（刻意覆盖每处已知宿主差异）
│   ├── api/                   #   handler 注册表（方法名与 MasterGo 侧一致）
│   └── utils/                 #   Logger / Utils / JSON-RPC 类型（移植）
├── ui/                        # 插件 UI iframe（Penpot 的 `ui`，有 DOM/WebSocket）
│   ├── App.vue                #   连接面板 + 宿主能力 + 自测 + 日志
│   ├── composables/
│   │   ├── useMCPConnection.ts#   ★ WS + JSON-RPC 客户端（移植自 plugin-mastergo，596 行）
│   │   └── useLogger.ts
│   └── styles.css             #   设计令牌（按角色命名，WCAG AA）
├── messages/sender.ts         # 插件 ↔ UI 消息协议（枚举值与 plugin-mastergo 逐字对齐）
├── tests/                     # 142 个用例
│   ├── helpers/fake-penpot.ts #   ★ 宿主替身（复刻了 3 个真实宿主怪癖）
│   ├── penpot-host.test.ts    #   映射正确性
│   ├── dsl-renderer.test.ts   #   编排与时序
│   ├── dispatcher.test.ts     #   JSON-RPC / 缓存 / handler
│   ├── tailwind-resolver.test.ts # Tailwind 白名单覆盖（随引擎一起移植）
│   └── host-isolation.test.ts #   ★ 宿主隔离门禁（R1–R4，防止抽象退化）
├── dev/harness.html + .ts     # ★ 客户端渲染 harness（真实浏览器里跑全链路）
├── scripts/verify-bundle.mjs  # ★ 打包产物验证（假宿主跑 dist/plugin.js）
└── typings/penpot.d.ts        # Penpot Plugin API 子集声明（不依赖 @penpot/plugin-types）
```

### 为什么 WS 在 UI 而不是插件沙箱

这不是随意选择：**Penpot 官方 MCP 插件的 WebSocket 也开在 UI iframe 里**，而 plugin-mastergo 的
`ui/composables/useMCPConnection.ts` 恰好是同样的结构。两边同构，因此那 596 行一行未改。

### `HostAdapter` 是唯一的宿主出口

```ts
// ✅ 允许
await context.host.applyProperties(node, { layoutMode: 'VERTICAL', itemSpacing: 16 })

// ❌ 禁止（会破坏移植性；应写进 lib/host/penpot.ts）
penpot.createBoard()
```

`tests` 里对 `lib/**` 之外的代码做静态检查即可守住这条线（见「约定」）。

---

## 插件方法覆盖（**55 / 55**）

服务端共期望 55 个插件方法（`mcp-server/src/utils/tools.ts` 的 `PLUGIN_REGISTERED_METHODS`），
Penpot 侧**全部 55 个已接线**。分三类，边界都写在响应里：

| 类别 | 代表 | 说明 |
|---|---|---|
| **原生直连** | `node/*`、`page/*`、`style/*`、`variable/*`、`canvas/*` | 宿主 API 直接可用 |
| **插件端合成** | `node/swapComponent` | 宿主没有原语，用已有原语拼出语义（见下） |
| **预设/分析层** | `component/render`、`component/stateMatrix`、`design/describe`、`library/registerStyles`、`dsl/export*` | 只依赖 HostAdapter 原语 → 两个宿主通用 |

**仍然做不到的只有 `page/delete`**（`Page` 只暴露 `id/name/root/getShapeById/createFlow`，
也没有 `penpot.deletePage`）→ 返回 `available:false` + 原因 + 替代方案，而不是 `Method not found`。

### `component/render`：预设写成 **DSL 模板**，而不是照抄 2,957 行命令式代码

MasterGo 侧的 33 个预设是 `makeNode('frame', {...})` 堆出来的，且和 `design-theme` 的几十个
token 耦合。本项目已经把「画布怎么写」收敛进 **DSL 渲染器**（唯一一处知道怎么在宿主落节点、
且带降级上报/字体加载/尺寸结算/边框模拟的地方），所以预设写成 `DSLElement` 字面量
（每个 10–25 行），再交给同一个渲染器落地。好处：宿主无关、人能读、AI 能改（`dsl/render` 吃同一份结构）。

- 已移植 **15/33**（原子/高频那批：button、text-input、badge、tag、avatar、checkbox、radio、
  toggle、spinner、divider、progress、alert、card、tooltip、skeleton）；
- 未移植的类型**不兜底成别的东西** → `available:false` + `supportedTypes` / `unsupportedTypes` + 指引；
- 尺寸用**文本宽度估算**（照抄 MasterGo 的 `estCharW = fontSize * 0.5`）给显式值，
  而不是靠 hug：这样两个宿主结果一致，也避免"渲染成功但节点是 0×0"（这条被测试钉住）。

### `dsl/exportNode` / `dsl/exportSelection`：画布 → DSL（闭环）

宿主无关的反向导出器（`lib/dsl/exporter.ts`）。字段名**逐字对齐 DSL 规范**（`content` 而非
`characters`、`position`/`size` 而非 x/y），所以 `导出 → 渲染 → 再导出` 两次结果一致 ——
这条**往返闭环**就是测试里的核心断言。

拿不到的**不编**，写进 `_notes`：`svg-raw` 无 markup getter（Penpot 未暴露 SVG 源码）、
实例取不到 componentId、`depth`/`maxNodes` 截断。组件实例按 MasterGo 的约定导出成
`frame` + `componentId` + `isExpandedInstance`（导出的树逐字可再渲染，不依赖目标文档里还有该组件）。

**单边描边往返**：Penpot 侧的四边框是叠加 Path 模拟的，规格记在 `mgmcp:sideBorderSpecs` ——
导出时靠它还原成 `strokeTopWeight/Right/Bottom/Left`，同时跳过那条合成 Path
（否则"模拟的边框"往返一次就退化成整圈描边）。

### `node/align`：对象**之间**的对齐 / 等距分布

⚠️ 与「容器内对齐」是两件事，别混：

| | 容器内对齐 | **对象之间对齐**（本方法） |
|---|---|---|
| 改什么 | flex 容器的 `primaryAxisAlignItems` / `counterAxisAlignItems` | **各对象的 x/y** |
| 谁在用 | DSL 字段（早就支持）；服务端指令引擎关键词 `居中对齐/左对齐/两端对齐` | 服务端 `design_suggest` 的**多对象**指令（`把这三个对象左对齐` / `等距分布`） |
| 宿主原语 | `board.flex.alignItems` 等 | `alignHorizontal/Vertical`、`distributeHorizontal/Vertical` |

实现：**宿主原生优先**（与该宿主 UI 行为一致），失败或旧宿主回落到 `lib/align.ts` 的几何口径
（对齐到**选区包围盒**、分布按**相邻间隙相等**、两端固定）。返回值带 `path: 'native' | 'geometry'`，
并用**前后坐标**量出 `moved`（不是"调过 API 就算动了"）。

⚠️ 两条路径的"对齐参考系"可能不同：Penpot 文档只写 *"relative to one of them"*，没说是哪一个；
本项目几何口径是选区包围盒。真机上若与预期不符，用 `node_update` 手动修，或改用几何口径。

另一个易踩点：**自动布局（flex）父层内的对象**，位置由布局决定 —— 写 x/y 不生效。
这种情况**即使零位移也会在 `notes` 与每个节点的 `skipped: 'flex-parent'` 里如实标注**
（否则"请求对齐一组本来就已左对齐的 flex 子元素"会看起来成功、其实什么都没做）。

### `component/stateMatrix`：走 Penpot **原生变体**

`createVariantFromComponents(boards)` → `Variants.addProperty() + renameProperty(0, name)` →
按**母版形状 id 配对**（不能依赖 `variantComponents()` 的顺序，配错会把 hover 的样式标成 disabled）
逐个 `setVariantProperty(0, value)`。宿主不支持变体时降级为 `DS_<State>` 命名并如实说明。

状态视觉**只做无需品牌信息就能确定的**（hover/active 加深填充、disabled 降不透明度），
需要品牌色的（focused 焦点环、error 语义色）不猜 → 列进 `presetsSkipped`。

### `library/registerStyles` / `design/describe`

- `library/registerStyles`：识别规则**简单可预测**（色板 = 纯色填充 + 名字含角色词；排版 = 文本节点），
  渐变/图片填充与无名图层跳过并汇总报出；`lineHeight` 的 `PIXELS/PERCENT` 会换算成 Penpot 的字符串口径。
- `design/describe`：轻量结构化摘要（比 DSL 小 60–80%）。`type` **归一化到跨宿主共享词汇**
  （`frame`/`text`/`rect`…，宿主原生词放 `hostType`），这样同一句 `design_suggest` 指令两个宿主都能用。

**`node/swapComponent` 已在插件端合成实现**（不再是降级）。
Penpot 没有"换主组件"的写入路径（`instance.component()` 只读），但这件事能用已有原语拼出来：

```
建实例 → 插回原父层与原图层顺序 → 继承位置/尺寸/名字
      → 按图层名带过文字/可见性 → 默认删原对象
```

照抄 MasterGo 侧的语义：`keepSize`（缺省 true）/ `keepOriginal` / `carryOverOverrides`（缺省 true）/
`variantProperties`（走 `switchVariant`）/ 批量 `nodeIds[]` + `useSelection` 回退选区 / 逐项回报；
被替换对象是**组件母版**则拒绝。明确不做并如实说明：`ukey`（MasterGo 专有）、`properties`
（组件属性插槽，Penpot 无此概念）、`resetOverrides`（新实例天然无覆写）。

> 这与「单边描边用叠加 Path 模拟」是同一条思路：**宿主缺的能力，用宿主已有的原语在插件端合成**，
> 从而对 MCP 保持接口不变。

**`page/delete` 确实做不到**（返回 `available:false` + 原因 + 替代方案，而不是 `Method not found`）：
`Page` 只暴露 `id/name/root/getShapeById/createFlow`，也没有 `penpot.deletePage`
→ 页面增删在 Penpot UI 里做；插件侧可用的只有 `page_create/switch/rename`。

另有两处**模型差异**已在响应里显式带出（不假装两边一样）：

- `variable/list` 带 `model: 'penpot-tokens'` 与说明：Penpot 用 `TokenSet` + `TokenTheme`（主题＝激活哪些集合），**没有变量的多模式取值**，值统一放在 `default` 伪模式；类型词表两边不同，故同时给 `type`（近似 MasterGo）与 `hostType`（原始）。← 而 Penpot 的 `token.applyToShapes()` 是**真绑定**，是 MasterGo 侧当前缺的能力。
- `teamLibrary/importStyle` 带说明：Penpot **不需要把团队库样式拷贝进本文件** —— 库一旦连接即可直接用（改样式全稿联动），因此"导入"= 确认可用（可选顺带应用到节点）。`ukey` 是 MasterGo 专有，如实返回 `available:false`。

---

## 与 MasterGo 侧的差异（必须知道的降级）

| 能力 | 本插件现状 | 原因 |
|---|---|---|
| **子节点顺序** | ✅ `init()` 打开 Penpot 的 `naturalChildOrdering` flag | Penpot 默认关着它：`appendChild`/`insertChild(N,…)` 会插到**最前**（非 flex 容器），而 `getChildren` 对 flex 容器返回**内部反向顺序**。打开后三处都变成 Figma 语义（追加=末尾、children=自然顺序），与 MasterGo 一致；关着的状态会写进 `capabilities.ops.naturalChildOrdering` 并在不可用时告警 |
| **宿主默认涂色** | ✅ 创建后立即抹掉 | Penpot 的新建图形自带涂色（`shape.cljc` 的 `minimal-*-attrs`）：**Board → 白色填充**、Rectangle/Ellipse → 灰色填充 (`#B1B2B5`)、**Path → 黑色 1px 居中描边**。而 HTML/DSL 的语义是「没写背景就是透明」（MasterGo 侧新建 frame 也是透明的）—— 不抹就会凭空多出白色背景 / 灰块 / 图标黑边。**文本例外**（保留宿主默认色，否则文字会消失） |
| 纯色填充/文字色/阴影色 | ✅ 四种色值形态全接受（`hex` / `rgb()` / `rgba()` / **`{r,g,b,a}` 对象**） | 客户端渲染引擎产出的是 `{r,g,b,a}` 对象，且 `alpha` / `isVisible` 也是它的命名 —— 只认 hex + `opacity` 会让**所有颜色静默失效** |
| 渐变填充（linear / radial） | ✅ 完整映射：`gradientHandlePositions`（0–1 归一）→ Penpot 的 `startX/startY/endX/endY`；radial 的椭圆比例（`transform[0][0]` = rx/r）→ Penpot 的 `width` | 见 `frontend/src/app/main/ui/shapes/gradients.cljs`：linear 用 `x1/y1/x2/y2`，radial 用 `cx/cy/r` + `scale(width)` |
| **渐变描边（边框渐变）** | ✅ 映射到 Penpot 的 `strokeColorGradient` | 这是边框渐变在 Penpot 上的**唯一**正确表达方式；按纯色处理会直接丢掉渐变 |
| conic / diamond 渐变 | ⚠️ 降级为**第一个色标的纯色**并如实报告 | Penpot 只有 linear / radial。降级为纯色而不是丢弃，避免元素变成透明 |
| `data-icon` 图标（`frame + svgContent`） | ✅ 导成**一条可编辑矢量路径**（`Path.d`），颜色与尺寸都带过去 | `createShapeFromSvg` 返回的 Group 尺寸由子元素推导、`resize()` 基本无效；`Path.d` 是可写的（官方 api_types.yml），因此能正常 resize / 改色 / 在 flex 里伸缩 |
| 多色 / 含 transform / 含位图的 SVG | ⚠️ 回退 `createShapeFromSvg`（保色优先）并保留原貌 | 烘焙变换会把图形画错，而多色没法用一条 Path 表达 |
| 描边型图标（Lucide/Feather 风格） | ✅ 导成 `Path` + `stroke`（不是错误地填充） | 根标签 `<svg fill="none" stroke=...>` 的 paint 会被子元素继承，解析器已处理 |
| **单边描边**（`strokeTopWeight` 等） | ✅ **用叠加矢量路径模拟**（不再是降级） | Penpot **插件 API** 没有 per-side（内部模型其实有 `:stroke-width-top/right/bottom/left`，但 `app.plugins.parser/parse-stroke` 不认 → 上游补 4 个字段即可开放）。本插件把需要的边画成 Path 的描边：同色同宽的多条边合并为**一条多子路径 Path**，命名为 `Border Bottom` 等，落地后仍可改色/改宽；重渲染幂等（id 记在 pluginData）。四边同宽时走原生整圈。**刻意用描边而非填充梯形**：落地后在 Penpot 的 Strokes 面板里就是正常描边，设计师能直接改色/改宽（代价：相邻两边异色时角部是一个 `w×w` 小方块，非对角切分） |
| 分角圆角 | ✅ 映射为 `borderRadiusTopLeft` 等四成员 | — |
| `layoutPositioning: ABSOLUTE` | ✅ 映射为 `layoutChild.absolute` | — |
| `<img src>` 图片 | ✅ 自动走 `uploadMediaUrl`（带同 URL 缓存，失败如实降级） | Penpot 后端代拉，不受插件 iframe 的 CORS 限制 |
| `instance` / `boolean_operation` / `polygon` / `star` / `line` / `connector` | 进 `skipped`（不静默） | 尚未映射 |
| `textSegments`（局部文本样式） | 进 `skipped` | 尚未接线 |
| `commitUndo` | 不需要（Penpot 自管 undo） | — |
| **设计令牌绑定** | ✅ **比 MasterGo 侧强**（`shape.applyToken()` 真绑定） | 见分析报告 §10 建议反向吸收 |
| **组件变体** | 原生 `createVariantFromComponents` + `Variants` | 比「命名约定 + 手工 Combine」更原生 |

`report.skipped` 非空即表示设计与 DSL 不完全一致。**请务必检查它** ——
这也是 `dsl/spec` 返回 `nullVsBest.knownDegradations` 的原因。

---

## 命令

| 命令 | 说明 |
|---|---|
| `yarn dev` | 双 target 监听构建（ui + main） |
| `yarn build` | 构建到 `dist/`（`TARGET=ui` → `index.html`；`TARGET=main` → `plugin.js`） |
| `yarn serve` | 起插件站点（零依赖，带 CORS），默认 `127.0.0.1:4405`（避开官方 MCP 的 4400–4403） |
| `yarn test` | vitest（**420 用例 / 21 文件**，跑**源码**） |
| **`yarn test:bundle`** | **先构建，再拿假宿主跑 `dist/plugin.js` 的冒烟 + 完整自测（跑**打包产物**）** |
| `yarn harness:build` / `harness:serve` | 客户端渲染 harness（真实浏览器里跑 HTML → DSL → 宿主，默认 `127.0.0.1:4406`，见下） |
| **`yarn verify:visual`** | **逐框量墨迹**：导出 PNG → 框内 / 紧邻外圈 / 最近墨迹距离（跑位与被裁的判据） |
| **`yarn harness:render`** | 离线打印**引擎实测产出的 DSL**（二分"引擎给错尺寸" vs "宿主没兑现"） |
| **`yarn ui:shot`** | 面板截图 + **DOM 断言**：假 hub 推真实 `task/*` 通知、注入选区消息 |
| **`yarn diff:selection`** | **选区对比**：在 Penpot 里同时选中「预期」与「实际」两个画板，逐节点 diff（忽略整体平移与 ≤1px 抖动） |
| `yarn test:bundle` | 打包产物门禁：先 build，再用假宿主跑 `dist/plugin.js`，**并断言降级项只有预期的那一项** |
| `yarn typecheck` | `tsc --noEmit` |

### 为什么 `yarn test` 不够：必须再跑一次 `test:bundle`

单测跑的是 **源码**（vitest 直接 import `.ts`），而 Penpot 跑的是 **打包压缩后的 IIFE**。
两者会分开出事的地方只有打包器：tree-shaking、压缩重命名、作用域提升。

真实教训：改 `dsl/renderer.ts` 时分两步写入了「调用点」与「函数定义」，中间那个窗口里
watch 构建产出过一个有调用无定义的包，Penpot 里报 `xxx is not a function`，
而当前源码里搜不到任何痕迹 —— 排查方向完全错。

所以：**改完 `lib/` 后跑 `yarn test:bundle`**（它会先 build，再用假宿主加载 dist/plugin.js，
走一遍 握手 → SELF_TEST → dsl/render，断言拿到 `methodResult` 而不是 `methodError`）。

### 防“跑的是旧包”

`yarn serve` 启动时会比较**产物的 mtime 与最新源码的 mtime**，产物偏旧会直接报警：

```
⚠️  产物比源码旧（42s，最新：lib/host/types.ts）—— 请先 yarn build
```

在 Penpot 里看到“源码里不存在的错误”时，先确认这行输出。

### 面板里的两个样例各管一段

| 按钮 | 素材 | 它证明什么 |
|---|---|---|
| **冒烟渲染** | `SMOKE_DSL`（3 个节点） | 宿主是否接通。要求**零降级** |
| **完整样例** | `SAMPLE_DSL`（**能力点检卡**，55 个节点） | 每项跨宿主差异是否都落地 |
| **HTML → 画布 / 完整样例** | `ui/sample-html.ts` | HTML→实测像素→DSL 整条链（含内联 SVG 里的 polygon/star/path） |

`SAMPLE_DSL` 的定位是**能力点检卡**，不是"好看的稿子"：形状（含逃生口 polygon/star/line/pen）、
三种渐变（含 conic 的诚实降级）、四类特效、单边与渐变描边、文本字重/对齐、半透明分隔线、
group 两段式创建 —— 每项都对应一个已知差异。

因此它的**降级项清单就是一张体检表**：只允许出现明确预期的那一项（conic）；
多出任何一项都说明某处能力退化了。这条断言同时存在于单测（`tests/sample-dsl.test.ts`）
与打包产物门禁（`scripts/verify-bundle.mjs`）—— 后者跑的是压缩后的真 bundle，
所以还能抓到"单测过、真机挂"的打包期问题。

### 写 HTML / DSL 前必须知道的两条语义（真机踩出来的）

| 语义 | 说明 |
|---|---|
| **`position` 是「父层内坐标」** | 与 MasterGo 的 `node.x` 一致。而 Penpot 的 `shape.x/y` 对**非 flex 子层是页面绝对坐标** —— 渲染器负责换算（非 flex 父层走 `relativeToParent`，flex 父层交给布局、位置字段不传）。**不要**在 DSL 里写页面绝对坐标 |
| **preflight 由解析器补，但只在"渲染的那棵子树"里** | 这条链路**不加载任何 Tailwind CSS**，class 全部由 `tailwind-resolver` 翻成内联样式，所以 Tailwind preflight 的两条被显式补上：一律 `box-sizing: border-box`、自带 UA margin 的标签（`p` 等）在作者没写 margin 类时归零。**否则**框高会整体偏高（包文字的容器 20 → 48）、框宽偏大（`w-[300px] p-[14px]` → 328） |

完整清单（六个缺陷 + 三次量具翻车 + 三个离线仪器）见分析报告 **§14**。

### 端到端复现样例

`dev/samples/login-page.html`（一页登录页，1440×900）是**已入库**的复现输入 ——
把它交给 `code_to_design` 就能跑通「HTML+Tailwind → 实测像素 → DSL → 画布」整条链，
再用上面的离线仪器核对。它刻意覆盖了真机上翻过车的几类（渐变/阴影/圆角、
`data-icon` 图标、文本包裹层与盒模型、字重与中文字族），历史缺陷与实测数字见分析报告 §14。

### 离线仪器：三个脚本何时用

| 症状 | 用哪个 | 它给什么 |
|---|---|---|
| 画布上"看起来不对"（跑位/被裁/空框） | `yarn verify:visual --node <rootId>` | 每个小容器的框内墨迹、紧邻外圈墨迹、空框时的最近墨迹距离 |
| 尺寸/布局不对 | `yarn harness:render <file.html>` | **引擎实测产出的 DSL**（逐节点 size/布局字段）—— 先分清是引擎给错还是宿主没兑现 |
| 面板不对（卡片不出现、颜色不对、接线没接上） | `yarn ui:shot` | 各状态的截图 + **DOM 事实清单**（卡片在不在、步骤状态、进度条宽度、computed 色值、代码框内容高） |

### 选区对比（排视觉问题的主力工具）

```bash
# 在 Penpot 里同时选中两个画板（第一个=预期，第二个=实际），然后：
yarn diff:selection
# 或：node scripts/diff-selection.mjs --port 15490 --session sess_penpot_xxx
```

视觉问题靠肉眼只能看出"不对"，看不出**哪一层、哪个属性**不对。这个工具直接给出字段级差异，例如：

```
── [0/0/4/0] Border Top  (path)
     x          A=20
                B=499        ← 父层在 519；说明读到了「未结算的位置」
```

它就是发现「边框整体偏移」与「图标 16px 偏移」的原因的工具 —— 建议每次渲染后都跑一次。

### 客户端渲染 harness

```bash
yarn harness:build && yarn harness:serve   # http://127.0.0.1:4406/dev/harness.html
```

在真实浏览器里跑完整链：`HTML → 浏览器排版 → 实测像素 → DSL → MemoryHost（与服务端同一份渲染器）`，
每个检查项渲染到页面的 `#harness-summary`。这是唯一能验证“布局真的是对的”的方式 ——
jsdom / happy-dom **没有布局引擎**，在它们里测只能证明“不报错”。

⚠️ `chrome-headless-shell` 不触发 `requestAnimationFrame`，会卡在第一个样例；
无头环境请用带合成器的 Chrome（`--headless=new`）。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PENPOT_HUB_URL` | `ws://localhost:15489` | hub 地址（构建期注入为 `__DEFAULT_HUB_URL__`）。服务端默认共联单 hub 就在 15489；分端口模式改成 `ws://localhost:4404` |
| `PENPOT_PLUGIN_PORT` / `--port` | `4400` | 插件站点端口 |
| `PENPOT_PLUGIN_HOST` / `--host` | `127.0.0.1` | 插件站点监听地址 |

`tests` 里有自动门禁（`tests/host-isolation.test.ts`）守住这几条纪律，不靠自觉。

---

## 面板（UI）都显示什么

| 区块 | 数据来源 | 说明 |
|---|---|---|
| **常驻状态球**（粘性顶栏） | 综合连接状态 / 在忙 / 任务进度 / 选中数 | Siri 式形变光斑（4 片 + 珍珠核心）+ 处理中旋转光轨（转速与色相随进度）+ 完成/失败光晕 + 步骤切换闪动 + 悬停多行浮层。**点它 = 把插件窗口折叠成这颗球**（再点展开） |
| MCP 服务端 | UI 自己持有的 WebSocket | 连接按钮是**手动**的（何时允许 AI 操作画布由用户决定），另带「处理中」指示（一次工具调用在途） |
| 任务步骤 | 服务端推的 `task/plan` · `task/step` · `task/complete` | 进度条 + 步骤三态（✓ / 转圈 / 待办）+ 摘要 + 计数 + 实时耗时 |
| 选中 | 沙箱推的 `SELECTION_CHANGED`（宿主 `observeSelection`） | 只展示：个数 + 类型 + 名称（超量截断、读失败保留上次列表） |
| 宿主与文档 | 沙箱 `statusChanged` | 文档/页面/插件版本 + 宿主能力清单（哪些是降级） |
| 日志 | 本地 | 含每次渲染的降级项与未解析 class（也是"被隐藏的调试信息"的落点） |
| **（调试模式才显示）** 本地自测 | 不经网络：直接驱动沙箱渲染内置 DSL | 把「插件↔宿主↔画布」与「插件↔hub↔AI」两条链的排障解耦 |
| **（调试模式才显示）** HTML → 画布 | 不经服务端：UI 内真实渲染 HTML+Tailwind → DSL → 沙箱 | 把「引擎」与「网络」两类问题分开定位 |
| **（调试模式才显示）** 宿主能力清单 | 沙箱 `statusChanged` | 哪些能力是降级（琥珀色徽标） |

### 调试模式（默认隐藏开发期区块）

日常使用只需要"连接 / 选中 / 任务进度 / 宿主与文档 / 日志"，其余**开发期区块默认隐藏**：

- 隐藏清单：本地自测、HTML → 画布、宿主能力清单、以及"宿主夹了窗口尺寸"这类说明条；
- **打开方式**：点顶栏里那个版本号（`v0.1.0`）—— 刻意不做成按钮，但 `title` 写明了；
  状态记在 `localStorage`，也支持 `?debug=1`（优先级：存储里明确记过就听存储的 → 否则看查询串 → 否则关）；
- 🔴 **隐藏 ≠ 静默**：被隐藏的说明条（例如"宿主把窗口尺寸从 132×132 调成了 W×H"）会**同时写进日志** ——
  面板可以干净，问题不能消失。

状态球与紧凑模式（移植 plugin-mastergo 的 `CompactBall` 体验）：

- **紧凑模式靠 `penpot.ui.resize(width, height)` 实现**（官方 API，另有 `penpot.ui.size` 可读），
  折叠成 `132×132`、展开回 `400×560`（与 `lib/main.ts` 里 `open()` 的初始尺寸一致）。
- 🔴 **调用必须在沙箱里**：`penpot.ui.*` 只存在于插件沙箱（`code` 上下文），
  **UI iframe 里没有 `penpot` 全局**。所以链路是
  `UI 发 UIMessage.RESIZE → 沙箱 lib/ui-size.ts#applyUiSize → penpot.ui.resize + 读回 size → 回 UI_RESIZED`。
  （第一版把 `resize` 写在 UI 侧读 `globalThis.penpot` —— 真机点下去只会得到兜底提示，
  因为那一侧根本没有这个对象。协议里本来是就有 `UIMessage.RESIZE` 的。）
- ⚠️ 官方在 `open()` 的说明里提到窗口尺寸有 **min/max 限制**但未给数值，所以实现是
  「请求 → **读回 `ui.size`** → 以实际值为准」：被宿主夹大时**两种形态都会显示说明条**
  （`useCompactMode` 的 `notes`），写明实际拿到的尺寸，不假装成功。紧凑态布局也做居中，
  被夹成较大窗口时球仍居中。
  → 如果你在真机上看到「宿主把窗口尺寸从 132×132 调成了 W×H」，把那个 **W×H** 告诉我，
  我就把紧凑尺寸直接设成宿主的 min，不再依赖读回兜底。
- 脱离插件环境（harness / `yarn ui:shot` / 纯浏览器打开 UI）没有 `penpot.ui` 时**优雅降级**：
  视觉切换照常，尺寸不动，并记一条说明。

两个刻意的设计取舍：

1. **任务成功会自动收起（2.6s），失败保留**。完成卡片留在窄面板上会挡住下面内容，
   而"成功"不需要细看；失败要留着让人读原因。运行态用**靛蓝**、青绿只表示成功
   （否则同一个绿在同一张卡里既表示"正在跑"又表示"已完成"）。
2. **没有「把选中对象发给 AI」按钮**。plugin-mastergo 有这个按钮（推 `context/update` 通知），
   但该功能已下线，且服务端 `handleNotification` 是空实现 —— 这条通知**从来没被处理过**，
   照搬只会得到死按钮。AI 需要选区数据时直接调 `dsl_export_selection`。

面板类问题的验证不需要开 Penpot：`yarn ui:shot` 会起一个**假 hub** 推真实 `task/*` 通知、
注入选区消息，逐节点截图并输出 **DOM 事实清单**（卡片在不在、步骤状态、进度条宽度、
computed 色值、代码框内容高）—— 用这些断言替代"看截图猜"。

---

## 约定

### 🔴 说"宿主做不到"之前，先 grep `api.yml`

这条是**用返工换来的**：同类错误已经出现三次，全都源于同一个动作 ——
从"我用过的那部分 API"推断"宿主没有这个能力"：

| 我写下的结论 | 事实 | 代价 |
|---|---|---|
| "Penpot 面板尺寸在 `open()` 时定死，没有折叠通路" | 有 `penpot.ui.resize` / `penpot.ui.size` | 白绕一圈，且错注释在三个文件里躺了一轮 |
| "`instance.component()` 只读，没有换主组件的写入路径" | 有 `shape.swapComponent(component)`（文档明写"就是 UI 里那个动作"） | 手写约 600 行合成实现；宿主的原生实现**比我更保真**（真覆写保留） |
| "`svg-raw` 无法回读 markup"（写成"导不出来"） | 单节点确实无 getter；但 `penpot.generateMarkup(shapes, {type:'svg'})` 可导出 | 导出器丢了一条能力 |
| 按成员名理解：把 `isComponentRoot()` 当成"是组件母版" | 官方说明是 *"the root of a component tree"* —— **副本实例的根也为真**；判母版要用 `isComponentMainInstance()`、判副本用 `isComponentCopyInstance()` | 把用户选中的**副本实例**判成母版；`node/swapComponent` 的母版拒绝逻辑跟着错 |

**规则（两条，第二条是加了第 4 次翻车之后补的）**：

1. 凡是要写"宿主做不到 / 没有 X"，先在官方 `api.yml` 里 grep `X` 的成员，
   把**命中原文（或确认无命中的证据）**贴进注释；
2. **读懂成员名 ≠ 读懂它的语义** —— 必须读该成员的**说明文本**（`api.yml` 里每段 ``` 之后的描述），
   再决定怎么用。`isComponentInstance` / `isComponentRoot` 就是名字看着像、语义完全不是的典型。

全量对账口径：逐条 grep 官方 `api.yml` 后归成三类结论
（可换原生 / 确认官方没有 / 可补充）。

## 约定（续）

1. **文档/画布类宿主 API 只允许出现在 Penpot 宿主适配层**
   （`lib/host/penpot.ts` 与同目录下按簇拆出的适配层文件；名单在门禁里**显式列名**，
   当前为 `penpot-runtime.ts` / `penpot-side-borders.ts` / `penpot-tokens.ts` / `penpot-styles.ts` /
   `penpot-components.ts`；`penpot.create*` / `library` / `fonts` / `currentPage` / `viewport` / `selection` …）。
   其余**任何**文件需要宿主能力就走 `HostAdapter`（`lib/host/index.ts` 的 `getHost()`）；
   接口缺什么就补接口，不要就地伸手。**新增适配层文件必须被有意加进门禁白名单**（不许用通配符）。

   > 变更缘由（2026-10-01）：适配层单文件曾达 2874 行，按簇（单边描边 / 组件 / 样式 / 令牌）拆出后，
   > 「宿主调用不外泄」这条保证由门禁的两条**补偿控制**重建 ——
   > ① **方向检查**：适配层模块只允许被 `lib/host/` 内部引用；
   > ② **宿主调用计数下限**：防止某次拆分把宿主调用成批搬空、或搬进一个未登记的文件。
   > 拆簇前的基线：`lib/host/penpot.ts` 单文件 69 处宿主文档类调用（原文匹配，含注释里的 API 名）；
   > 拆簇后适配层合计 74 处，其中**代码行 59 处 —— 与拆簇前只数代码行的 59 相等**。
2. **插件自身的 UI 通道例外**：`penpot.ui.*` 属于消息边界（与设计文档无关），
   允许出现在 `lib/main.ts` 与 `messages/sender.ts`。
3. **全局宿主探测（`typeof penpot`）只在 `lib/host/index.ts`**。
4. **不允许 MasterGo 残留**（`mg.*` / `@mastergo/*`）。

   以上 R1'–R4 由 `tests/host-isolation.test.ts` 自动校验 —— 抽象退化的第一个信号
   （某个 handler 顺手写了 `penpot.selection = [...]`）会被 CI 拦下。

5. **能力缺失抛 `UnsupportedHostFeatureError`**，不要静默降级；上层据此返回
   `available:false`（与 MasterGo 侧 `mg.variables` 缺失的处理口径一致）。
6. **属性级降级写进 `ApplyResult.skipped`**，不要吞掉。静默丢属性会让 AI 把
   「样式没生效」当成「设计就是这样」。
7. **回读校验**：几何类修改（`resize` / `x`,`y`）在 Auto Layout 下可能被引擎覆盖，
   handler 必须回读并返回 `verify`，必要时 `ok:false`（不假成功）。
8. **`resize()` 会打回文本 `growType`**：属性应用顺序由 `lib/host/apply-order.ts` 固定，
   改顺序前先读那个文件的注释。
9. **新建图形后要抹掉宿主默认涂色**：Penpot 会给 Board 白底、给 Rectangle/Ellipse 灰底、
   给 Path 黑描边。宿主测试替身（`tests/helpers/fake-penpot.ts`）必须**照抄这些默认值**，
   否则「没抹干净」这类 bug 在单测里永远看不见（早期替身默认 `fills: []`，比真实宿主“干净”，
   于是白底/灰块/黑边全部漏过）。

---

## 下一步（对应分析报告 §9 路线图）

| 阶段 | 内容 |
|---|---|
| **P2 ✅ 已完成** | 服务端共联单 hub（15489 同时接两种插件）+ `BridgeRouter` 多后端路由（按会话前缀分区）；端到端已验（`mcp-server/scripts/e2e-penpot-router.mjs`），分端口模式亦有覆盖 |
| **P3 ✅ 接线完成** | 客户端渲染引擎已搬入（`ui/composables/useClientRender.ts` 等 6 个文件逐字移植）；`onClientRender` 已接 → `html/render-client` 自动接管；插件面板新增「HTML → 画布」本地入口（不经服务端）；扩展了引擎产出的字段映射（分角圆角 / `ABSOLUTE` / `AUTO` / `blendMode` / `imageUrl→uploadMediaUrl` / `strokeAlign` / `flexWrap` / 轴尺寸模式）；`_unresolvedClasses` 已回传并告警。**浏览器侧真机验证待你手动跑一次**（插件面板「渲染 HTML 到画布」按钮，或 `yarn harness:serve`） |
| **P4（未做）** | 服务端预处理在 Penpot 路径下的复用确认 + tokens / components 双向（Penpot 的 `applyToken` 反向引入 MasterGo 侧） |
| **P5（未做）** | 抽象 `mastergo.ts` 实现回填 `plugin-mastergo`，消除双份代码 |
