# HTML 转 DSL 指南

> HTML 输出规范已在 `01-core-tags.md`、`02-layout-styles.md`、`05-pitfalls.md` 中详细定义。本章仅列出高频映射规则和行为注意事项。
>
> **重要**：`code_to_design` 默认使用**客户端渲染模式**，HTML 在浏览器中真实渲染后提取精确像素值生成 DSL。服务端预处理会将图标、图表、组件预渲染为标准 HTML/SVG。

## 元素映射

| HTML | DSL | 说明 |
|------|-----|------|
| `<section>` | `frame` | 容器（可含子元素） |
| `<div>` | `frame` | 矩形块（转换引擎自动提升为容器） |
| `<p>` / `<span>` | `text` | 文本段落 / 内联文本 |
| `<i>` | `svg`(有data-icon) | 服务端预处理替换为内联 SVG，客户端渲染提取尺寸和颜色 |
| `<svg>` | `svg` | SVG 矢量元素，从 viewBox 或 width/height 属性提取尺寸 |
| `<img>` | `frame` + IMAGE fill | 图片，src→imageUrl，object-fit→imageScaleMode |
| `<chart>` | `svg` | 服务端预处理渲染为 SVG，保留原始配置 |
| `<component>` | `frame` | 服务端预处理预渲染为 HTML 片段 |
| `<button/input/select/badge/avatar>` 等 | `generator` + `componentType` | 23 种组件标签（已废弃，改用 `<component>` 标签） |

## data-icon 映射

| 属性 | DSL 输出 | 说明 |
|------|----------|------|
| `data-icon="ri:search-line"` | `type: "svg"` + `svgContent` | 服务端预处理替换为内联 SVG（3229+ Remix Icon 本地缓存），多色图标原生保留全部颜色 |
| `data-icon="search-line"` | 同上 | 省略前缀时默认补全 `ri:` |
| `data-icon="fa:home"` | `type: "svg"` + `svgContent` | 非 ri 缓存未命中时，客户端通过 Iconify API 获取 SVG |

## data-token 映射（声明式令牌绑定）

| 属性 | DSL 输出 | 说明 |
|------|----------|------|
| `data-token-fill="system.color.primary"` | `tokenBindings: { fill: "system.color.primary" }` | 渲染**末端**把令牌绑到节点属性（Penpot：`shape.applyToken`）；属性名原样透传（`fill` 是已验合法值） |
| `data-token-stroke="…"` / `data-token-radius="…"` … | `tokenBindings: { stroke/radius/…: "…" }` | 通用：属性名是否被宿主接受由**绑定回读**判定，失败进 `tokenBindings.failed` |

- 令牌**必须先存在**（`variable_create`）且其集合**激活**，否则绑定不驱动渲染；
- 报告回 `tokenBindings: { requested, bound, failed[] }`（`bound` 以 `shape.tokens` 回读为准）；
- 改令牌值 → `variable_update({ value })` 会自动 `propagateToken`，`matched == rewritten` 即全稿联动；
- Penpot 令牌名是路径层级，叶子不能同时是前缀（见 `17-host-differences.md §4.1`）。

## 富文本 run 映射（P2-3）

| HTML | DSL | 说明 |
|------|-----|------|
| `<p>Hello <strong>World</strong></p>` | `content:"Hello World"` + `runs:[{text:"Hello "},{text:"World",fontWeight:700}]` | 内联子元素 → run；只写「与整段不同」的覆盖项 + 颜色（`color`） |
| 整段同一样式（单 run） | 只写 `content` / `fontSize` … | **不膨胀**为 runs |

- 渲染末端用 `text.getRange(start,end)` 逐段上样式（字号/字重/字距/颜色）；导出时逐字回读并按样式分组。
- 导出限制：文本 **>120 字**（`MAX_RUN_SCAN`）时不导出 runs，退回单 run（逐字 `getRange` 是跨 iframe 往返，代价高）。

## 布局推断

| Tailwind | DSL |
|----------|-----|
| `flex-row` / `flex-col` | `layoutMode: "HORIZONTAL"` / `"VERTICAL"` |
| `justify-center/start/end/between` | `primaryAxisAlignItems: "CENTER"/"MIN"/"MAX"/"SPACE_BETWEEN"` |
| `items-center/start/end` | `counterAxisAlignItems: "CENTER"/"MIN"/"MAX"` |
| `gap-[Npx]` / `flex-1` | `itemSpacing: N` / `flexGrow: 1` |
| `p/px/py-[Npx]` | `paddingTop/Right/Bottom/Left: N` |
| `w/h-[Npx]` | `size.width/height: N` |
| `top/left-[Npx]` | `position.y/x: N` |
| `bg-[#Hex]` / `bg-[rgba(r,g,b,a)]` | `fills[{type:"SOLID", color:"#Hex"}]` |
| `bg-[linear/radial/conic-gradient(...)]` | `fills[{type:"GRADIENT_LINEAR/RADIAL/ANGULAR"}]` |
| `border-[Npx]` / `border-[#Hex]` | `strokeWidth: N` / `strokes[{color:"#Hex"}]` |
| `rounded-[Npx]` | `cornerRadius: N` |
| `opacity-[0-1]` | `opacity: N` |
| `shadow-[X_Y_Z_#COLOR]` | `effects[{type:"DROP_SHADOW"}]` (offset, radius, color) |
| `shadow-[inset_X_Y_Z_#COLOR]` | `effects[{type:"INNER_SHADOW"}]` |
| `blur-[Npx]` / `backdrop-blur-[Npx]` | `effects[{type:"LAYER_BLUR"}]` / `BACKGROUND_BLUR` |
| `text-[Npx]` / `font-[N]` | `fontSize: N` / `fontName.style` (≤400→Regular, 500→Medium, 600→SemiBold, 700→Bold, >700→ExtraBold) |
| `rotate-[Ndeg]` | `rotation: N`（仅 absolute） |
| `src="url"` (img) | `fills[{type:"IMAGE", imageUrl:"url"}]` |
| `object-cover/contain/fill` | `imageScaleMode: "CROP"/"FIT"/"FILL"` |

### 子元素 Cross-Axis 自动拉伸

详见 `02-layout-styles.md §2a`（详细规则与示例）和 `05-pitfalls.md §21`（钉桩修复法 — FILL 不递归的限制）。

简要原则：VERTICAL 容器有显式 `w-[Npx]` 时，子元素 frame/rectangle/svg 自动 `layoutSizingHorizontal: 'FILL'`。HORIZONTAL 容器同理自动 `layoutSizingVertical: 'FILL'`。`<p>`/`<span>` 和 absolute 定位元素被跳过。

> **HORIZONTAL flex 中不宜混合 `<p>`（text）和 `<i>`（frame）作为直接子元素**，详见 `05-pitfalls.md` 第 13 节。

### 子元素位置计算

渲染引擎**不显式计算子元素 x/y 坐标**：位置由真实布局决定 —— 客户端浏览器渲染阶段用 `getBoundingClientRect` 实测，MasterGo 侧由 Auto Layout 引擎计算。子元素在主轴方向的尺寸需显式声明（`w-[Npx]` 或 `flex-1`），否则可能以 Hug 模式聚拢。

## 字段名兼容

| 上下文 | 使用字段 |
|--------|---------|
| DSL JSON（手写 / code_to_design / dsl_export_selection / design_to_code） | `content` |
| MasterGo 原生 API（node_create（单体或 `nodes[]` 批量）/ node_update） | `characters` |

> 两者不可混用。

## 转换步骤

1. 解析 HTML+Tailwind → 提取标签、类名、文本内容
2. 转换 Tailwind 类为 DSL 属性
3. 根据标签映射确定 DSL 元素类型
4. 推断布局（flex→auto-layout, 无 flex→NONE+绝对定位）
5. 补充默认值
6. 组装为 DSL 文档

> **MasterGo auto-layout 默认值陷阱**：详见 `02-layout-styles.md §0`。`code_to_design` 引擎会在未设置时显式写 0 覆盖，手写 DSL 时同样必须遵守。

## 使用链路

唯一路径：`HTML 文件 → code_to_design(filePath | html) → 服务端预处理 → 客户端真实渲染 → 提取精确像素值 → 渲染到设计画布`
仅需一次调用，AI 只传文件路径或 HTML 字符串，零 token 传输。

### 渲染流程详解

1. **服务端预处理**（mcp-server）：
   - 图标：本地缓存优先，替换 `data-icon` 为内联 SVG
   - 图表：ECharts SSR 渲染为 SVG
   - 组件：预生成 HTML 片段

2. **客户端渲染**（plugin-mastergo UI）：
   - 浏览器真实渲染 HTML
   - 提取计算样式（位置、尺寸、颜色、渐变、阴影等）
   - 生成精确 DSL

3. **画布渲染**（MasterGo API）：
   - 解析 DSL
   - 创建节点并应用样式