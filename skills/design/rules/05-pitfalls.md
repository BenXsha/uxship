# 避坑指南与重要示例

> 📌 **两个最高频的“字段名踩坑”先看这里**：写在插件端会自动纠正常见别名（`layoutMode`→`flexMode`、
> `imageUrl`→`imageRef`、`strokeWidth`→`strokeWeight`、`content`→`characters`），未识别字段会进响应 `warnings`；
> 完整对照表 + 实例子层 / GROUP 等不可写项 → `12-limitations.md §可写字段与名字踩坑`。
> **DSL / HTML 侧与写回 API 侧的字段名并不相同**（如 `primaryAxisAlignItems` vs `mainAxisAlignItems`），写回时用宿主名。

在编写设计表达 HTML 时，请务必检查以下极易犯的错误：

## 0. MasterGo 自动布局默认值陷阱（最重要）

**MasterGo 的 `itemSpacing` 和 `paddingTop/Bottom/Right/Left` 默认值均为 10px。** 使用 flex 布局时若未显式设置，MasterGo 会注入这 10px，导致与 HTML 预期表现不符。

❌ **错误示例**：HTML 中无 gap、无 padding，但 MasterGo 自动加上 10px
```html
<!-- 期望: 两个子元素紧贴，容器无内边距 -->
<section class="flex" data-name="card">
  <p class="text-[14px] text-[#333]" data-name="label">名称</p>
  <p class="text-[14px] text-[#666]" data-name="value">张三</p>
</section>
```
实际渲染：子元素间距 10px，容器四边各 10px 内边距。

✅ **正确做法**：显式声明所有间距和边距
```html
<section class="flex gap-[0px]" data-name="card">
  <p class="text-[14px] text-[#333]" data-name="label">名称</p>
  <p class="text-[14px] text-[#666]" data-name="value">张三</p>
</section>
```
或用真实间距替代：
```html
<section class="flex flex-col gap-[12px] p-[16px]" data-name="card">
  ...
</section>
```

**需要检查的 DSL 属性清单：**
| 属性 | MasterGo 默认 | 无间距时应设为 |
|------|---------------|---------------|
| `itemSpacing` | 10 | 0 |
| `paddingTop` | 10 | 0 |
| `paddingBottom` | 10 | 0 |
| `paddingLeft` | 10 | 0 |
| `paddingRight` | 10 | 0 |
| `crossAxisSpacing` | 10 | 0 |

> 注意：`code_to_design` 内部转换引擎目前已自动处理该逻辑（未设置时写 0），但如果手写 DSL JSON，必须自行遵守此规则。

## 1. 避免内容自适应 + 外部约束拉伸的模糊布局

当子元素需要充满或占据父容器剩余空间时，**必须明确使用 `flex-1`**，严禁依赖"内容自适应+外部拉伸"。

❌ **错误示例（禁止出现）**：子元素基于内容自适应，然后在容器限制下被拉伸。
```html
<section class="flex gap-[24px]" data-name="container">
  <section class="flex flex-col gap-[24px]" data-name="card">
    <div class="w-[380px] h-[480px] bg-[#f0f0f0]" data-name="image"></div>
    <p class="text-[24px] font-[600] text-[#000000]" data-name="title">这是一个很长的标题文本内容</p>
  </section>
  <section class="flex flex-col gap-[24px]" data-name="card">
    <div class="w-[380px] h-[480px] bg-[#f0f0f0]" data-name="image"></div>
    <p class="text-[24px] font-[600] text-[#000000]" data-name="title">短标题</p>
  </section>
</section>
```

✅ **正确示例**：明确使用 `flex-1` 或固定宽度，让每个卡片占据相等的空间。
```html
<section class="flex gap-[24px]" data-name="container">
  <section class="flex flex-col gap-[24px] flex-1" data-name="card">
    <div class="w-[380px] h-[480px] bg-[#f0f0f0]" data-name="image"></div>
    <p class="text-[24px] font-[600] text-[#000000]" data-name="title">这是一个很长的标题文本内容</p>
  </section>
  <section class="flex flex-col gap-[24px] flex-1" data-name="card">
    <div class="w-[380px] h-[480px] bg-[#f0f0f0]" data-name="image"></div>
    <p class="text-[24px] font-[600] text-[#000000]" data-name="title">短标题</p>
  </section>
</section>
```

## 2. 避免使用百分比宽或高

如需在 flex 布局中充满请使用 `flex-1`，禁止使用 `w-[100%]` 或类似百分比。

❌ **错误示例（禁止出现）**：使用 `w-[100%]`
```html
<section class="flex items-center pt-[16px]" data-name="test-container">
  <section class="flex justify-center items-center bg-[#000000] rounded-[4px] p-[16px] w-[100%]" data-name="test">
    <p class="text-[18px] font-[600] text-[#ffffff]" data-name="test-text">测试</p>
  </section>
</section>
```

✅ **正确示例**：使用 `flex-1`
```html
<section class="flex items-center pt-[16px]" data-name="test-container">
  <section class="flex justify-center items-center bg-[#000000] rounded-[4px] p-[16px] flex-1" data-name="button">
    <p class="text-[18px] font-[600] text-[#ffffff]" data-name="test-text">登录</p>
  </section>
</section>
```

## 3. 节点叶子化与样式显式声明

- `<div>` 永远是叶子节点，只要内部有内容（哪怕是文字），都必须换成 `<section>`（容器）或 `<p>`（文本）。
- 文本的颜色和大小必须在 `<p>` 标签上直接声明，不要依赖父级继承。

## 4. pen 路径只能通过 `code_to_design` 创建

`node_create`（单体或 `nodes[]` 批量） **不支持** `type: "pen"` 或 `type: "path"`。图标等 pen 元素应通过 HTML 中的 `data-icon` 属性定义，由 `code_to_design` 自动渲染为矢量路径。

❌ **错误示例**— 不可行：
```json
// node_create(nodes: [...]) — pen type 被忽略，svgPathData 丢失
{ "type": "pen", "properties": { "svgPathData": "M4 8L12 4", "fills": [...] } }
```

✅ **正确方式**：在 HTML 中使用 `data-icon` 属性，通过 `code_to_design` 渲染：
```html
<i data-icon="ri:tools-line" data-name="icon" class="text-[#4F46E5]"></i>
```

## 5. `content` / `text` 与 `characters` 字段名

**DSL 用 `content`，MasterGo 原生 API 用 `characters`。**
✅ v2.9.0 起写在插件端自动别名：`content` / `text` → `characters`（`characters` 显式传入优先），不必再记这个差异；
但**回读**（`node_get` / DSL）里字段名仍是 `characters` / `content`，别把回读结果里的字段名当成可写字段到处套。
字段对照表见 `12-limitations.md §可写字段与名字踩坑`。

## 7. `crossAxisAlignItems: "STRETCH"` 不被宿主支持

MasterGo 自动布局的 `crossAxisAlignItems`（旧文档写作 `counterAxisAlignItems`）**不支持** `"STRETCH"` 值
（取值只有 `FLEX_START` / `FLEX_END` / `CENTER`）—— 传入 STRETCH 会被静默忽略。

✅ **拉伸子元素用这两个字段**：
- 子在**主轴**方向撑满：`layoutSizingHorizontal: "FILL"`（纵向父层则为 `layoutSizingVertical: "FILL"`）
- 子在**交叉轴**拉伸：写在**子节点**上的 `alignSelf: "STRETCH"`

或给子元素显式宽度 + `textAutoResize: "HEIGHT"` 实现文本换行
```json
{
  "type": "text",
  "name": "message",
  "characters": "长文本内容...",
  "size": { "width": 380 },  // 显式宽度
  "textAutoResize": "HEIGHT"  // 高度自适应 + 自动换行
}
```

## 8. 文本自动换行

| `textAutoResize` 值 | 行为 | 适用场景 |
|-------------------|------|---------|
| `"WIDTH_AND_HEIGHT"` | 文本不换行，容器随文本扩展 | 短标题、按钮文字、标签 |
| `"HEIGHT"` | 文本在固定宽度内换行，高度自适应 | 段落文本、描述文字 |
| `"NONE"` | 固定尺寸，溢出截断 | 严格尺寸约束的文本区域 |

**需要换行的长文本**必须同时满足：
1. 给文本元素设置显式 `size.width`
2. 设置 `textAutoResize: "HEIGHT"`（不可用 `WIDTH_AND_HEIGHT`，该模式不换行）

## 9. 反馈闭环

设计生成是 **假设 → 渲染 → 验证 → 修正** 的迭代过程。每次发现偏差应回馈进代码或文档。

- 首次渲染很少完美——MasterGo API 有多个非直觉默认值
- 同一问题手动修正 ≥2 次 → 应反馈到代码或文档中
- 文档优先于记忆：写入规则文件后，AI 下次生成会自动避开

## 10. 图标渲染：优先使用 data-icon 而非文本占位

**不要在 HTML 中用单字符文本（如 "Q"、"N"、"+"）作为图标占位符。** 这会导致 DSL 渲染为纯文本节点，而不是图标路径。

❌ **错误示例**— 用文本字符占位：
```html
<section class="flex items-center p-[16px]" data-name="stat-card">
  <p class="text-[24px] text-[#2E7D32]" data-name="icon-text">C</p>  <!-- ❌ 渲染为文字 "C"，不是云朵图标 -->
  <p class="text-[14px] text-[#6B7280]" data-name="stat-label">Cloud VMs</p>
</section>
```

✅ **正确做法**— 使用 `data-icon` 属性：
```html
<section class="flex items-center p-[16px]" data-name="stat-card">
  <i data-icon="ri:cloud-line" data-name="icon-text" class="text-[#2E7D32]"></i>  <!-- ✅ 自动渲染为 SVG 矢量图标 -->
  <p class="text-[14px] text-[#6B7280]" data-name="stat-label">Cloud VMs</p>
</section>
```

**data-icon 的适用范围：**
- 可在任何标签上使用（`<i>`、`<section>`、`<div>` 均可）
- 支持 3229+ Remix Icon 本地 SVG 缓存，无需网络请求
- 内置缓存未命中时自动生成命名占位 Frame，可通过 `icon_search` 查找可用图标名后更新
- 图标尺寸默认 24×24，可通过 `w-[Npx]` 自定义
- 🔴 **图标颜色必须通过 `text-[#Hex]` 显式声明**，否则默认渲染为黑色（如 `<i data-icon="ri:search-line" class="text-[#3B82F6]"></i>`）

## 11. pen 元素必须包含 size 属性

自定义 pen 元素（路径/自定义矢量形状）在 DSL 中必须显式声明 `size` 属性，否则渲染后不可见。**图标请使用 `icon_render` 或 `data-icon`（它们生成 `type: 'svg'` 元素，自动处理尺寸）。**手写自定义矢量路径时需注意：

✅ **正确 DSL**：
```json
{
  "type": "pen",
  "name": "search-icon",
  "svgPathData": "M18.031...",
  "size": { "width": 24, "height": 24 },  // ✅ 必须
  "fills": [{ "type": "solid", "color": "#333333" }]
}
```

## 12. Flex 子元素宽度缺失导致布局聚拢

**auto-layout 容器中的子元素若未显式声明宽度，MasterGo 默认以 Hug（自适应）模式渲染，所有子元素聚拢成一团。**

这是除默认 10px padding 外最常见的布局问题。`<p>` 文本节点在转换引擎中被设为 `textAutoResize: "HEIGHT"`（固定宽度 + 自适应高度），但如果 HTML 中没有 `w-[Npx]` 类，文本节点会失去宽度，渲染时宽度为 0。

### VERTICAL 容器（flex-col）

VERTICAL 父容器有显式宽度（`w-[Npx]`）时，**转换引擎会自动为子元素设置 `layoutSizingHorizontal: 'FILL'`**，子元素会自动撑满父容器宽度，不需要手动设置 `w-[100%]`。

✅ **正确示例**：
```html
<section class="flex flex-col gap-[16px] w-[400px]" data-name="card">
  <p class="text-[16px]">标题</p>      <!-- 自动撑满 400px 宽度 -->
  <p class="text-[14px]">描述</p>      <!-- 自动撑满 -->
</section>
```

但如果父容器**没有显式宽度**，子元素不会自动拉伸，仍需声明宽度：

✅ **正确做法**：为 flex 容器内每个子元素声明宽度策略
```html
<!-- 固定宽度文本 -->
<p class="text-[13px] w-[70px]">4 vCPU</p>

<!-- 自动撑满 -->
<section class="w-[160px]">...</section>
<section class="flex-1">...</section>
```

### HORIZONTAL 容器（flex-row）

HORIZONTAL 容器中，子元素宽度**不会自动拉伸**，必须在主轴方向声明尺寸策略（`w-[Npx]` 或 `flex-1`）。

**注意：** 即使父容器设置了 `gap-[Npx]`，子元素仍需显式宽度，否则 gap 作用于零宽元素上，视觉效果依然是聚拢。

> `code_to_design` 内部转换引擎已自动处理该逻辑（VERTICAL 容器有 width 时自动为子元素设置 FILL；文本节点有 `w-[Npx]` 时会保留 `size.width`）。

## 13. HORIZONTAL Flex 中混合 `<i>`（frame）和 `<p>`（text）导致高度不一致

转换引擎会自动为 HORIZONTAL 容器中的 frame 子元素设置 `layoutSizingVertical: 'FILL'`，使其撑满容器高度，但**跳过 text 子元素**。混用 `<i>`（frame）和 `<p>`（text）导致交叉轴高度不一致。

✅ **做法**：保持 HORIZONTAL 容器中所有直接子元素类型一致。将 `<p>` 用 `<section>` 包裹转 frame，或改用 VERTICAL。详见 `02-layout-styles.md §2b`。

### 13.1 「刀尖换行」：flex-row 的 Hug 按钮 + CJK 亚像素溢出（真机踩到）

**症状**：同一排两个**类名完全相同**的胶囊按钮（`flex flex-row items-center justify-center px-[14px] py-[8px]`），
一个正常、另一个文字被挤到第二行（节点高度从 `leading` 的 16 变成 32，且因为不在交叉轴居中而**顶对齐**）；
改宽也不回排。真机实例：「查看行程 / 添加计划」那一排。

**根因**（两个因素叠加）：
1. 按钮**没有显式宽度**（只写了 `px-`）→ 引擎按 Hug 算出宽度 = `px + 文字宽`，
   **内容盒宽恰好等于文字宽**（例：76 − 2×14 = 48，而 4 个 12px 中文字符实测 48.0000057）；
2. CJK 可以逐字换行 → 亚像素级别的溢出就把**最后一个字**挤到第二行。
   另一个按钮只是恰好没踩到这个值，于是“同类名、两种结果”看起来像随机 bug。

**为什么改宽也不回排**：管线会给文本节点同时写 `size.width` 与 `size.height`（测到多少写多少），
宿主里就是**固定尺寸**，所以后续只改宽度不会重新排版 —— 必须**同时**把高度也改回去（或一开始就别让它换行）。

**✅ 做法**：
- `flex-row` 里的按钮/标签**必须显式声明宽度**（`w-[Npx]` 或 `flex-1`），并给文字**留 ≥ 8px 余量**；
  别把「按钮宽 = `px` + 文字宽」交给 Hug。
- 例：`w-[84px]`（内容盒 56）容纳 4 个 12px 汉字（≈48）→ 单行稳。
- 已渲的节点发现此问题：`node_update` 同时改**按钮宽**与**文本宽+高**（只改宽无效，见上）。

**管线侧（已修，`useClientRender.ts` + `renderer.ts`）**：
- 客户端渲染按阈值（`单行自然宽 > 盒宽 + 1px`）判定折行；落在「单行」分支时，
  现在会把高度**收敛回一行**（不再把那次亚像素误折行的 32 高烤进节点）；
- 同时把「盒宽偏紧」写进渲染报告的 **`layoutWarnings`**（面板日志会以“布局告警”显出，`code_to_design` 响应里也有）——
  即使没人读这份文档，也能在报告里看到。

## 14. 横向 Flex 多子元素（≥3）位置计算异常

HORIZONTAL flex 容器含 ≥3 子元素时，如果某个子元素缺少主轴方向显式尺寸（宽度），Auto Layout 累计偏移可能将后续子元素挤出容器边界。

✅ **做法**：每个子元素在主轴方向显式声明 `w-[Npx]` 或 `flex-1`。交叉轴方向（高度）会自动由转换引擎设置 `layoutSizingVertical: 'FILL'`，不需要手动设置 `h-[Npx]`。详见 `02-layout-styles.md §2a` 子元素尺寸策略。

## 15. 不支持的 Tailwind Class（会告知，不再静默）

**根因**：客户端渲染前的 Tailwind 解析器 `resolveTailwindStyle`（`plugin-mastergo/ui/composables/tailwind-resolver.ts`）使用**白名单模式**
—— `named` 工具类表 + 任意值映射表 + 间距/字号刻度，未命中的 class 不会被应用。

🔔 **v2.5.0 起不再静默**：未命中的 class 会收进 `unresolvedClasses` 随 `dsl/render` 响应返回，并在画布上弹一条警告通知；
收到后换任意值写法重渲即可，不必猜。白名单也补齐了 `white`/`black`/`transparent`、`gray`/`slate` 调色板、
`rounded-*`、`shadow-*`、`leading-*`、`opacity-N`、`z-N`。

仍不支持的主要是**变体前缀**（`hover:` / `focus-within:` / `sm:`）、**非 gray/slate 的具色调色板**（`bg-indigo-600`）、
`space-y-*` / `grid-cols-*` / `aspect-*` 等——完整列表与替代写法见 `12-limitations.md §不支持的 Tailwind Class`。

> 📌 排查提示：怀疑「某个 class 没生效」时，先看响应里的 `unresolvedClasses`（AI 不需要去读源码猜白名单）；
> 用任意值写法（`bg-[#ffffff]` / `rounded-[16px]` / `shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]`）几乎总能命中。

## 16. 布局优化时禁止删除现有画板

进行布局优化（重新生成设计）时，**必须先删除旧的画板/容器节点，再渲染新的**，否则新旧节点会叠在一起。

❌ **错误做法**：不删除旧的就直接调用 `code_to_design` 渲染新版本，新旧画板叠加。
❌ **错误做法**：先 `node_delete` 删除旧的再渲染——正确，但操作有风险，应改用两步法。

✅ **正确做法**：
1. 用 `code_to_design` 重新渲染时，**不删除任何已有节点**，让新渲染的版本与旧版共存
2. 对比确认新版本无误后，再手动删除旧版
3. 如需自动替换，先删除旧节点再渲染（需确认 `node_delete` 成功后执行 `code_to_design`）

> 核心原则：**渲染前置操作永远不应删除用户画布上的内容。** 除非用户明确要求替换，否则新旧版本应共存。

## 17. `<section>` 未设置 flex 导致 padding 无法清零

`flexMode: "NONE"` 的 frame **不支持设置 padding**（MasterGo API 静默忽略）。无 flex 类的 `<section>` 渲染后 padding 保持默认 10px。

✅ **规则**：`<section class="flex flex-col ...">` — 每个 section 必须含 `flex`/`flex-col`/`flex-row`。

> 详 §0（auto-layout 默认值陷阱）及 `02-layout-styles.md §0`。

## 18. 🔴 生成前自检清单（调用 code_to_design 前必须逐条核对）

这是 **#1 高频复现错误的归总清单**。HTML 文件写完后、调用 `code_to_design` 前，必须逐条检查：

### 18.1 有 padding 即有 flex
❌ `<section class="px-[14px] py-[10px] bg-[#f0f0f0]">` — 缺 flex，padding 整组无效
✅ `<section class="flex flex-col gap-[0px] px-[14px] py-[10px] bg-[#f0f0f0]">`

**检查范围**：所有使用 `px-`、`py-`、`p-` 的 `<section>`，包括：
- 气泡容器（`ai-bubble`、`customer-bubble`）
- 圆角标签（`status-badge`、`chip-*`）
- 信息卡片（`customer-card`、`order-card`）
- 所有带背景色 + padding 的容器

### 18.2 避免用 `<div class="flex-1">` 做间隔
❌ `<section class="flex items-center"><p>标题</p><div class="flex-1"></div><p>操作</p></section>`
- `<div>` 转 NONE frame，带默认 10px padding + itemSpacing，部分场景下高度被拉伸导致父容器异常膨胀（已知场景：order-header 100px）

✅ 改用 `justify-between`：
```html
<section class="flex items-center justify-between">
  <p>标题</p>
  <p>操作</p>
</section>
```

✅ 或用有 flex 的 section 做 spacer：
```html
<section class="flex items-center gap-[12px]">
  <p>标题</p>
  <section class="flex flex-1"></section>
  <p>操作</p>
</section>
```

### 18.3 Badge / Chip / Tag 必须有 flex
❌ `<section class="px-[8px] py-[3px] bg-[#ECFDF5] rounded-[4px]">`
→ 转 NONE frame，默认 10px 内边距 → 尺寸异常膨胀（已知场景：status-badge 膨胀到 400×200px）

✅ `<section class="flex items-center gap-[0px] px-[8px] py-[3px] bg-[#ECFDF5] rounded-[4px]">`

### 18.4 分隔线避免 `mt-`/`mb-`/`my-` 边距，使用父容器 `gap-` 替代
`mt-[Npx]` / `mb-[Npx]` / `my-[Npx]` 在 VERTICAL 容器中会被 MasterGo 的 auto-layout 行为干扰，导致渲染为四边边框、间距错乱等问题。应始终通过父容器 `gap-[Npx]` 控制间距，分隔线 div 自身不设任何边距。

❌ 分隔线自身用 `mt-`/`mb-`：
```html
<section class="flex flex-col w-[64px] h-[1080px] gap-[0px] items-center">
  <div class="w-[40px] h-[40px] ...">Logo</div>
  <div class="w-[32px] h-[1px] bg-[#E2E8F0] mt-[16px] mb-[16px]"></div>
  <section class="flex flex-col flex-1">...</section>
</section>
```

❌ 使用 `my-[Npx]` 的简洁写法同样不可取：
```html
<div class="w-full h-[1px] bg-[#E2E8F0] my-[12px]"></div>
```

✅ 通过父容器 `gap-[Npx]` 控制间距，分隔线 div 不设任何边距：
```html
<section class="flex flex-col w-[64px] h-[1080px] gap-[16px] items-center">
  <div class="w-[40px] h-[40px] ...">Logo</div>
  <div class="w-[32px] h-[1px] bg-[#E2E8F0]"></div>
  <section class="flex flex-col flex-1">...</section>
</section>
```

**关键点**：
- 分隔线自身的 `mt-`/`mb-`/`my-` 一律删除
- 将分隔线上下方的间距改为父容器 `gap-[Npx]`
- 父容器的 `gap` 值取分隔线原有 `mt` + `mb` 之和或按实际设计需求设定

### 18.5 Flex 子元素必须有宽度声明（复审）

**HORIZONTAL 容器（flex-row）**：每个直接子元素必须在主轴方向显式声明宽度策略：
- 固定宽度：`w-[Npx]`
- 撑满：`flex-1`
- 无宽度 → MasterGo 默认 Hug（自适应）→ 聚拢为零宽
- ⚠️ **Hug 也不安全**：胶囊按钮/标签若只写 `px-`，内容盒宽会**恰好等于文字宽**，CJK 逐字换行下亚像素溢出
  会把最后一个字挤到第二行（且改宽不回排）—— 见 `§13.1`。**给文字留 ≥ 8px 余量**，或直接写 `w-[Npx]`。

**VERTICAL 容器（flex-col）**：父容器有显式宽度（`w-[Npx]`）时，子元素会自动撑满宽度，不需要每个子元素都写 `w-[Npx]`。但以下情况仍需显式宽度：
- 需要固定宽度的子元素（如表格列）
- 文本节点（`<p>`）必须有 `w-[Npx]`，否则 `textAutoResize: "HEIGHT"` 模式失去宽度，渲染宽度为 0

### 18.6 所有元素必须有 data-name
❌ `<section class="flex">` — 无 data-name，DSL→HTML→DSL 往返后图层名丢失
✅ `<section class="flex" data-name="header">`

**检查范围**：所有 `<section>`、`<div>`、`<p>`、`<i>`、`<svg>` 等标签

### 18.7 rgba 格式必须无空格
❌ `bg-[rgba(255, 255, 255, 0.5)]` — 含空格，解析可能失败
✅ `bg-[rgba(255,255,255,0.5)]` 或 `bg-[#FFFFFF80]`

**检查范围**：所有 `rgba(` 出现的位置

### 18.8 bg-[url()] 必须使用单引号
❌ `bg-[url(https://example.com/img.jpg)]` — 无引号，解析可能失败
✅ `bg-[url('https://example.com/img.jpg')]`

### 18.9 所有 `<p>` 必须显式声明 `leading-[Npx]`

渲染引擎解析 `<p>` 文本时，若未指定 `leading-[Npx]`，可能默认输出 `lineHeight: 36px`，与字号完全无关，导致排版异常膨胀。**所有 `<p>` 都必须显式声明 `leading-[Npx]`**。

❌ **错误示例**— 缺 leading，渲染后 lineHeight 默认为 36px：
```html
<p class="text-[11px] text-[#6B7280]">Brand</p>  <!-- lineHeight 36px → 36/11 ≈ 3.27x -->
```

✅ **正确做法**— 显式声明行高：
```html
<p class="text-[11px] leading-[16px] text-[#6B7280]">Brand</p>  <!-- lineHeight 16px → 16/11 ≈ 1.45x ✓ -->
```

**行高参考值**：
| fontSize | leading | ratio |
|----------|---------|-------|
| 10px | 14px | 1.4x |
| 11px | 16px | 1.45x |
| 12px | 18px | 1.5x |
| 13px | 20px | 1.54x |
| 14px | 20px | 1.43x |
| 16px | 24px | 1.5x |
| 18px | 26px | 1.44x |
| 20px | 28px | 1.4x |
| 24px | 32px | 1.33x |
| 32px | 40px | 1.25x |
| 48px | 56px | 1.17x |

### 18.10 表格/数据列表勿逐行展开 HTML
❌ **错误做法**——为 N 行数据生成 N 个重复的 `<tr>`/`<td>`：
```html
<section class="flex flex-col" data-name="user-table">
  <section class="flex" data-name="row-1">
    <p class="w-[120px]" data-name="name">张三</p>
    <p class="w-[200px]" data-name="email">zhang@example.com</p>
  </section>
  <section class="flex" data-name="row-2">
    <p class="w-[120px]" data-name="name">李四</p>
    <p class="w-[200px]" data-name="email">li@example.com</p>
  </section>
  <!-- N 行同样结构的重复... 浪费 token，DSL 膨胀，无法利用渲染器模板优化 -->
</section>
```

✅ **正确做法**——使用 `data-table` JSON 属性，一行传入列定义 + 数据数组：
```html
<section data-table='{"columns":[{"key":"name","label":"姓名","width":120},{"key":"email","label":"邮箱","width":200}],"data":[{"name":"张三","email":"zhang@example.com"},{"name":"李四","email":"li@example.com"}]}' data-name="user-table"></section>
```

✅ **备选**——使用 `<table>` 标签 + 表头 + 示例行（服务端自动展开）：
```html
<table data-name="user-table">
  <thead><tr><th data-name="col-name">姓名</th><th data-name="col-email">邮箱</th></tr></thead>
  <tbody><tr><td data-name="cell-name">张三</td><td data-name="cell-email">zhang@example.com</td></tr></tbody>
</table>
```

**检查范围**：任何出现重复结构的子元素列表（table rows、list items、card grids 等），共 ≥3 组重复即应改为 `data-table` 模式。

---

**快速扫描命令（写完后用）：** 逐行搜索以下关键词确认无遗漏：
1. `<section ` → 检查每个是否有 flex 类，尤其带 `px-`/`py-` 的
2. `<div class="flex-1"` → 考虑替换为 `justify-between`
3. `my-[` → 优先改用父容器 `gap-[`
4. `flex items` → 检查所有子元素是否有 `w-[Npx]` 或 `flex-1`
5. `data-name` → 检查所有元素是否都有 data-name
6. `rgba(` → 检查是否有空格，优先改用 `#RRGGBBAA`
7. `bg-[url(` → 检查 URL 是否用单引号包裹
8. `<section class="flex" data-name="row-` 或 `data-table` → ≥3 组重复结构应改为 `data-table` JSON 模式
9. `flex-col` → 检查是否需要钉桩：定位所有 VERTICAL 容器，其宽度若来自 `flex-1`（而非 `w-[Npx]`），且内有子元素需要撑满 → 改为 `w-[Npx]`
10. `<chart ` → 检查宽度：`<chart>` 必须有 `w-[Npx]` 等于父容器 content width（父 width - padding），否则默认 400px；检查高度是否匹配数据点数量（见 `03-charts.md §5.2`）
11. `<p ` → 检查每个 `<p>` 是否有 `leading-[Npx]`，无则添加（参考 18.9 行高表）

---

## 20. 多层背景限制与 inline style 逃生舱

**问题**：Tailwind `bg-[...]` 仅支持单层背景（纯色/渐变/图片之一），无法表达 CSS 多层叠加（如渐变+底纹图片+底色）。

❌ **不可行**——Tailwind 不支持多层 `bg-[...]`：
```html
<!-- 以下不会正确渲染：转换引擎会静默丢弃非尾风类 -->
<section class="bg-[linear-gradient(135deg,#667eea,#764ba2)] bg-[url('/pattern.png')]" data-name="card">
```

✅ **正确做法**——使用 `style="background: ..."`（这是唯一允许 inline style 的场景）：
```html
<section class="w-[400px] h-[200px] rounded-[12px]"
  style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%), url(https://.../pattern.png)"
  data-name="card"></section>
```

转换引擎自动解析多层 `background`/`background-image`，每层转换为对应的 MasterGo fill（GRADIENT / IMAGE / SOLID），按声明顺序叠层。

**可用的背景层类型**：

| CSS 写法 | 对应的 Fill 类型 |
|---------|----------------|
| `linear-gradient(...)` / `radial-gradient(...)` / `conic-gradient(...)` | GRADIENT |
| `url(...)` | IMAGE |
| `#RRGGBB` / `#RRGGBBAA` | SOLID |
| `rgba(R,G,B,A)` | SOLID |

**图层顺序**：
CSS 背景层顺序为 **first=topmost**（第一层在最上面），MasterGo fills 顺序为 **first=bottom-most**（第一层在最下面）。转换引擎自动反转顺序：
- `style="background: url(top.png), linear-gradient(...), #FFFFFF"` →
  - Fill[0] → `SOLID(#FFFFFF)`（底层）
  - Fill[1] → `GRADIENT(...)`（中间层）
  - Fill[2] → `IMAGE(...)`（最上层）

**限制**：
- 仅 `background` 和 `background-image` 属性支持 inline style
- 其他 CSS 属性（`color`、`margin`、`padding` 等）仍禁止使用 inline style
- `background-color` 单层场景优先使用 Tailwind `bg-[#...]`

## 22. 🔴 `<p>` 上不要写背景 / 内边距（会让整排文字隐形）

**现象**：`<p class="bg-[rgba(60,60,67,0.10)] px-2">Ctrl</p>` 渲染后，该 text 节点的 `fills` **被设成那个 10% 灰**
——等于「用 10% 不透明度画文字」，用户看到的是「偏白、看不见内容」。

**根因**：`bg-*` 被解析成内联 `background-color` → 渲染侧写进了节点的 `fills`；随后文字色因为「`fills` 已存在」被跳过。

✅ **规则**：**背景 / 圆角 / 内边距一律写在 `<section>`（frame）上，`<p>` 只负责文字与颜色**。
chip / 徽标这类「底色 + 文字」要写成 `<section>`（胶囊底）+ 内层 `<p>`（文字色）。

🔔 **v2.10.0 起有护栏**：文本元素上的 `bg-*` / 渐变 / `p*-*` / `rounded*` 不再落成文字色，而是收进 `unresolvedClasses`
并回一条可读 warning（含 `<section>` 替代写法）；同时**文字色权威**——文字颜色永远优先于任何背景写法。
空 `<p class="bg-x"></p>`（装饰块）不受影响，背景照旧生效。

## 21. 🔴 VERTICAL auto-FILL 层级传递失效与钉桩修复法

### 问题

`02-layout-styles.md §2a` 指出：VERTICAL 容器有显式 `w-[Npx]` 时，转换引擎会自动为子元素设置 `layoutSizingHorizontal: 'FILL'`。**但该行为有 3 个未文档化的限制：**

| 限制 | 说明 | 表现 |
|------|------|------|
| **FILL 不递归** | auto-FILL 仅对直接子元素生效，不会传递到孙级 | 如 `meetings-card(w-[266px])` 的子元素 `meetings-header` 宽度坍缩为 144px |
| **`flex-1` 不触发 FILL** | VERTICAL 容器的宽度来自 HORIZONTAL 容器 `flex-1` 分配时，其 `crossAxisSizingMode` 为 `"AUTO"`，子元素不会 FILL | `main-content(flex-1)` → `focusing-header` 宽度坍缩为 266px（应为 1038） |
| **`justify-*` 需显式宽度** | 使用 `justify-between`/`justify-center` 的元素若无 `w-[Npx]`，退化为 `FLEX_START`/`CENTER` | `profile-header(justify-between)` 宽度 69px 导致两端对齐失效 |

### 钉桩式修复法（Staking）

对于包含 2 层及以上嵌套 VERTICAL 容器的布局，最可靠的策略是从最外层开始逐层钉桩：

```
最外层 VERTICAL 容器 → w-[1400px] ✅
  └─ 直接子元素 → w-[1352px] ✅          (1400 - 24 - 24)
      └─ HORIZONTAL 容器 → w-[1352px] ✅
          ├─ left → w-[1038px] ✅         (1352 - 24gap - 290)
          │    └─ VERTICAL 容器 → w-[1038px] ✅
          │        ├─ 子元素 → w-[1038px] ✅
          │        └─ 子元素 → w-[1038px] ✅
          └─ right → w-[290px] ✅
               └─ VERTICAL 容器 → w-[266px] ✅  (290 - 24pl)
                   ├─ 子元素 → w-[266px] ✅
                   └─ 子元素 → w-[266px] ✅
```

**宽度计算公式**（从父容器往下推）：
```
子元素宽度 = 父容器.width - paddingLeft - paddingRight - Σgap - Σ兄弟显式宽度
```

**关键原则**：**每个需要子元素撑满宽度的 VERTICAL 容器都必须有自己的 `w-[Npx]`**，不依赖父容器的 auto-FILL 传递。HORIZONTAL 容器不受此限制，其 `flex-1` 子元素可正常分配宽度。

### 快速自检

生成嵌套布局后，检查 `node_get` 返回的以下字段：
- `crossAxisSizingMode` — VERTICAL 容器应为 `"FIXED"`（而非 `"AUTO"`）才说明显式宽度生效
- `mainAxisAlignItems` — 使用 `justify-between` 的元素应为 `"SPACING_BETWEEN"`（而非 `"FLEX_START"`）

---

## 23. ⚠️ **大画板整体导出会失败**（真机实测，未定位）

**现象**（2026-10-02，Penpot 真机）：对一整页 118 节点的画板 `iOS Travel` 调 `node/exportImage`（PNG）
**两次都回** `Internal error: http error`；而同一页的**单个** hero 节点导出**正常**。
`data` 的形状没问题（插件侧已按契约补 `data:` 前缀，见 `exportHandlers.ts` 的"历史坑"注释）。

**判断**：错误文本带 `http`，且小节点正常 —— 更像是**宿主（或其后端）在处理大画板导出时自己报错**，
而不是我们的参数/契约错。**尚未定位到具体阈值**（节点数？尺寸？渐变？）。

**目前的做法**：
1. 导出失败时**如实上报**（不返回空图假装成功）；
2. 需要整页图时**先按区块分别导出**再拼接（或降低 `scale`/`constraint`）—— 已验证可行；
3. 下次遇到时先记下：画板尺寸、节点数、`constraint`、是否含渐变/图片 —— 这四项是二分的第一批变量。
- 每个 VERTICAL 容器直接子元素的 width 是否等于父容器 content width