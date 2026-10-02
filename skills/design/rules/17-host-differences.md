# 双宿主差异与 Penpot 要点

> 本服务端**同时**支持两个宿主：MasterGo 与 Penpot（默认共联同一个 hub 端口 15489，
> 按 `initialize` 自述分区）。本文是**跨宿主差异的唯一清单** ——
> 写 HTML/DSL 前扫一眼 §2，读渲染结果前扫一眼 §3，就不会把正常现象当 bug。
>
> 全部结论来自真机实测；每条结论在下文都标注了可复现的判定依据。

---

## 0. 每次任务开始：先确认你在哪个宿主上

| 怎么查 | 看什么 |
|---|---|
| `session_list` | 每个会话带 **`backend`**（`mastergo` / `penpot`）、`codename`、文档名、页面名 |
| `plugin_capabilities` | **`host`** + `props` / `ops` 能力位（实际支持取决于宿主版本，**不要凭 typings 猜**） |
| 多会话切换 | `session_switch` 或单次调用带 `_sessionId` |

- 归属是 **fail-closed**：没自述的客户端在共联模式下**不被收编**，声明别的后端**一律拒收**。
  所以出现"连上了但工具落到别处"时先看 `backend`，不要重试。
- 插件与 hub 的连接**由用户手动建立**（面板上点「连接」）——`session_list` 为空时
  直接告知用户去点连接，**不要试着自动拉起**。

---

## 1. 跨宿主**一致**的部分（不必为两个宿主写两套）

- DSL 与 HTML+Tailwind 的写法本身；
- `code_to_design` 主流程（HTML → 浏览器实测像素 → DSL → 画布）；
- **`position` 是「父层内坐标」**（渲染器负责换算成宿主坐标；flex 父层由布局决定位置）；
- 引擎侧已对齐 Tailwind preflight（作者**不必**写 `box-sizing`，也不要依赖 Tailwind 全局样式）；
- `data-icon` 图标（Iconify SVG → 原生可编辑 Path）；
- 文本包裹层约定（`<p>` 包在 `section` 里、横向行内保持子元素类型一致）。

---

## 2. Penpot 侧**硬约束**（写 HTML/DSL 时会直接踩）

### 2.1 字体族：写了不存在的族 = 字体静默退回默认

Penpot 的字体表是 **Google Fonts 镜像（1911 个家族）**，里面**没有** Inter、PingFang、
微软雅黑、思源黑体这些常见名。写了不存在的族（或干脆不写）都会**退回宿主默认字体**。

- 真机实测：不加处理时一页登录页 **20 段文字全部报「字体应用未生效」**；
- 中文可用且确认存在：**`Noto Sans TC`**（覆盖中文，Penpot 字体表里有）；
- 引擎已改为"CSS 里有具体字体族才写 `fontName`，否则只给字重"，
  所以**要在 HTML 里显式指定字体族**，例如根节点 `style="font-family:'Noto Sans TC'"`。

### 2.2 单边描边：用叠加 Path 模拟，角部重叠是**已知取舍**

Penpot 插件 API **没有** per-side 描边字段（`stroke-width-top/right/bottom/left` 只存在于
Penpot 内部模型，插件层未开放 —— 已核对 `app.plugins.parser/parse-stroke` 是 11 键白名单）。
插件的做法：**同色同宽的多条边合并成一条多子路径 Path** 叠加在图形上方。

- **已知代价**：相邻两边颜色/宽度不同时，**角部重叠成 `w×w` 方块**（CSS 是对角切分）。
- 这是设计取舍（可编辑性优先），**不是 bug，不要去"修"**；
- 四边同宽时自动回退原生整圈描边。

### 2.3 conic / diamond 渐变：降级为第一色标纯色

Penpot 的 `Gradient` 只有 `linear` / `radial`。`GRADIENT_ANGULAR`（conic）与
`GRADIENT_DIAMOND` 会被**降级为第一色标的纯色**，并在渲染结果的降级项里上报。

### 2.4 网格（CSS Grid）：Penpot 侧**本插件未接线**

宿主**有** `board.addGridLayout()`（行列轨道、`appendChild(child,row,col)`），
但本插件没实现 `layoutMode: 'GRID'` 的落地 —— 别写 `GRID`，本管线主线是 **flex 自动布局**。

### 2.5 页面增删：Penpot 插件 API **没有**删页能力

`Page` 只暴露 `id/name/root/getShapeById/findShapes/createFlow`，没有 `deletePage`
→ `page/delete` 返回 `available: false` + 替代方案；删页在 Penpot UI 里做。

### 2.6 实例 / 组件：四个标志的**官方语义**（名字不可靠）

| 成员（Penpot） | 官方说明 | 含义 |
|---|---|---|
| `isComponentInstance()` | "inside a component instance" | 在实例**内部**（母版或副本都算，含子节点） |
| `isComponentMainInstance()` | "inside a component **main** instance" | 在**母版**内部 ← 判母版 |
| `isComponentCopyInstance()` | "inside a component **copy** instance" | 在**副本**内部 ← 判副本 |
| `isComponentRoot()` | "the **root of a component tree**" | 组件树的根（**副本的根也为真** → 不区分母版/副本） |

> 血的教训：曾按成员名把 `isComponentRoot()` 当成"是母版"，把用户选中的**副本实例**判成了母版。
> **成员名 ≠ 语义，必须读 `api.yml` 里该成员的说明文本。**

### 2.7 宿主调用是**同步阻塞**的：渲染耗时 ≈ 调用次数 × ~10ms（并发无用）


**原理**：`penpot.*` 是插件 iframe ↔ 宿主之间的**同步**代理 —— `penpot.createBoard()` 直接返回对象、
`shape.width` / `shape.name = ...` 都是同步的读写（见 `lib/host/penpot.ts#applyProperties` 里
"先 `shape.x = …`，后一句就读 `shape.width`" 这种写法）。既然单次调用会**阻塞**到宿主返回，
`Promise.all` / 并发分片**不可能重叠**它们 —— 想快**只能减少调用次数**，不能靠并行。

**真机定价**（2026-10-02，43 节点页面，`report.timing` 实测）：

| 段 | 实测 | 说明 |
|---|---|---|
| `clientRenderMs` | 28 ms | 浏览器排版 → 实测像素 → DSL（Tailwind / 图标 / 字体）|
| `hostRenderMs` | **5737 ms** | 沙箱侧把 DSL 落到画布：≈585 次宿主调用 → **≈10ms/次**（单价随文件变大而上涨，见下文“怎么读”）|

也就是说：**“生成卡”几乎全在宿主调用次数上**，客户端渲染段可以忽略。据此做过的削减（累计 −40% 写往返）：

| 削减项 | 省下 |
|---|---|
| `name` / `width` / `height` / `characters` 不在 `applyProperties` 里重复下发（`createNode` 已落）| −31% 写 |
| 非 flex 父层不发 `layoutPositioning`（宿主必拒）| 每次 1 次调用 + 1 条噪声降级 |
| 图标涂色一次写清（取代「`resetHostDefaultPaint` + 赋值」）| 描边型 −2、填充型 −1 / 图标 |
| `resetHostDefaultPaint` 只清**该类型真有的**默认通道 | board/rect/ellipse −1、path 家族 −1 |
| 同一父层的 `layoutMode` 只回读一次（原先每个带定位的子元素各读一次）| 读往返 N → 1 |

**门禁**：`plugin-penpot/tests/render-host-calls.test.ts` 把一次代表性渲染的宿主调用量**钉成数字**
（计数代理会记下**写过的属性名**），任何让调用数暴涨的改动在 CI 就暴露，而不是等真机变卡。
新增合法属性要同步更新该数字 —— 但先把"变大"当成 bug 查一遍是不是重复下发。

#### ⚠️ 这个计时怎么读才不误判（踩过）

- **同一文档状态下重复渲染：高度可复现** —— 实测同一份 43 节点渲染两次：**6623 / 6630 ms（差 7ms）**，仪器可信。
- **跨文档状态：不可比** —— 同一份渲染在文件变大后从 **5.7s 变成 6.6s**（而它做的调用次数反而更少）。
  所以"改了之后快了/慢了"**不能**靠前后两次真机渲染对比（那是伪 A/B：画布内容、浏览器标签状态都在变），
  要么在**空文档**上比，要么只看**调用次数**（CI 门禁，算术事实）+ **客户端段**（`clientRenderMs`，与文档无关）。
- 真机验收清涂色这类**行为**改动时，直接读节点的 `fills`/`strokes`（`node_get`）—— 别用"渲染耗时"当证据。

#### 刻意不做（**已决策**，别再当"优化空间"重开）

| 项 | 看上去的收益 | 为什么不改（决策理由）|
|---|---|---|
| 图标去掉外层 board，直接用裸 path | 每图标 −6 次调用（43 节点页面上 ~8%）| **保住图标的固有容器比例**：容器是图标在布局里伸缩/对齐的语义载体，裸 path 只剩墨迹尺寸；也会让组件化与回读少一层结构。|
| 元素自带 `fills`/`strokes` 时跳过"预清通道" | 每图形 −1 次调用（~3%）| **清空的通道是后续 token 绑定 / 组件化的干净基线** —— 留着宿主默认涂色会让绑定语义含糊（"这个值到底是谁给的"）。|

---

## 3. 读渲染结果时别误判：Penpot 侧三类**无害降级**

一页渲染的 `skipped` 里出现这些是**正常**的（实测一页登录页 34 条降级全属此类）：

| 降级项 | 为什么会出现 | 影响 |
|---|---|---|
| `clipsContent` | Penpot **只有 board 能裁剪**，frame 上的裁剪请求会被拒 | 无（引擎给每层都发，Penpot 侧只对 board 生效） |
| `layoutPositioning` | 非 flex 子层**没有 layoutChild**（2026-10-02 起已知非 flex 父层**不再下发**，只剩真正不匹配的情形） | 无（这些子层的位置本来就由坐标决定） |
| `strokeJoin`（非 `MITER`） | Penpot 的 stroke 模型**没有** line-join 成员（官方 `Stroke` 只到 `strokeCapStart/End`）→ 拐角只能按 miter 表现 | 可见但通常很轻：圆角/斜角拐点变尖。**`MITER`（引擎对 HTML 边框总会写，而 HTML 边框的 `stroke-linejoin` 本就是默认值）不报** —— 不报不是“静默”，而是两侧行为本就一致。 |

**判断"真出问题"看这三件事**，而不是看降级条数：

1. `unresolvedClasses` 是否非空（Tailwind class 没命中 → 样式丢）；
2. 图标是否真有墨迹 —— 用 `yarn verify:visual`（框内墨迹 0 而框外有墨迹 = 跑位）；
3. `hasStructuralSkips`（结构性降级）。

> 图标 SVG **内部**的 `stroke-linejoin="round"` 同理落不了（`analyzeSimpleSvg` 只提取 `stroke-linecap`）：
> 线条图标的**圆头**现在能保真（Penpot 有 `strokeCapStart/End`），但**圆角拐点**仍按 miter —— 暂无解，属已知限制。

---

## 4. 设计令牌（`variable_*`）：两个宿主模型不同

| | MasterGo | Penpot |
|---|---|---|
| 组织 | Variables / Collections（**支持多模式取值**，如 light/dark） | `TokenSet` + `TokenTheme`（**主题 = 激活哪些集合**）→ **没有多模式**，值统一放 `default` 伪模式 |
| 类型词表 | 一套 | 另一套 → 响应里同时给 `type`（近似 MasterGo）与 **`hostType`（原始）** |
| 绑定 | 逐个属性写值 | **真绑定**：`token.applyToShapes()` / `shape.applyToken()`，改 Token 全稿联动；**直接改属性会解绑** |

→ 读 `variable/list` 时看 `model: 'penpot-tokens'` 与 `note`；不要按"多模式"去解析 Penpot 的返回值。

### 4.1 令牌名是**路径层级**：叶子不能同时是前缀（真机实测）

Penpot 令牌名用 `.` 分层（`system.color.primary`）。**同一集合里不能同时存在 `a.b` 与 `a.b.c`** ——
建 `system.color.primary.hover` 会被拒（`路径 ... 或其前缀处已存在令牌`）。
所以带子级的角色要**打平**：用同级连字符 `system.color.primary-hover` / `system.color.text-muted`。
`data-token-*` 里写的令牌名必须与此一致。

### 4.2 声明式绑定：`data-token-<property>`（P0-3 已落地）

- HTML：`data-token-fill="system.color.primary"` → 渲染末端 `shape.applyToken(token, ['fill'])`；
- **必须在属性写入之后绑定**（"直接写属性即解绑"），所以管线把绑定放在结构/外观/布局/子元素全部落完之后；
- 报告回 `tokenBindings: { requested, bound, failed[] }`，`bound` 来自 `shape.tokens` **回读**，不拿"没报错"当成功；
- 改令牌值后**不会自动回写**已绑形状，必须 `propagateToken`（unbind+rebind）；验收口径是 `matched == rewritten`（真机已验）。

### 4.3 库样式**删不掉** → 注册必须按名 upsert（官方 `api_types.yml` 核实）

官方 API 里 `LibraryColor` 与 `LibraryTypography` **都没有 `remove()`**，`Library` 也没有
`removeColor/removeTypography` —— 即插件 API **无法删除样式**；而 `createColor()`/`createTypography()`
每次都是新建。→ 重复注册会**永久翻倍**（真机实测：同一面板注两次，本地色板 9 → 18）。

所以 `library/registerStyles` 已改为**按名 upsert**（`updateColorStyle`/`updateTextStyle`：命中同名就改写，
否则新建），返回 `counts: { created, updated }` 区分。

- 可写字段（官方非 readonly）：`LibraryColor.color`/`opacity`；`LibraryTypography.fontSize/fontWeight/lineHeight/letterSpacing/name`；
- 字体族仍需 `setFont(font, variant)`（直接写 `fontFamily` 无效）；
- **历史重复样式无法用插件删** —— 只能在 Penpot UI 手动清（如已产生重复）。

### 4.4 `page.findShapes()` 要**功能性探测**（可能恒返回 `[]`）

官方签名：`page.findShapes(criteria?: { name?, nameLike?, type? }): Shape[]`，**无 criteria ⇒ 全页所有形状**
（`doc.plugins.penpot.app/interfaces/Page`）。但社区「MCP/API Issue list」反饋它在某些版本恒返回 `[]`。

→ 本插件不只看方法存不存在，而在 `PenpotHost.supportsFindShapes()` 里做**可证伪**探测：
方法不存在/抛错 → 假；列出了形状 → 真；**有顶层形状却列不出 → 假**；页面为空 → 不缓存（等有形状再判）。
结果为假时全页搜索／令牌传播退回**手写递归**（带 `HOST_SCAN_BUDGET`）。能力位在 `plugin_capabilities.ops.findShapes`。

### 4.5 宿主原生 CSS：`generateStyle` / `generateFontFaces`（P1-5）

- `penpot.generateStyle(shapes, { type:'css', withPrelude?, includeChildren? }): string`（**同步**）
- `penpot.generateFontFaces(shapes): Promise<string>`（**异步**，较新 API）
- 用途：`design_to_code` 的 `options.exportCss`（需 `nodeId`）→ 插件 `style/generateCss` → 响应字段 `hostCss`；
  比从 DSL 手写字段映射更保真（真实 CSS 规则 + `@font-face`）。
- 旧宿主没 `generateFontFaces` 时只回 CSS，并在 `reason` 里说明；能力位 `plugin_capabilities.ops.generateCss`。

### 4.6 富文本区间：`Text.getRange()` / `TextRange`（P2-3）

- `text.getRange(start, end): TextRange`；给 range 赋 `fontSize` / `fontWeight` / `letterSpacing` / `fills`（`Fill[]`）
  即写回该区间样式。
- 读回 run **只能逐字 `getRange`**（Penpot 没有“枚举区间”）；文本 > **120 字**时本插件返回 `[]`
  （`MAX_RUN_SCAN`，逐字往返代价高）——调用方据此退回单 run。
- 非文本节点调用 `applyTextRuns` / `readTextRuns` 抛错（不静默当空）。

---

## 5. 同名工具、不同实现（读响应里的字段就能分辨）

| 工具 | MasterGo | Penpot |
|---|---|---|
| `node_swap_component` | 插件端**合成**（建实例 → 插回原父层与图层顺序 → 继承位置/尺寸/名字 → 按图层名带过文字/可见性 → 删原对象） | **宿主原生 `shape.swapComponent`**（覆写保留由宿主负责）→ 响应里 **`native: true`**；源对象不是副本实例时回落到合成 |
| `node_align` | 对象**之间**对齐/分布（改各对象 x/y），宿主有原生就优先 | 同左（Penpot：`alignHorizontal/Vertical`、`distribute*`） |
| `component_render` | 33 种预设 | **DSL 模板**实现，覆盖 **15/33**；未移植类型返回 **`available:false`** + 已支持清单 + 指引（改用 `dsl/render`） |
| `teamLibrary/importStyle` | 从团队库**拷贝**样式进本文件 | **不需要拷贝**：连接库即可直接用（改样式全稿联动）→ "导入" = 确认可用；`ukey` 是 MasterGo 专有 → `available:false` |

另外注意 `node_align` 与**容器内对齐**是两件事：后者是 flex 容器的
`primaryAxisAlignItems` / `counterAxisAlignItems`（DSL 字段），前者是把多个对象互相摆齐。

---

## 6. 出问题时用这些仪器拿数字（Penpot 侧，都在 `plugin-penpot/`）

| 症状 | 命令 | 给什么 |
|---|---|---|
| 画布上"看起来不对"（跑位/被裁/空框） | `yarn verify:visual --node <rootId>` | 每个小容器的**框内墨迹 / 紧邻外圈 / 最近墨迹距离** |
| 尺寸/布局不对 | `yarn harness:render <file.html>` | **引擎实测产出的 DSL**（逐节点 size/布局字段）→ 二分"引擎给错"还是"宿主没兑现" |
| 面板不对（卡片不出现、颜色不对） | `yarn ui:shot` | 各状态截图 + **DOM 事实清单** |
| 偏移类问题逐节点定位 | `yarn diff:selection` | 选中"预期/实际"两个画板 → 字段级差异 |

端到端复现样例：`plugin-penpot/dev/samples/login-page.html`（一页登录页 1440×900）。

---

## 7. 一条跨宿主通用的纪律

**凡是要写"宿主做不到 / 没有 X"，先查证再落笔**：

1. 运行时探测：`plugin_capabilities`（能力位是**实测**，不是声明）；
2. 官方 `api.yml` 里 grep 成员 **并读它的说明文本**（成员名 ≠ 语义，见 §2.6）；
3. 把命中原文（或确认无命中的证据）贴进注释/文档。

这条规则是用返工换来的：`penpot.ui.resize`、`shape.swapComponent`、`generateMarkup`、
`isComponentRoot` 四处都曾被我凭印象判死或理解错 —— 其中一次导致手写了 600 行本可避免的合成实现。
