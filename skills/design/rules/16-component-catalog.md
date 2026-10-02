# 高阶组件参数目录（component_render）

`component_render` 的 schema 只声明 **4 个参数**：`type` / `props` / `position` / `theme`。
**任何类型专属参数都从这里查**；平铺传参与 `props` 内传参**等效，平铺优先**。

> 为什么这样拆：`tools/list` 会整份注入 AI 上下文，而 `component_render` 曾把 33 种组件类型的参数
> 取并集成 39 个扁平参数，单工具约 4.7k 字符。现在类型专属参数统一收进自由 `props` 对象
> （schema 压到 0.8k），细节写进本文档按需读取；插件端渲染器仍按 `params.xxx` 读参，
> 因此**历史平铺写法完全兼容**（两张写法在 `mergeComponentParams` 里合并，平铺覆盖 `props`）。
>
> 本文档由插件端实现逐个函数提取（`plugin-mastergo/lib/api/component-*.ts` 与 `componentHandlers.ts`），
> 默认值取自代码里的 `??` 回退；代码未写默认值的参数不臆造。

## 通用约定

| 参数 | 类型 | 必有 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 组件类型，33 项枚举见下 |
| `props` | object | 否 | 组件专属参数的自由对象；与平铺传参等效，**平铺优先** |
| `position` | `{ x?: number, y?: number }` | 否 | 画布位置，默认 `{ x: 100, y: 100 }` |
| `theme` | object | 否 | 设计令牌覆盖，`mode: "dark"` 推导暗色色板 |
| `parentId` | string | 否 | 挂到指定父节点下（自动布局集成）；先渲染到页面再 append，随后把 x/y 归零 |
| `name` | string | 否 | 根节点名（多数类型支持，见各类型默认值） |

两种写法任选其一，也可以混用：

```jsonc
// 写法 A：props 自由对象（新写法）
{ "type": "button", "props": { "label": "提交", "variant": "primary", "size": { "tier": "lg" } } }

// 写法 B：平铺（历史写法，仍然可用；同名键时覆盖 props）
{ "type": "button", "label": "提交", "variant": "primary", "size": { "tier": "lg" } }
```

### 共有参数形状

- **`label` / `title` / `content` / `placeholder` / `message` / `separator` / `initial`**：字符串文案，各类型默认值见下表。
- **`size`**：`{ tier?: 'sm' | 'md' | 'lg', width?, height?, cornerRadius?, fontSize?, paddingX?, ... }`。
  `tier`（默认 `md`）选一套预设，其余键**逐键覆盖预设值**（`getSize` = `{ ...预设, ...params.size }`，
  未匹配的 tier 不保证尺寸）。少数类型另用 `size.radius`、`size.rowGap`、`size.labelWidth`、
  `size.inputHeight`、`size.fieldGap`、`size.headerHeight`、`size.rowHeight`、`size.cellPadding` 等专属键。
- **`theme`**：`mergeTheme` 只接受 `design-theme.ts` 里 `DEFAULT_THEME` 的同名键（其它键被忽略）。
  常用键：`mode: 'light' | 'dark'`、`brand`(默认 `#4340EA`)、`brandHover`、`border`、`textPrimary`、
  `containerWidth`、`titleSize`、`labelSize`；`mode: 'dark'` 时按 `brand` 推导整套暗色令牌。
  单类型常用令牌：`buttonHeightMd`、`inputHeightMd`、`modalWidth`、`alertWidth`、`tabHeight`、
  `listItemHeight`、`menuItemHeight`、`accordionHeaderHeight`、`progressHeight`、`sliderTrackHeight`、
  `spinnerSize`、`tagHeight`、`tooltipFontSize`、`dividerThickness`、`paginationBtnSize`、`stepSize`。
- **颜色参数**（`bgColor` / `textColor` / `fillColor` / `color` / `activeBg`）：CSS 色串，默认多为品牌色或暗色文案色。

### 33 种类型索引

| 模块 | 类型 |
|------|------|
| `component-basic`（10） | `button`、`badge`、`avatar`、`toggle`、`progress`、`divider`、`tag`、`tooltip`、`spinner`、`skeleton` |
| `component-form`（7） | `checkbox-group`、`radio-group`、`checkbox`、`radio`、`text-input`、`select`、`slider` |
| `component-navigation`（5） | `menu`、`tabs`、`breadcrumb`、`pagination`、`steps` |
| `component-data`（8） | `list`、`accordion`、`card`、`table`、`form`、`toast`、`modal`、`alert` |
| `component-layout`（3） | `page-shell`、`feature-grid`、`pricing-table` |

---

## 图层命名契约（复用链的基础）

> 这一节是**唯一事实来源**。改预设时名字只能从这里取，不得自创同义词。

### 为什么要有契约：复用/覆写是**按图层名查找**的

整条组件复用链都不靠节点 id，而是拿名字在实例子树里找目标：

| 环节 | 实现 | 按什么找 |
|------|------|----------|
| 实例子节点覆写 | `plugin-mastergo/lib/api/dsl-renderer.ts` → `instance.findOne(n => n.name === childName)` | `element.overrides` 的键（就是子节点名） |
| 换组件继承覆写（MasterGo） | `plugin-mastergo/lib/api/swapComponentHandlers.ts` → `collectOverridesFromSubtree` | `node.name` |
| 换组件继承覆写（Penpot） | `plugin-penpot/lib/api/swapComponentHandlers.ts` → `collectCarryOver` | `props.name` |

所以**同一个语义在两个宿主里名字不同 = 静默断链**：不报错、不告警，只是覆写不生效。
真实事故：Penpot 侧建的 `Button / primary` 在 MasterGo 侧叫 `Button-primary`，按名字找不到；
toggle 的圆点一个叫 `Knob` 一个叫 `Thumb`，`Desc` / `Description` 同理。

### R1–R5（逐字遵守）

| 规则 | 内容 |
|------|------|
| **R1** | 每个节点必须有显式 `data-name`。**禁止**依赖客户端标签名兜底（`getAttribute('data-name') \|\| tag`） |
| **R2** | 保留**单值**子名（逐字）：`Label`、`Icon`、`IconRight`、`Title`、`Description`、`Content`、`Placeholder`、`Initial`、`Close`、`Track`、`Thumb`、`Fill`、`Header`、`Footer`、`Box`、`Tick`、`Circle`、`Dot`、`Line`、`Arc` |
| **R3** | 重复集合用 `<Role>-<i>`（`i` 从 0 起；二维用 `Cell-<row>-<col>`），`Role ∈ {Item, Row, Cell, Tab, Crumb, Step, Divider, Header, Icon, Feature, Tier, MenuItem, Checkbox, Radio}` |
| **R4** | 预设渲染**根名** `<Type>-<variant>`（分隔符只用 `-`，禁止 `/` 与空格），如 `Button-primary`、`Badge-danger`、`Button-primary-hover`、`TextInput`、`Toggle`、`Avatar`、`Progress`；无 variant 的类型用 `<Type>` 单段 |
| **R5** | **设计系统库（模板侧）根名**保持 `DS_<Type>_<Variant>`（如 `DS_Button_Primary`），**不改**。分工：**R4 = 临时预设渲染**（演示/占位，一次调用一个组件），**R5 = 建库产物**（`component_set` / 团队库 master，长期资产） |

补充口径（合同的一部分）：

- **R2 是「语义保留名」，不是唯一合法名集合。** 宿主本地子名（下面「宿主本地子名」小节）允许存在；
  但一旦该语义**跨宿主共享**（会被覆写/继承覆写命中），就必须收敛到 R2 名。
- **R3 的 Role 是闭合集合。** 分隔符只能叫 `Divider`（不能 `Sep` / `Separator`）；
  `renderDivider` 里那条**线**叫 `Line`（已升入 R2）。
- **组件内单值子名也可以进契约。** 像 `select` 的 `Arrow`、`accordion` 的 `Chevron`
  不在 R2 全局名单里，但它们是该组件的必需子名，任何生成本组件的实现都必须逐字使用（见下表）。
- 名字里**不得出现** `/`、空格、下划线、中文、小写开头。
- 名字通过变量传递时会绕过静态门禁（`name: btnName`），改名时必须同步改变量赋值处。

### 关键组件 → 保留子名

「逐字」指：任何宿主、任何实现，给该语义的节点都必须用这个名字。
「可选子名」列是 MasterGo 里存在、但服务端可以不渲染的节点（不存在不算违约，但不能换成别的名字）。

| 组件（`type`） | 根名（R4） | 必需子名（R2 / R3 / 集合） | 可选子名 |
|----------------|-----------|---------------------------|----------|
| `button` | `Button-<variant>` | `Label` | `Icon`、`IconRight` |
| `badge` | `Badge-<variant>` | `Label` | — |
| `avatar` | `Avatar` | `Initial` | — |
| `toggle` | `Toggle` | `Thumb` | `Track` |
| `progress` | `Progress` | `Track`、`Fill`、`Label` | — |
| `divider` | `Divider-<direction>` | `Line`、`Label` | `LabelBg` |
| `tag` | `Tag-<variant>` | `Label`、`Close` | — |
| `tooltip` | `Tooltip` | `Label` | — |
| `spinner` | `Spinner` | `Track`、`Arc` | — |
| `skeleton` | `Skeleton-<variant>` | `Row-<i>` | — |
| `checkbox-group` | `CheckboxGroup` | `Title`、`Checkbox-<key>`、`Label-<key>` | `Tick-<key>` |
| `radio-group` | `RadioGroup` | `Title`、`Radio-<key>`、`Label-<key>` | — |
| `checkbox` | `Checkbox` | `Box`、`Tick`、`Label` | — |
| `radio` | `Radio` | `Circle`、`Dot`、`Label` | — |
| `text-input` | `TextInput` | `Placeholder` | `Icon`、`Suffix` |
| `select` | `Select` | `Placeholder`、`Arrow` | — |
| `slider` | `Slider` | `Track`、`Fill`、`Thumb` | — |
| `menu` | `Menu` | `Item-<i>`、`Label-<i>`、`Divider-<i>` | `Icon-<i>` |
| `tabs` | `Tabs-<variant>` | `Tab-<i>`、`Label-<i>` | `Indicator` |
| `breadcrumb` | `Breadcrumb` | `Crumb-<i>`、`Divider-<i>` | `Label`、`Ellipsis` |
| `pagination` | `Pagination` | `Item-<i>`、`Label` | `Ellipsis` |
| `steps` | `Steps` | `Step-<i>`、`Label-<i>`、`Connector-<i>` | `Title` |
| `list` | `List` | `Item-<i>`、`Label`、`Divider-<i>` | `Icon`、`Badge`、`IconRight` |
| `accordion` | `Accordion` | `Header-<i>`、`Label`、`Chevron`、`Content`、`Divider-<i>` | — |
| `card` | `Card` | `Title`、`Content`、`FooterDivider`、`Label-<i>` | `Btn-<i>` |
| `table` | `Table` | `HeaderCell-<i>`、`Header-<i>`、`HeaderDivider-<i>`、`RowDivider-<i>`、`Cell-<row>-<col>` | — |
| `form` | `Form` | `Label-<i>`、`Input-<i>`、`Placeholder-<i>`、`SubmitBtn`、`SubmitLabel` | — |
| `toast` | `Toast-<variant>` | `Icon`、`Description` | `IconCircle` |
| `modal` | `Modal` | `Title`、`Content`、`Card`、`Close`、`FooterDivider`、`Btn-Confirm`、`Btn-Cancel`、`Label` | — |
| `alert` | `Alert-<variant>` | `Title`、`Content`、`Close` | — |

### 宿主本地子名（允许存在，但**不参与**跨宿主覆写契约）

下列名字不在 R2/R3 名单里，也不在上表的必需子名里，格式合规且只服务于单一宿主/
单一实现（或尚未被 `code_to_design` 落地的宿主专属预设）的布局细节，**允许保留**；
把某个语义提升为跨宿主共享时才需要改回 R2/R3 名：

`InnerDot`、`StepLabel`、`Sidebar`、`HeaderTitle`、`ContentPlaceholder`、
`PlanName`、`Price`、`PerMonth`、`CTA`、`CTALabel`

> 判据不是「好不好看」，而是「会不会被按名字覆写命中」。

### 机器门禁

契约不靠自觉，三个包各有一道源码级门禁（改预设时它们会红）：

| 文件 | 守什么 |
|------|--------|
| `mcp-server/tests/html-preprocessor-component-names.test.ts` | `<component>` 展开后 30 个生成器的 `data-name`：期望值从 33 个 `render*` **机械派生**；逐类型集合比对（参考集合 ∪ R2 ∪ R3 ∪ 根名）且包含上表必需名；**同级唯一**（每个元素的直接子元素 `data-name` 互不相同，专治 `Icon`×3）；R4 根名恰好一次 |
| `plugin-mastergo/tests/component-names.test.ts` | 5 个 `component-*.ts` 里所有 `name:` 字面量满足 R2 或合法形态；同义名黑名单（`Knob` / `Handle` / `Desc` / `Message` / `Measure` / `Sep` / `ProgressBar`）不得出现；R4 根名不得漂移 |
| `plugin-penpot/tests/component-names.test.ts` | `componentHandlers.ts` 里所有 `frame()` / `text()` / `svgPath()` 的名字字面量同样校验；**根名不得含 `/` 或空格**；覆盖范围仍是 15/33 |

---

## 1. 基础组件（component-basic.ts）

### button

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `variant` | string | `'primary'` | `primary` / `secondary` / `outline` / `text`；未知值回退 `primary` |
| `shape` | string | `'default'` | `pill` 时圆角取 `height / 2`，其它值为预设圆角 |
| `label` | string | `'Button'` | 按钮文字 |
| `icon` | string | 无 | 前置图标文字（emoji/字符） |
| `iconRight` | string | 无 | 后置图标文字 |
| `size.tier` | string | `'md'` | 预设：`sm`/`md`/`lg` → `buttonHeightSm/Md/Lg` 等 |
| `size.width` | number | 按文字估算 | 显式宽度；未传时按 `文字宽 + paddingX*2 + 图标宽` 估算 |
| `size` 覆盖 | — | — | 预设键 `height` / `fontSize` / `paddingX` / `radius` 均可逐键覆盖 |
| `states` | string[] | 无 | **多态模式**：只接受 `default`/`hover`/`active`/`disabled`，其余忽略；命中时返回 `{ container }`（并排状态组），否则返回 `{ frame }` |

### badge

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `label` | string | `'Badge'` | 徽标文字 |
| `variant` | string | `'default'` | `default` / `success` / `warning` / `danger` / `info`；未知值回退 `default` |
| `size.tier` | string | `'md'` | `sm`/`md`/`lg` → 高度与字号预设 |
| `size` 覆盖 | — | — | `height` / `fontSize` / `paddingX` |

### avatar

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `initial` | string | `'U'` | 头像首字母（字号 `size * 0.4`） |
| `size.width` | number | `36` | 宽高同值，圆角取 `size / 2` |
| `bgColor` | string | 品牌色 `theme.brand` | 背景色 |
| `textColor` | string | `#FFFFFF` | 文字色 |

> `avatar` 只读 `size.width`，不接受 `size.tier`。

### toggle

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `checked` | boolean | `true`（`!== false`） | 打开时填充品牌色、把手右移 |
| `size.tier` | string | `'md'` | `sm`/`md`/`lg` → `toggleWidth*` / `toggleHeight*` |
| `size` 覆盖 | — | — | 预设键 `w` / `h` 可覆盖（高度 > 宽度会抛错） |

### progress

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `percent` | number | `60` | 百分比，钳制到 `0–100` |
| `showLabel` | boolean | `true`（`!== false`） | 是否在下方显示 `xx%` |
| `fillColor` | string | `theme.progressFillColor` | 填充色 |
| `name` | string | `'Progress'` | 根节点名（R4；旧默认值 `'ProgressBar'` 与 Penpot 侧漂移，已统一） |
| `size.width` | number | `300` | 轨道宽度 |
| `size.height` | number | `theme.progressHeight`（6） | 轨道高度 |
| `size.cornerRadius` | number | `theme.progressCornerRadius`（3） | 轨道/填充圆角 |

### divider

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `direction` | string | 水平 | `vertical` 时渲染竖线；其它值为水平 |
| `label` | string | `''` | 有值时在水平线中间加标签底衬（仅水平） |
| `color` | string | `theme.dividerColor`（`#E0E0E0`） | 线色 |
| `name` | string | `'Divider'` | 根节点名 |
| `size.height` | number | `1` | 线厚度；**垂直时同时用作长度**（默认长度 `120`） |
| `size.width` | number | `300` | 水平长度 |

### tag

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `label` | string | `'Tag'` | 标签文字 |
| `variant` | string | `'default'` | `default` / `primary` / `success` / `warning` / `danger`；未知值回退 `default` |
| `closable` | boolean | `true`（`!== false`） | 是否显示右侧关闭叉 |
| `size.height` | number | `theme.tagHeight`（28） | 高度 |
| `size.fontSize` | number | `theme.tagFontSize`（13） | 字号 |
| `size.paddingX` | number | `theme.tagPaddingX`（12） | 水平内边距 |
| `size.cornerRadius` | number | `theme.tagCornerRadius`（6） | 圆角 |

### tooltip

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `label` | string | `'提示文字'` | 提示正文 |
| `name` | string | `'Tooltip'` | 根节点名 |
| `size.fontSize` | number | `theme.tooltipFontSize`（12） | 字号 |
| `size.paddingX` | number | `theme.tooltipPadding`（8） | 内边距（竖直取 `padding * 1.2`） |
| `size.cornerRadius` | number | `theme.tooltipCornerRadius`（4） | 圆角 |

### spinner

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `showTrack` | boolean | `true`（`!== false`） | 是否渲染轨道环 |
| `showLabel` | **string** | `''` | **标签文字（不是布尔开关）**，非空时在下方显示并加高 20 |
| `color` | string | `theme.spinnerColor` | 旋转弧颜色 |
| `name` | string | `'Spinner'` | 根节点名 |
| `size.width` | number | `theme.spinnerSize`（32） | 直径 |

> `spinner` 通过 `mg.createNodeFromSvgAsync` 渲染；宿主不支持时降级为空 frame。

### skeleton

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `variant` | string | `'text'` | `circle` 时每行渲染为圆（直径取 `size.height`）；其它值为矩形 |
| `rows` | number | `1` | 行数 |
| `name` | string | `'Skeleton'` | 根节点名 |
| `size.width` | number | `200` | 矩形宽度 |
| `size.height` | number | `20` | 行高 |
| `size.rowGap` | number | `8` | 行间距 |
| `size.cornerRadius` | number | `4` | 矩形圆角 |

---

## 2. 表单组件（component-form.ts）

### checkbox-group / radio-group

两者参数一致，仅默认标题与子节点名不同。

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `states` | `StateConfig[]` | `buildCheckboxRadioStates(theme)`（5 态：Unchecked / Checked / Hover / DisabledUnchecked / DisabledChecked） | 每项 `{ key, label, bg, stroke, checked, disabled, textColor }` |
| `title` | string | `'Checkbox 复选框状态'` / `'Radio 单选框状态'` | 容器标题 |
| `name` | string | `'CheckboxGroup'` / `'RadioGroup'` | 容器名 |

> 容器宽度固定取 `theme.containerWidth`（400）、高度固定 320，不接受 `size`。

### checkbox / radio

两者参数一致。

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `checked` | boolean | `true`（`!== false`） | 选中态（`radio` 选中显示内圆点，`checkbox` 显示勾） |
| `disabled` | boolean | `false`（`=== true`） | 禁用态改底色/描边/文字色 |
| `label` | string | `'选项'` | 右侧文案 |
| `size.width` | number | `theme.componentSize`（16） | 方框/圆直径；总宽 = 尺寸 + 8 + 文字估宽 |

### text-input

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `placeholder` | string | `'请输入内容...'` | 占位文字 |
| `icon` | string | 无 | 前置图标文字（会把占位文字右推） |
| `suffix` | string | 无 | 右侧后缀图标文字 |
| `size.tier` | string | `'md'` | `sm`/`md`/`lg` → `inputHeight*` / 字号 / 内边距 |
| `size.width` | number | `248` | 宽度 |
| `size.cornerRadius` | number | `theme.componentCornerRadius`（6） | 圆角 |
| `size` 覆盖 | — | — | `height` / `fontSize` / `paddingX` |

### select

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `placeholder` | string | `'请选择'` | 占位文字 |
| `size.tier` | string | `'md'` | `sm`/`md`/`lg` → 高度/字号/内边距/箭头缩放 |
| `size.width` | number | `200` | 宽度 |
| `size.cornerRadius` | number | `theme.componentCornerRadius`（6） | 圆角 |

### slider

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `percent` | number | `50` | 百分比，钳制到 `0–100`（同时决定手柄位置） |
| `handleSize` | number | `theme.sliderHandleSize`（20） | 手柄直径 |
| `name` | string | `'Slider'` | 根节点名 |
| `size.width` | number | `260` | 轨道宽度 |
| `size.height` | number | `theme.sliderTrackHeight`（4） | 轨道高度 |

---

## 3. 导航组件（component-navigation.ts）

### menu

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | object[] | 4 项示例（含 `{ type: 'divider' }`） | 每项 `{ label, icon?, danger?, type?: 'divider' }`；`divider` 项渲染分割线（高 9） |
| `size.width` | number | `180` | 菜单宽度 |
| `size.height` | number | `theme.menuItemHeight`（32） | 菜单项高度 |
| `size.paddingX` | number | `theme.menuItemPaddingX`（12） | 菜单项左右内边距 |
| `size.cornerRadius` | number | `theme.menuCornerRadius`（8） | 卡片圆角 |
| `name` | string | `'Menu'` | 根节点名 |

### tabs

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | string[] | `['Tab 1', 'Tab 2', 'Tab 3']` | 标签文字 |
| `activeIndex` | number | `0` | 激活标签索引 |
| `variant` | string | 无 | `'underline'` 时渲染下划线样式标签；其它值为填充块 |
| `showIndicator` | boolean | `true`（`!== false`） | 下划线模式下是否显示激活指示条 |
| `size.width` | number | `400` | 总宽（按标签数均分） |
| `size.height` | number | `theme.tabHeight`（40） | 标签高度 |
| `size.fontSize` | number | `14` | 字号 |
| `name` | string | `'Tabs'` | 根节点名 |

### breadcrumb

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | string[] | `['首页', '分类', '详情']` | 面包屑文字（最后一项加粗为当前页） |
| `separator` | string | `theme.breadcrumbSeparator`（`'/'`） | 分隔符 |
| `size.fontSize` | number | `theme.breadcrumbFontSize`（13） | 字号 |
| `name` | string | `'Breadcrumb'` | 根节点名 |

### pagination

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `current` | number | `1` | 当前页码 |
| `total` | number | `50` | 总条数（`totalPages = ceil(total / pageSize)`，随返回值返回） |
| `pageSize` | number | `10` | 每页条数 |
| `gap` | number | `theme.paginationBtnGap`（4） | 按钮间距 |
| `activeBg` | string | `theme.paginationActiveBg` | 激活按钮背景色 |
| `size.width` | number | `theme.paginationBtnSize`（36） | 按钮边长 |
| `name` | string | `'Pagination'` | 根节点名 |

> 页数 ≤7 时全展示，否则用 `...` 折叠中间页；始终渲染上一页/下一页图标按钮。

### steps

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | string[] | `['步骤一', '步骤二', '步骤三']` | 步骤标题 |
| `current` | number | `1` | 当前步骤（小于它的画勾、等于的画高亮数字） |
| `direction` | string | `'horizontal'` | `vertical` 时竖直排列；其它值为水平 |
| `size.width` | number | `theme.stepSize`（32） | 步骤圆直径 |
| `size.fontSize` | number | `theme.stepFontSize`（13） | 标签字号 |
| `name` | string | `'Steps'` | 根节点名 |

---

## 4. 数据组件（component-data.ts）

### list

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | object[] | 3 项示例 | 每项 `{ label, icon?, avatar?, badge? }`；`avatar`/`icon` 取其一显示在左，`badge` 显示在右 |
| `size.width` | number | `320` | 列表宽度 |
| `size.height` | number | `theme.listItemHeight`（44） | 行高 |
| `size.paddingX` | number | `theme.listItemPaddingX`（16） | 左右内边距 |
| `size.cornerRadius` | number | `8` | 卡片圆角 |
| `name` | string | `'List'` | 根节点名 |

### accordion

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `items` | object[] | 3 项示例（首项 `expanded: true`） | 每项 `{ label, content?, expanded? }` |
| `bordered` | boolean | `true`（`!== false`） | 关闭时无描边、无圆角 |
| `size.height` | number | `theme.accordionHeaderHeight`（48） | 头部高度 |
| `size.paddingX` | number | `theme.accordionContentPadding`（16） | 内容内边距 |
| `size.cornerRadius` | number | `theme.accordionCornerRadius`（8） | 圆角 |
| `name` | string | `'Accordion'` | 根节点名 |

> 宽度按最长 `label` 估算：`max(label 数 × 15 + 80, 300)`。

### card

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `title` | string | `'Card Title'` | 标题 |
| `content` | string | `'Card content goes here.'` | 正文（行数按字数估算，自动撑高） |
| `footer` | boolean | `true`（`!== false`） | 是否渲染底部按钮区 |
| `footerButtons` | string[] | `['Cancel', 'Confirm']` | 底部按钮文案（最后一个为主按钮） |
| `size.width` | number | `320` | 卡片宽度 |
| `size.paddingX` | number | `24` | 内边距 |
| `size.cornerRadius` | number | `12` | 圆角 |
| `name` | string | `'Card'` | 根节点名 |

### table

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `columns` | string[] | 3 列表头 | 表头文字（等分宽度） |
| `rows` | string[][] | 3×3 示例 | 数据行，单元格文字 |
| `size.width` | number | `400` | 表格宽度 |
| `size.headerHeight` | number | `40` | 表头高度 |
| `size.rowHeight` | number | `36` | 数据行高 |
| `size.cellPadding` | number | `12` | 单元格左内边距 |
| `size.cornerRadius` | number | `8` | 圆角 |
| `name` | string | `'Table'` | 根节点名 |

### form

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `fields` | object[] | 3 项示例（text/email/password） | 每项 `{ label, type?, placeholder? }`；`type` 仅记录不改变渲染 |
| `submitLabel` | string | `'Submit'` | 提交按钮文案 |
| `size.width` | number | `320` | 表单宽度 |
| `size.labelWidth` | number | `80` | 左侧标签列宽 |
| `size.inputHeight` | number | `36` | 输入框高度 |
| `size.fieldGap` | number | `16` | 字段间距 |
| `size.paddingX` | number | `24` | 内边距 |
| `size.cornerRadius` | number | `8` | 圆角 |
| `name` | string | `'Form'` | 根节点名 |

### toast

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `message` | string | `'Toast message'` | 提示文字 |
| `type` | string | `'info'` | 代码里声明了 `success` / `warning` / `error` / `info`（决定底色与图标），**但经 `component_render` 调用时不可达**：`renderToast` 读的 `params.type` 恰好是组件类型本身（值恒为 `'toast'`），未知值回退 `info`——所以实际总是渲染 info 样式（已知代码冲突，未修复） |
| `size.width` | number | `280` | 宽度 |
| `size.height` | number | `48` | 高度 |
| `size.cornerRadius` | number | `8` | 圆角 |
| `name` | string | `'Toast'` | 根节点名 |

### modal

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `title` | string | `'提示'` | 标题 |
| `content` | string | `''` | 正文（空则不渲染正文行） |
| `confirmLabel` | string | `'确认'` | 主按钮文案 |
| `cancelLabel` | string | `'取消'` | 次按钮文案 |
| `showCancel` | boolean | `true`（`!== false`） | 是否渲染取消按钮 |
| `closable` | boolean | `true`（`!== false`） | 是否渲染右上角关闭叉 |
| `size.width` | number | `theme.modalWidth`（400） | 卡片宽度（遮罩再宽 60） |
| `size.fontSize` | number | `theme.titleSize`（18） | 标题字号 |
| `size.paddingX` | number | `theme.modalPadding`（24） | 内边距 |
| `size.cornerRadius` | number | `theme.modalCornerRadius`（16） | 卡片圆角 |
| `name` | string | `'Modal'` | 遮罩节点名（返回 `container` = 遮罩，`card` = 卡片） |

### alert

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `title` | string | `'提示'` | 标题 |
| `content` | string | `''` | 正文（空则不渲染） |
| `variant` | string | `'info'` | `success` / `warning` / `error` / `info`；未知值回退 `info`（决定底色/描边/图标） |
| `closable` | boolean | `true`（`!== false`） | 是否渲染右侧关闭叉 |
| `size.width` | number | `theme.alertWidth`（380） | 宽度 |
| `size.fontSize` | number | `14` | 基准字号（标题 `+2`、正文 `-1`） |
| `size.paddingX` | number | `16` | 内边距 |
| `size.cornerRadius` | number | `theme.alertCornerRadius`（8） | 圆角 |
| `name` | string | `Alert-${variant}` | 根节点名 |

---

## 5. 布局组件（component-layout.ts）

### page-shell

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `title` | string | `'页面标题'` | 顶栏标题 |
| `sidebar` | boolean | `true`（`!== false`） | 是否渲染侧边栏 |
| `sidebarWidth` | number | `240` | 侧边栏宽度 |
| `headerHeight` | number | `64` | 顶栏高度 |
| `menuItems` | string[] | `['仪表盘', '项目', '团队', '设置']` | 侧边栏菜单项（首项为激活态） |
| `size.width` | number | `1440` | 整体宽度（高度固定 900） |
| `name` | string | `'PageShell'` | 根节点名 |

### feature-grid

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `columns` | number | `3` | 每行列数 |
| `items` | object[] | 3 项示例 | 每项 `{ icon?, title, desc }`（图标默认 `⚡`） |
| `name` | string | `'FeatureGrid'` | 根节点名 |

> 卡片固定 280×180、间距 24；行数由 `items.length / columns` 推得。不接受 `size`。

### pricing-table

| 参数 | 类型 | 默认值 / 取值 | 说明 |
|------|------|---------------|------|
| `tiers` | object[] | 3 档示例 | 每项 `{ name, price, features: string[], cta, popular? }`；`popular: true` 用品牌色描边与高亮底 |
| `name` | string | `'PricingTable'` | 根节点名 |

> 卡片固定 280×400、间距 24；不接受 `size`。

---

## 维护说明（新增组件类型时）

1. 在对应模块实现 `renderXxx(params)`，按 `params.xxx` 读参（这样两种写法都能工作）。
2. 登记到 `plugin-mastergo/lib/api/componentHandlers.ts` 的 `COMPONENT_RENDERERS` 映射
   （`type` 枚举值 → 渲染器），并把新 type 加进服务端
   `mcp-server/src/utils/tools/components.ts` 的 `type.enum`。
3. 在本文档补一小节：参数清单、默认值、取值枚举。
