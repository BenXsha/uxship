# 已知限制

## 截图复刻限制（Vision Model 能力边界）

从截图/图片识别并复刻页面时，以下问题由视觉模型固有能力限制导致，非代码逻辑缺陷：

### 图标识别偏差

| 问题 | 原因 | 修正策略 |
|------|------|----------|
| 图标选错 | 截图中小图标分辨率低（16-24px 仅几十个像素），模型无法辨认形状细节 | **用户描述替代**：不确定时主动询问"截图中第 X 个图标是什么" |
| 自定义图标不匹配 | 业务自定义图标不在 Remix Icon 标准库中 | **使用占位矩形**：用彩色圆角矩形 + 文字标注代替，后续手动替换 |
| 语义歧义 | "同步中"旋转箭头 vs "刷新"图标，形状相近含义不同 | **通过 `data-name` 标注语义**，如 `data-name="icon-sync"`，后续用 `node_update` 替换为正确图标 |
| 抗锯齿干扰 | 截图压缩后边缘模糊，模型误判形状 | 接受近似匹配，后续微调阶段修正 |

### 颜色提取偏差

| 问题 | 原因 | 修正策略 |
|------|------|----------|
| 背景色偏移 | 截图压缩/显示器色域差异导致色值偏移 ±5-10% | **对话确认品牌色**：主动询问"页面的品牌主色是什么" |
| 浅色背景误判 | `#F0F2F5` 被映射为 `#F3F4F6` 或 `#F9FAFB` | 在 HTML 中显式声明 `bg-[#F0F2F5]`，避免使用近似 Tailwind 预设色 |
| 状态色偏差 | 成功绿 `#10B981` 被映射为 `#22C55E` | 使用精确 hex 值，不依赖模型自动推断 |
| 阴影/渐变干扰 | 抗锯齿像素被识别为独立颜色 | 接受近似值，后续通过 `node_update` 精确调整 |

### 复刻最佳实践

1. **图标处理**：当模型对图标不确定时，优先使用 `ri:question-line` 或彩色占位矩形标注，不要强行猜测
2. **颜色处理**：截图复刻时，所有颜色使用 `bg-[#RRGGBB]`、`text-[#RRGGBB]` 等精确 hex 格式，避免 Tailwind 命名色
3. **文本处理**：截图中的模糊小字可能识别错误，使用 `data-name` 标注语义角色，便于后续 `search_nodes` 批量修正
4. **后置修正**：复刻完成后，使用 `search_nodes` + `node_update` 批量修正颜色、图标、字号

---

## 渲染限制

| 问题 | 说明 | 解决方案 |
|------|------|----------|
| 椭圆渐变填充不生效 | `code_to_design` 渲染椭圆后渐变显示为灰色 | 先通过 `code_to_design` 渲染基础形状，再用 `node_update` 更新 `fills` |
| 填充类型名大小写 | DSL 用全小写，`node/update` 用全大写 | DSL 填小写，node_update 填大写 |
| TextNode 无 `fontSize`/`fontName` 属性 | 不能直接赋值 | MCP handler 已自动处理 `setRangeFontSize()`/`setRangeFontName()`，调用方正常传参即可 |
| `node_create`（批量传 `nodes[]`） 创建 frame 时 `size` 被忽略 | 节点固定为 100×100 | 先 `node_create`（批量传 `nodes[]`） 创建，再用 `node_update` 设置 width/height |
| `node_create`（批量传 `nodes[]`） 不处理 `fontWeight` | 传入 `fontWeight: 600` 后文本仍为 Regular | 改用 `fontName: { family: "Inter", style: "Bold" }` |
| `node_update` 设置 `fontName` 需字体已加载 | 报错 "Cannot use unloaded font" | 先通过 `code_to_design` 渲染任意 HTML 触发字体加载，再执行 node_update |
| 模板嵌套失效（✅ 已修复） | template/tree 展开后 frame children 被展平 | 已修复 — 现使用 `await this.renderElement(child)` + 字体回退机制 |
| 效果（阴影）不显示（✅ 已修复） | `isEffectShow: false` | 已修复 — 转换引擎支持 `shadow-[...]` → `DROP_SHADOW` |

## 转换引擎已知问题（`code_to_design` 内部）

| 问题 | 说明 | 解决 |
|------|------|------|
| 多容器自动检测 VERTICAL 误判 | section 有 ≥2 个子元素且非显式 flex 时自动启用 VERTICAL | 显式使用 `flex-col` 精确控制 |
| `<section>` 无 flex 导致 padding 无法清零 | NONE 模式不支持设置 padding，保持默认 10px | **所有 `<section>` 必须显式声明 `flex`/`flex-col`/`flex-row`** |
| `shadow` 颜色仅支持 hex 和 rgba | CSS 命名色（如 `black`）不支持 | 使用 `#000000` 或 `rgba(0,0,0,0.5)` |
| HORIZONTAL flex 中 text+frame 混合高度不一致 | `<i>`(frame) 被拉伸，`<p>`(text) 保持行高 | 避免混合 `<i>` 和 `<p>` 作为直接子元素 |
| HORIZONTAL flex 3+ 子元素位置异常 | 累计偏移可能挤出容器边界 | 子元素控制在 2 个以内，或全部显式 `w-[Npx]` + `h-[Npx]` |
| `<p>` 标签嵌套误报 | 跨兄弟节点误报 | 不影响转换功能，仅验证警告 |
| **文本 lineHeight 默认 36px** | 未指定 `leading-[Npx]` 时 lineHeight 硬编码为 36px，不随 fontSize 等比缩放 | ✅ `<p>` 必须显式声明 `leading-[Npx]`，比值参考 1.17-1.5x fontSize |
| **`ml-auto` 不影响后续兄弟元素** | `margin-left: auto` 只将自身推至右侧，后续兄弟元素未随动，仍留在原位 | 改用 `justify-between` 分组，或 `SPACE_BETWEEN` + 左/右两个子容器 |
| **VERTICAL auto-FILL 不递归传递** | 子元素的 `layoutSizingHorizontal: 'FILL'` 仅对直接子元素生效，不会递归到孙级；`flex-1` 分配宽度的父容器不会触发子元素 FILL | 使用钉桩修复法：每个需要子元素撑满的 VERTICAL 容器都必须显式 `w-[Npx]`，手动计算传递宽度。详见 `05-pitfalls.md §21` |

## 不支持的 Tailwind Class（白名单限制）

客户端渲染前的解析器 `resolveTailwindStyle`（`plugin-mastergo/ui/composables/tailwind-resolver.ts`）用白名单匹配 class。它认得四类写法：

1. **任意值**：`w-[320px]` / `text-[#333333]` / `leading-[20px]` / `shadow-[...]` / `rounded-[12px]` / `tracking-[0.5px]` / `bg-[rgba(...)]`
2. **刻度写法**：间距与尺寸（`p-4` / `px-6` / `gap-3` / `mt-5` / `w-10`…）、字号（`text-xs`…`text-9xl`）、圆角（`rounded-sm|md|lg|xl|2xl|3xl`）、阴影（`shadow-sm|md|lg|xl|2xl|inner`）、行高（`leading-none|tight|snug|normal|relaxed|loose`）、`opacity-50`、`z-10`
3. **颜色**：`white` / `black` / `transparent` + **gray / slate 调色板**（如 `bg-white`、`text-gray-900`、`border-slate-200`）——仅限这两个调色板系列
4. **工具类白名单**：`flex` / `inline-flex` / `flex-col` / `flex-row` / `flex-wrap` / `flex-nowrap` / `flex-1` / `items-*` / `justify-*` / `text-center|left|right` / `font-bold|semibold|medium|normal|light` / `italic` / `underline` / `truncate` / `border[-t|b|l|r]` / `rounded-full` / `hidden|block|inline-block` / `relative|absolute|fixed` / `w-full|h-full|w-screen|h-screen` / `overflow-hidden|auto` / `whitespace-nowrap` / `object-cover|contain` / `flex-shrink-0|flex-grow-0` / `m*-auto` / `blur-*|backdrop-blur-*`

以下写法会丢失：

| Class | 影响 | 替代方案 |
|-------|------|---------|
| **变体前缀**：`hover:` / `focus:` / `focus-within:` / `sm:` / `md:` … | 状态与响应式样式整体丢失 | 用静态样式表达当前状态；断点分别渲染不同尺寸 |
| **非 gray/slate 的调色板**：`bg-indigo-600` / `text-red-500` / `border-blue-200` … | 颜色丢失（元素透明或继承父级）| 写任意值：`bg-[#4f46e5]` |
| 其它未入白名单的工具类：`space-y-*` / `grid-cols-*` / `aspect-*` / `basis-*` … | 该项样式丢失 | 改用任意值或显式内联 `style` |

> ⚠️ **未命中的 class 不再是无声丢失**：客户端渲染会把它们收进 `unresolvedClasses`，随 `dsl/render` 响应返回给 AI，并在设计画布上弹一条警告通知（含前几个 class 名）。收到后改用上表的替代写法重渲即可，不必猜。
>
> ✅ 已支持（多个版本前文档还列为不支持）：`bg-white` / `text-gray-*` / `border-slate-*`、`rounded-lg|2xl`、`shadow-md|lg`、`leading-tight`、`tracking-[Npx]`、`whitespace-nowrap`、`truncate`、`overflow-hidden`、`flex-nowrap`、`z-10`、`opacity-50`。
>
> `code_to_design` 要求 `filePath` 指向的 HTML 文件必须存在于服务端文件系统，且为 UTF-8 编码。

## 宿主客户端能力差异（先探测，不要凭 typings 猜）

> 🔗 **本节讲的是同一宿主的不同客户端版本**；两个宿主（MasterGo / Penpot）之间的差异
> —— 能力矩阵、Penpot 侧硬约束（字体族/单边描边/渐变/网格/删页）、以及"哪些降级是正常的"
> —— 单独收在 **`rules/17-host-differences.md`**。先看那里再读本节。

`@mastergo/plugin-typings` 只是**类型声明**，某个 API 能不能调取决于**你连的那台 MasterGo 客户端**。
现实里存在**私有化企业版**（`/Applications/MasterGoPrivate.app`，bundle `com.electron.master-pri-desktop`），
它的能力面和公版时间线**并不一致**（有的新 API 有、有的老 API 没有）。

**接任何新插件 API 之前，先跑 `plugin_capabilities`**（插件方法 `plugin/capabilities`）：它返回 `mastergoApiVersion`、
插件版本、运行模式，以及 `teamLibrary` / `node` / `export` / `variables` / `misc` 各组能力的运行时布尔值
（实例专属方法用画布上真实实例探测，拿不到时返回 `null` 而不是 `false`，别误读成「不支持」）。

### 实测样本：MasterGoPrivate 1.10.3（2025-06 构建）

`mg.apiVersion` 报 `"1.0"` —— 私有版没有映射到通道版本号，**信息量很低，只能靠能力布尔判断**。

| 可用 ✅ | 不可用 ❌ |
| --- | --- |
| `mg.variables` 全组（getCollections / getVariables / createVariable / setVariableValue / getModes / setCodeSyntax / setVariableScopes…）| `getPublishedTeamLibraryAsync` |
| `exportPng({ids,filterIds,scale})`、`exportSvgByLayerIds(ids)` | `document.currentPage.getExportList()` |
| 实例 `swapComponent` / `detachInstance` / `componentProperties` / `setProperties` | `getTopContainerInfoListByPageID` |
| `getRootNodeById` / `getRootParentLayerId` / `createIntelligentContainer` / `getNodeByPosition` | `ui.setCloseConfirm` |
| `getTeamLibraryAsync` / `importComponentByKey` / `importComponentSetByKey` / `importStyleByKey` / `getComponentListVal` | — |
| `viewport` 写（center/zoom）/ `scrollAndZoomIntoView` / `positionOnDom` / `clientStorage` / `mg.WebSocket` | — |

### 可写字段与“名字踩坑”（真机验证，v2.9.0）

**写入前一定用 `node_get` 核对真实字段名** —— 同一个属性在「DSL 导出」与「写回 API」里叫法不同，写错名字以前会**静默成功但没生效**（v2.9.0 起未知字段会进 `warnings`，并自动纠正常见别名）：

| 你想写 | 以前常写成（静默失败）| 宿主真实字段（已支持别名）|
| --- | --- | --- |
| 自动布局 | `layoutMode` / `autoLayout` | **`flexMode`**（取值 `NONE`/`HORIZONTAL`/`VERTICAL`）|
| 图片填充 | `imageUrl` / `imageScaleMode`（DSL 导出里的叫法）| **`imageRef` / `scaleMode`** |
| 描边宽 | `strokeWidth` | **`strokeWeight`** |
| 渐变 | `gradientTransform` | **`gradientHandlePositions: [{x,y},{x,y}]`**（语义不同，不自动改，会告警）|
| 文字内容 | `content` / `text` | **`characters`** |

**自动布局（Auto Layout）确实可以用 MCP 创建**（v2.9.0 真机验证）：
`node_update({ nodeId, properties: { layoutMode: 'HORIZONTAL' } })` → 回读 `flexMode: "HORIZONTAL"`，且**子层真的按 `padding*` / `itemSpacing` 排列、
父层自动 hug 到内容尺寸**（实测 300×200 → 150×70）。所以「想要自动布局只能去客户端点」是**错的**；
自带自动布局的容器里，子层的 x/y 会被引擎重算 —— 位移请用父层 `padding*`、顺序用 `node_move`。

**建节点的 x/y/width/height 现在真的生效**（v2.9.0）：新建 `frame` / `instance` 时交付给宿主的属性会在**插入父层之后二次应用**
（以前先写后被宿主重置 → instance 会落到 `y≈-5000`、frame 落 `(0,0)`）；`node_clone` 的 `x`/`y` 同理。

**仍未生效 / 客户端固有**：`cornerSmoothing` / `smooth`（连续圆角）宿主不支持；实例子层几何受自动布局锁死；
在 GROUP 内写子层几何或在 GROUP 里新建节点会触发**组级联比例缩放**（别碰）。

### 两个实测行为坑

1. **团队库组件只回传 6 个字段**：`name` / `ukey` / `type` / `width` / `height` / `componentSetUkey`。
   `description`、`cover`、`properties`、`textNodeNames`、`values`、`codeSyntax` 这台客户端**一个都不给**
   （插件端与服务端 normalize 都保留着这些字段，是客户端源头就没有）。
   所以「用 `textNodeNames` / `properties` 预知能覆写哪些子节点」的方案在私有版上**拿不到数据**，
   实例覆写只能靠先导入再回读实例子节点名，或让用户提供。
2. **实例换主组件时客户端自己保留实例尺寸**：把实例调成 100×40 后 `keepSize:false` 换主组件，结果仍是 100×40
   （**不会**回落到新组件默认尺寸）。`keepSize:true` 是我们显式回写替换前宽高，用于跨尺寸替换时强制锁定。

> 换组件双模式已在真机验证：实例换主组件（`swapComponent`）；非实例原位替换（团队库 ukey → 自动导入、
> `removedOriginal:true`、原位继承 x/y/宽、按图层名带过文字）。

### 变量（Design Token）相关的客户端行为

1. **变量值写入是异步生效的**：`mg.variables.setVariableValue()` 的 Promise 解析后，**同一拍回读仍会拿到旧值**
   （真机两次写入均如此）。所以 `variable_create` / `variable_update` 在写值后会做一次「确认回读」：
   不匹配就等一拍重读，仍不匹配则把实情写进 `warnings`（**不会谎报成功**）。收到该 warning 时稍后用
   `variable_list` 复核即可，不要重复写值。
2. **`codeSyntax` 有格式限制**：客户端只接受字母 / 数字 / 连字符 / 下划线（例如 `--brand-primary`、`colors_brand_primary`）。
   写 `var(--brand-primary)` 这类 CSS 表达式会被拒绝——工具会把它收进 `warnings` 而不是假装成功。
3. **`LIQUID_GLASS` 的 `radius` 不回读**：写入接受，但客户端不返回（`depth`/`dispersion`/`refraction`/
   `lightIntensity`/`lightAngle` 均能正常回读）。属客户端行为，不是我们的字段白名单问题。
4. **变量集合删除会连其中变量一起删**（`variable_delete { collectionId }`）：删除不可撤销（仅能靠客户端撤销），
   删前先用 `variable_list` 确认。

### 连接方式（刻意设计，不要“优化”）

插件与 MCP 服务端的连接由**用户在插件面板手动点「连接」**建立，**插件端不做自动重连**；
服务端重启会断开连接，重启后需用户手动连一次。AI 遇到 `session_list` 为空时，直接提示用户手动连接即可，
不要用 reload / 自动拉起等方式代替——何时允许 AI 操作画布由用户决定。

### 结构 / 页面操作的坑与护栏（v2.10.0）

1. **🔴 GROUP 是“危险容器”**（护栏已加，会回 `warnings`）：
   - **在 GROUP 内新建节点会触发组级坐标重算** —— 实测组边界从 80×14 炸成 6135×1472；
   - **对 GROUP 的直接子层写 `x`/`y`/`width`/`height`/`rotation` 会触发组级等比缩放** —— 实测 16×16 图标被拉成 18.63×18。
   → 热区 / 装饰 / 背景层一律建在**父 Frame** 里；需要独立改子层尺寸就先在 UI 里解组或转 Frame。
   护栏只是**事后告警**（不阻断，避免破坏既有流程）：收到 warning 后应 `node_get` 父层核对尺寸，必要时重建。
2. **实例子层几何改不动时，先 `node_detach_instance`**（v2.10.0 新增）：detach 会断开与母版的关联，
   节点转为普通节点，**之后整棵子树的几何都可自由写**（用户在 UI 里「分离实例」的经验相同）。
   返回 `{ success, nodeId, newId, newType }`；能力缺失时返回 `reason:'unsupported'`。
3. **`page_switch` 是排队异步的**：返回值里的 `applied` 是根据**回读**得到的判断，`currentPage` 也是回读的真实当页；
   `applied:false` **不代表失败**（宿主在排队），跨页批量操作前请 `page_list` 复核。
4. **`page_create` 不会自动切到新页**：响应给 `currentPageId` 与 `hint`；要立刻在新页建节点，
   传 `switchToNew:true` 或随后显式 `page_switch`（否则节点会建在**旧页**）。
5. **母版判定用 `mainComponentId` / `isLocalMaster`**（v2.10.0）：以前 DSL 里的 `componentId` 恒为 `'unknown'`
   （导出侧读错了不存在的字段），**本地母版也报 unknown**，导致只能靠「比实例子层 id 前缀」猜。现在：
   有真实值就给真实值（`mainComponentId` + `mainComponentName` + `isLocalMaster`），拿不到则**整个字段缺失**（不再写占位）。
   注意旧字段 `componentId` 保留但可能缺失，新代码请读 `mainComponentId`。
6. **批量更新的回报形状**：`node_update` 传 `updates[]` 时逐项回报（`failed:[{index,nodeId,error}]`，单项失败不中断）；
   `node_clone` 的响应是 `{success, id, node}` —— 取 id 用**顶层 `id`**。