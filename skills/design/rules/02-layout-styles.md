# 模块三：布局能力（Tailwind 限定）

## 0. Auto-layout 核心规则（必须遵守）

> **🔴 强制规则：所有 `<section>` 容器必须显式声明 auto-layout。** 必须包含 `flex`、`flex-col` 或 `flex-row` 之一。无 flex 的 `<section>` 会被转换为 `flexMode: "NONE"` 的 frame，而 MasterGo API **不支持在 NONE 模式下设置 padding**（`paddingTop`/`paddingRight`/`paddingBottom`/`paddingLeft` 写入无效，保持默认 10px），导致布局出现意外间距。

> **MasterGo 自动布局默认值陷阱：** `itemSpacing` 和 `padding*` 默认 10px，`flexWrap` 默认 `WRAP`，`primaryAxisAlignItems` 和 `counterAxisAlignItems` 默认 `MIN`。使用 auto-layout 时必须显式覆写。
>
> ⚠️ **上面四个是 DSL（HTML / `code_to_design`）字段名**；通过 `node_update` **写回**时宿主字段是
> `mainAxisAlignItems` / `crossAxisAlignItems`，取值也不同（`MIN`/`MAX`/`SPACE_BETWEEN` → `FLEX_START`/`FLEX_END`/`SPACING_BETWEEN`）。
> 另外 `padding*` 只在自动布局容器（`flexMode != "NONE"`）下生效，普通容器上写 padding 无效。
> 字段对照表见 `12-limitations.md §可写字段与名字踩坑`。

**间距和边距：**
- 不需要间距时用 0（`gap-[0px]` / `itemSpacing: 0`）
- 需要间距时用具体数值（`gap-[16px]`）

**flexWrap：**
- `code_to_design` 内部转换引擎对 auto-layout 容器默认输出 `flexWrap: "NO_WRAP"`
- 如需换行显式使用 `flex-wrap` 或 `flexWrap: "WRAP"`

**主轴/交叉轴对齐：**
- MasterGo 默认 `MIN`（flex-start），需按设计显式设置
- `justify-center` → `primaryAxisAlignItems: "CENTER"`
- `items-center` → `counterAxisAlignItems: "CENTER"`

**表单布局间距参考**：见 `11-examples.md`「表单布局间距参考」表。

> 未显式设置的值，`code_to_design` 内部转换引擎会在 DSL 中写入 0 以覆盖 MasterGo 默认值。手写 DSL JSON 时同样必须遵守此规则。

## 1. 布局策略
- **文档流布局**：必须使用 `flex` 布局。
- **脱离文档流**：必须使用 `absolute` 定位（相对父元素）。
- **定位参考**：所有元素默认是 `relative`，`z-index` 由图层（DOM）顺序决定，**禁止使用 z-index**。

## 2. Flex 布局属性（仅限以下类）
- **方向**：`flex-row`, `flex-col`
- **主轴**：`justify-start`, `justify-end`, `justify-center`, `justify-between` (禁止 justify-around)
- **交叉轴**：`items-start`, `items-end`, `items-center`
- **独立对齐**：`self-stretch`
- **拉伸**：`flex-1`（主轴平分剩余空间，禁止依赖内容自适应+外部拉伸）
- **子元素尺寸策略**：auto-layout 容器内的子元素**必须**显式声明宽度策略

## 2a. Flex 子元素尺寸策略（重要）

当子元素位于 `flex` 容器中时，必须为每个子元素声明宽度策略，否则 MasterGo 默认以 **Hug（自适应）** 模式处理，所有子元素聚拢成一团，退化为零宽或最小内容宽。

| 策略 | 类 | 说明 |
|------|-----|------|
| **固定宽度** | `w-[Npx]` | 显式宽度，如 `w-[160px]`、`w-[70px]` |
| **自动撑满** | `flex-1` | 平分主轴剩余空间 |
| **交叉轴拉伸** | `self-stretch` | 在交叉轴方向撑满父容器（VERTICAL 中拉伸宽度，HORIZONTAL 中拉伸高度） |
| **自适应内容** | （默认） | 宽度由内容决定，适用场景极少 |

### VERTICAL 容器中的子元素宽度

VERTICAL 容器（`flex-col`）有显式宽度（`w-[Npx]`）时，**转换引擎会自动为子元素设置 `layoutSizingHorizontal: 'FILL'`**，子元素宽度会自动撑满父容器可用宽度（扣除 padding）。此时不需要也不建议手动给每个子元素设置 `w-[100%]`。

但如果子元素需要**固定宽度**（如表格列），仍需显式声明 `w-[Npx]`，这会自动覆盖拉伸行为。

✅ **正确示例**——VERTICAL 卡片，子元素自动撑满宽度：
```html
<section class="flex flex-col gap-[16px] w-[400px] p-[20px]" data-name="card">
  <p class="text-[20px] font-[600]">标题</p>           <!-- 自动撑满 400px 宽度 -->
  <p class="text-[14px] text-[#666666]">描述文本</p>   <!-- 自动撑满 -->
  <section class="flex gap-[8px]">                     <!-- 自动撑满 -->
    <div class="w-[80px] h-[80px] bg-[#f0f0f0]"></div>
    <p class="text-[14px] flex-1">右侧内容</p>
  </section>
</section>
```

### HORIZONTAL 容器中的子元素宽度

HORIZONTAL 容器（`flex-row`）中，子元素宽度**不会自动拉伸**，必须在主轴方向声明尺寸策略：

✅ **正确示例**——表格行内每列都有明确宽度：
```html
<section class="flex items-center gap-[64px] px-[12px] py-[12px]" data-name="row">
  <section class="flex items-center gap-[8px] w-[160px]">...</section>
  <p class="text-[13px] w-[70px]">4 vCPU</p>
  <p class="text-[13px] w-[90px]">16 GB</p>
  <p class="text-[13px] w-[110px]">10.0.1.42</p>
  <section class="flex items-center gap-[10px] flex-1">...</section>
</section>
```

❌ **错误示例**——子元素未声明宽度，MasterGo 全部自适应聚拢：
```html
<section class="flex gap-[64px]" data-name="row">
  <p class="text-[13px]">xxx</p>     <!-- 无 w-[Npx] 或 flex-1 -->
  <p class="text-[13px]">xxx</p>     <!-- ❌ 全部聚拢 -->
  <p class="text-[13px]">xxx</p>
</section>
```

**文本元素特别说明：** `textAutoResize: "HEIGHT"` 模式下，文本有固定宽度（`w-[Npx]`）和自适应高度。代码生成已自动处理宽度保留，但 HTML 中必须为文本提供宽度类。无 `w-[Npx]` 的文本节点在 flex 容器中宽度为 0。详见 `05-pitfalls.md` 第 12 节。

## 2b. HORIZONTAL Flex 子元素类型一致性

详见 `05-pitfalls.md §13`。HORIZONTAL 容器的直接子元素应保持类型一致（全 frame 或全 text）。

## 3. 尺寸与间距（仅允许 px 正整数）
- **宽高**：`w-[value]`, `h-[value]`（如 `w-[80px]`。禁止百分比、calc、vw/vh）
- **间距**：`gap-[value]`（如 `gap-[16px]`。禁止预设值如 gap-2）
- **子元素间距**：`space-y-[Npx]`（flex-col 垂直间距）、`space-x-[Npx]`（flex-row 水平间距），优先级高于子元素 margin 推断
- **外边距推断**：子元素的 `mb-[Npx]`（flex-col）或 `mr-[Npx]`（flex-row）会被自动收集并设为父容器 `itemSpacing`；未设置时显式归 0 以覆盖 MasterGo 默认 10px
- **内边距**：`p-[value]`, `px-[value]`, `py-[value]`, `pt-[value]`, `pl-[value]`（**仅能用于 flex 的 section 标签**）
- **外边距**：`m-[value]`, `mx-[value]`, `my-[value]`, `mt-[value]`, `ml-[value]`（**仅能用于 flex 的 section 标签**，禁止 m-auto。同容器子元素中 margin 值会被自动收集为父容器 `itemSpacing`）

## 4. 绝对定位（仅允许 px 正整数）
- 必须使用 `top-[value]`, `bottom-[value]`, `left-[value]`, `right-[value]`。
- 必须同时包含垂直方向（top/bottom）和水平方向（left/right）至少各一个。

---

# 模块四：视觉样式

## 1. 颜色与透明度
- **背景色**：`bg-[#Hex]` 或 `bg-[rgba(r,g,b,a)]`（禁止 bg-white 等命名色，禁止 bg-opacity）
  - ⚠️ rgba 格式**必须无空格**：`bg-[rgba(255,255,255,0.5)]` ✅ | `bg-[rgba(255, 255, 255, 0.5)]` ❌
  - 推荐优先使用 `#RRGGBBAA` hex 格式（如 `#FFFFFF80`）以避免解析问题
- **文字色**：`text-[#Hex]` 或 `text-[rgba(r,g,b,a)]`（同上，rgba 必须无空格）
- **边框色**：`border-[#Hex]` 或 `border-[rgba(r,g,b,a)]`（同上）
- **透明度**：`opacity-[0~1]`（如 `opacity-[0.75]`）
- **渐变色**：`bg-[linear-gradient(90deg, #Hex1, #Hex2, #Hex3, ...)]`（如 `bg-[linear-gradient(90deg, #000000, #ffffff)]`）
- **径向渐变**：`bg-[radial-gradient(circle at X% Y%, #Hex1, #Hex2)]` → `GRADIENT_RADIAL`
- **角渐变**：`bg-[conic-gradient(from 0deg at X% Y%, #Hex1, #Hex2)]` → `GRADIENT_ANGULAR`

> **设计建议**：毛玻璃（Glassmorphism）设计推荐使用双色渐变背景（如 `#667eea` → `#ff0099`），与半透明白色玻璃卡片形成对比，比纯色背景视觉效果更通透。

## 2. 文字排版
- **大小**：`text-[value]`（如 `text-[14px]`。所有 `<p>` 必须明确指定颜色和大小，禁止继承）
- **字重**：`font-[100~900]`（如 `font-[400]`）
- **行高**：`leading-[Npx]`（如 `leading-[20px]`）。**所有 `<p>` 必须显式声明行高**，否则渲染引擎默认硬编码为 36px，与字号完全无关。行高建议值：10px→14、11px→16、12px→18、13px→20、14px→20、16px→24、18px→26、20px→28、24px→32、32px→40、48px→56
- **文本换行**：段落文本（非标题/按钮）必须使用 `textAutoResize: "HEIGHT"` + 显式 `w-[Npx]` 实现自动换行。`WIDTH_AND_HEIGHT` 不换行，仅适用于短文本。

## 3. 边框、圆角与特效
- **边框**：`border-[1px]`, `border-[#Hex]`
- **圆角**：`rounded-[4px]`, `rounded-[9999px]`
- **阴影/模糊**：
  - `shadow-[Xpx_Ypx_Zpx_#COLOR]` — 投影（offset X, offset Y, blur, color）
  - `shadow-[Xpx_Ypx_Zpx_Wpx_#COLOR]` — 含 spread 的投影
  - `shadow-[inset_Xpx_Ypx_Zpx_#COLOR]` — 内阴影
  - shadow 颜色支持 hex 和 rgba() 两种格式
  - 值可省略 px 后缀（如 `shadow-[0_8px_32px_rgba(0,0,0,0.08)]`）
- **图层模糊**：`blur-[Npx]` → `LAYER_BLUR`
- **背景模糊**：`backdrop-blur-[Npx]` → `BACKGROUND_BLUR`
- **旋转**：`rotate-[deg]`（**仅允许在 absolute 元素上使用**）

## 4. 背景图片
- 格式：`bg-[url('https://example.com/img.jpg')] bg-cover`
  - URL 必须放在**单引号**内：`bg-[url('https://...')]` ✅
  - 禁止无引号：`bg-[url(https://...)]` ❌
  - 可与 `bg-cover`、`bg-center` 等组合使用
- **凡使用 AI 生成图地址**（`/ai/api/search-image`、`{{ImageUrl}}` 拼接 query/width/height/orientation 等）：**必须先阅读并按 `06-images.md`（模块八）全文执行**，包括提示词长度与禁用字符、背景一致性、URL 须为完整字面量（禁止动态拼接）、宽高与展示区域比例、`orientation` 取值等。本节不重复列述，以免与 `06-images.md` 不同步。
- 占位形态速查（细节一律以 `06-images.md` 为准）：`{{ImageUrl}}?query=…&width=…&height=…&orientation=landscape|portrait|squarish`

## 5. 图标 (FontAwesome)
- 使用 `i` 标签，如 `<i class="text-[18px] text-[#ffffff] fab fa-weixin" data-name="icon"></i>`
- 大小用 `text-[px]` 控制，颜色用 `text-[#Hex]` 控制。
