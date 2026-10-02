# ds-spec —— 设计系统规范（v2 · 单一事实来源）

> 状态：**首版（P0-4）** · 2026-10-01
> 关联：`templates/ds-library.html`（本规范的**实现**模板）、`rules/16-component-catalog.md`（预设组件契约）、
> `rules/17-host-differences.md`（跨宿主差异）、`plans/design-system-v2.md`（建设计划）
>
> **关系**：本文件是**契约**，模板是**实现**。改令牌/组件/轴，先改这里，再改模板；
> 二者必须能互相核对：规范里的每个令牌都能在模板（进而画布）找到对应节点，反向亦然。

---

## 0. 模型与边界

- **令牌三层**：`reference`（原始值）→ `system`（语义角色）→ `component`（组件专属覆写）。
  界面只引用 `system` / `component`，**不直接引用 reference**。
- **命名**：`<tier>.<category>.<role>`，段内可用连字符（见 §1 的 `-hover` / `-muted`）。
- **Penpot 约束**：令牌名是**路径层级**，同一集合不能同时存在 `a.b` 与 `a.b.c` —— 所以带子级的角色
  必须打平为同级连字符（`system.color.primary-hover`），**不能**写 `system.color.primary.hover`。
- **不做**（见计划 §6）：动态取色、种子色推导、网格布局落地、单边描边无损。

---

## 1. 令牌三层表

字段：`tier · name · value · 用途 · 允许绑定属性`（属性名沿用 Penpot `TokenProperty`，`fill` 已真机验证）。

### 1.1 reference（原始值 · 仅在 system 层内部引用）

| name | value | 用途 |
|---|---|---|
| `ref.indigo.600` | `#4F46E5` | 品牌色原始值 |
| `ref.indigo.700` | `#3730C4` | 品牌色（深）原始值 |
| `ref.sky.500` | `#0284C7` | 信息色原始值 |
| `ref.slate.900` | `#0F172A` | 正文色原始值 |
| `ref.slate.500` | `#64748B` | 次级文字原始值 |
| `ref.slate.200` | `#E2E8F0` | 描边原始值 |

### 1.2 system（语义角色 · 界面直接引用）

| name | value | 用途 | 允许绑定 |
|---|---|---|---|
| `system.color.primary` | `#4340EA` | 主操作 / 品牌 | `fill` |
| `system.color.primary-hover` | `#3730C4` | 主操作 hover | `fill` |
| `system.color.text` | `#0F172A` | 主文字 | `fill`（文本：`textFill`） |
| `system.color.text-muted` | `#64748B` | 次级文字 | `fill`（文本：`textFill`） |
| `system.color.border` | `#E2E8F0` | 分隔 / 描边 | `stroke` / `fill` |
| `system.color.success` | `#16A34A` | 成功 | `fill` |
| `system.color.warning` | `#D97706` | 警告 | `fill` |
| `system.color.danger` | `#DC2626` | 危险 / 错误 | `fill` |

### 1.3 component（组件专属覆写）

| name | value | 用途 | 允许绑定 |
|---|---|---|---|
| `component.button.bg` | `#4340EA` | Button 主色底 | `fill` |
| `component.button.text` | `#FFFFFF` | Button 文字 | `fill`（`textFill`） |
| `component.badge.info.bg` | `#E0F2FE` | Badge info 底 | `fill` |

### 1.4 声明已就位、宿主令牌待建（P1-1）

模板里以下角色节点带 `data-token-*` **声明**，但对应宿主令牌（`variable_create`）**尚未建立**，
因此当前渲染只绑定色值（§1.1–1.3）；补齐后即可复用同一条绑定/传播管线：

| 声明属性 | 名称 | 值 |
|---|---|---|
| `data-token-radius` | `system.radius.sm` / `.md` / `.full` | 4 / 8 / 9999 |
| `data-token-text` | `system.typography.h1` / `.h2` / `.body` / `.label` | 见 §4.3 |

> **核对口径**：`templates/ds-library.html` 的 `Tokens` 段每个角色 section 的 `data-name` 必须等于上表
> 的 `name`；带绑定的 swatch 的 `data-token-fill` 必须等于 `name`。

---

## 2. 组件清单与状态矩阵

成员命名契约 **R6**：`<Type>_<Variant>_<State>`（首段=类型=变体集容器名，其余段=轴值）。
预设内部子名契约见 `rules/16-component-catalog.md`（R2）。

| 组件 | 变体（Variant） | 状态（State） | 尺寸档 | 必需子名（R2） |
|---|---|---|---|---|
| Button | `Primary` / `Secondary` / `Outline` / `Text` | `Default` / `Hover` / `Disabled` | sm / md / lg | `Label`（+ `Icon` / `IconRight` 可选） |
| Badge | `Info` / `Success` / `Warning` / `Danger` / `Default` | `Default` | sm / md / lg | `Label` |
| Input（text-input） | `Default` | `Default` / `Focus` / `Disabled` | sm / md / lg | `Placeholder` |
| Toggle | `Default` | `Off` / `On` / `Disabled` | sm / md / lg | `Track` / `Thumb` |

**DS 库模板当前覆盖**（`templates/ds-library.html` ② Components）：

- Button 6 成员：`Button_{Primary,Secondary}_{Default,Hover,Disabled}`
- Badge 4 成员：`Badge_{Info,Success,Warning,Danger}_Default`
- Input 3 成员：`Input_Default_{Default,Focus,Disabled}`
- Toggle 3 成员：`Toggle_Default_{Off,On,Disabled}`
- 合计 **16** 成员 → 4 个原生变体集。

**状态视觉约定**（写进模板的实现，不是令牌）：

| State | 视觉 |
|---|---|
| Default | 基色 |
| Hover | 品牌深色（`system.color.primary-hover`）；次要按钮用浅底 |
| Disabled | `opacity 0.4`（不新增令牌） |
| Focus | 2px 品牌描边 + 2px offset 焦点环（见 §5） |

---

## 3. 变体轴定义

| 轴名 | 来源 | 轴值枚举 | 备注 |
|---|---|---|---|
| `Variant` | 成员名第 2 段 | 组件的变体枚举（§2） | 必填 |
| `State` | 成员名第 3 段 | 组件的状态枚举（§2） | 必填（无状态时用 `Default`） |
| `Size` | 预留（第 4 段） | `sm` / `md` / `lg` | **P0.5 后启用**；当前模板用独立成员表达尺寸，不放进轴 |

- 轴值规则：仅 `[A-Za-z0-9]`（`_` 是段分隔符；含连字符会与段分隔冲突，避免）；
- 轴名固定词表：`Variant` / `State` / `Size`；
- 成员名示例：`Button_Primary_Hover` → `Variant=Primary, State=Hover`；
- 建库命令：`node_convert_to_component({ containerId: <Components frame>, combineVariants: true, variantPropertyName: "Variant,State" })`
  —— 见 `rules/07-mcp-tools.md` 的「变形二」。

**宿主差异**：Penpot 原生多轴（已真机验证）；MasterGo 名驱动、多轴待验（§7）。

---

## 4. 度量阶梯

### 4.1 间距（space）

| 角色 | 值 | 典型用途 |
|---|---|---|
| `space.1` | 4 | 图标与文字 |
| `space.2` | 8 | 紧凑内距 |
| `space.3` | 12 | 组内元素 |
| `space.4` | 16 | 组件内距（默认） |
| `space.6` | 24 | 组件之间 |
| `space.8` | 32 | 区块内距 |
| `space.12` | 48 | 区块之间 |
| `space.16` | 64 | 页面级 |

### 4.2 圆角（radius）

| 角色 | 值 | 典型用途 |
|---|---|---|
| `radius.sm` | 4 | 标签 / 徽标 |
| `radius.md` | 8 | 按钮 / 卡片 / 输入 |
| `radius.full` | 9999 | 胶囊 / 头像 |

### 4.3 字阶（typography）

| 角色 | size / weight / line-height | 用途 |
|---|---|---|
| `typography.h1` | 32 / 700 / 40 | 页面标题 |
| `typography.h2` | 24 / 700 / 32 | 区块标题 |
| `typography.body` | 14 / 400 / 22 | 正文 |
| `typography.label` | 12 / 600 / 16 | 标签 / 徽标 / 说明 |

字体族：Penpot 侧用 `Noto Sans TC`（覆盖中文）；**根节点必须显式指定字体族**（见 `17-host-differences.md §2.1`）。

### 4.4 层级（elevation）

| 角色 | 阴影 | 用途 |
|---|---|---|
| `elevation.sm` | `0 1px 2px rgba(0,0,0,0.05)` | 卡片 / 按钮 |
| `elevation.md` | `0 4px 6px rgba(0,0,0,0.07)` | 下拉 / 菜单 |
| `elevation.lg` | `0 10px 25px rgba(0,0,0,0.10)` | 弹窗 / 对话框 |
| `elevation.xl` | `0 20px 25px rgba(0,0,0,0.15)` | 通知 / 浮层 |

### 4.5 动效（motion）

| 角色 | 值 |
|---|---|
| `motion.duration.fast` | 150ms |
| `motion.duration.normal` | 250ms |
| `motion.duration.slow` | 400ms |
| `motion.easing.standard` | `ease-out` |

---

## 5. 可访问性基线

| 项 | 要求 | 检查方式 |
|---|---|---|
| 文本对比度 | 正文/标签文字对底色 **≥ 4.5:1**；大字号（≥ 24px 或 ≥ 18.66px bold）≥ 3:1 | `system.color.text`(#0F172A) 对白底 = 16.75:1 ✅；`text-muted`(#64748B) 对白底 = 4.76:1 ✅ |
| 焦点环 | **2px 品牌色描边 + 2px offset**，不得仅靠颜色变化 | 模板 `State-Focus`；按钮 `Focus` 态 |
| 最小点击区 | **≥ 44×44 px**（触控）；桌面密排 ≥ 32×32 | 按钮 md = 40 高（含内距可达 44）；sm 档用于非主要操作 |
| 不只用颜色传达状态 | Disabled / Error 需配合文案或图标 | `Usage` 段 Do/Don't |

> 自动检查见 **P1-3**：并入已有工具 `design_review`（遵守工具面预算门禁，**不新增工具**）。它先调 `design/describe`
> （兼容 MasterGo `{tree}` 与 Penpot `{nodes:[…]}` 两种形态），再跑结构启发式 + 下面的可访问性硬指标。

### 5.1 自动检查口径（`mcp-server/src/utils/a11y-review.ts`）

| rule | 判据 | 严重度 |
|---|---|---|
| `contrast` | WCAG 2.1 AA 相对亮度比值：正常字号 ≥ 4.5:1；大字号（≥24px，或 ≥18.66px 且 weight ≥700）≥ 3:1 | `error` |
| `focus-ring` | 名字以 **`_Focus`** 结尾的成员必须有 **≥2px 描边**（不得仅靠颜色变化） | `error` |
| `hit-area` | 交互元素（名字含 Button/Btn/Input/Toggle/Checkbox/Radio/Link/Tab/Switch/Select/Slider）：任一边 < 32 → `error`；32–44 → `warning`（触控推荐 44） | `error` / `warning` |

- 背景色取**最近的、完全不透明的祖先填充**；半透明 / 渐变 / 图片填充、取不到色的文本 → 进 `a11y.skipped` 如实上报，**不谎报通过**；
- `design_review` 返回 `issues[]`（每条带 `rule` / `path` / `evidence`）与 `a11y.checked`、`a11y.skipped`。

### 5.2 已知例外（有意为之，不算违规）

| 项 | 现状 | 理由 |
|---|---|---|
| 按钮 / 输入框高 40px | `hit-area` **warning**（非 error） | 桌面密排规格（ds-spec §4）；触控场景需容器留白补足 44 |
| 开关轨道 44×24 | `hit-area` **error**（未消除，已登记） | 开关轨道尺寸是行业惯例；**实际点击区应由容器留白补足 ≥44×44**，模板当前只画了轨道 |
| 焦点环 offset（2px） | 未自动检查 | `design/describe` 不暴露描边 offset；只能人核 |

---

## 6. 库样式清单（P1-1 落地点）

渲染 `templates/ds-styles.html` 后调 `library_register_styles({ parentId: <DS-Styles 内容根> })`
注册为**宿主原生库样式**；此表是唯一清单来源。宿主返回的 `style_list_colors/text` 字段：
`name`（叶子名）+ `path`（节点层级/分组）。

### 6.1 颜色样式（Paint / LibraryColor）9 个

| name | path | 令牌 | 值 |
|---|---|---|---|
| `Brand Primary` | `DS-Styles / Brand` | `system.color.primary` | `#4340EA` |
| `Brand Hover` | `DS-Styles / Brand` | `system.color.primary-hover` | `#3730C4` |
| `Text Default` | `DS-Styles / Text` | `system.color.text` | `#0F172A` |
| `Text Muted` | `DS-Styles / Text` | `system.color.text-muted` | `#64748B` |
| `Border Default` | `DS-Styles / Border` | `system.color.border` | `#E2E8F0` |
| `Success` | `DS-Styles / Semantic` | `system.color.success` | `#16A34A` |
| `Warning` | `DS-Styles / Semantic` | `system.color.warning` | `#D97706` |
| `Danger` | `DS-Styles / Semantic` | `system.color.danger` | `#DC2626` |
| `Badge Info Bg` | `DS-Styles / Badge` | `component.badge.info.bg` | `#E0F2FE` |

### 6.2 文字样式（Text / LibraryTypography）4 个

| name | path | 令牌 | size / weight / line-height |
|---|---|---|---|
| `H1` | `Heading` | `system.typography.h1` | 32 / 700 / 40 |
| `H2` | `Heading` | `system.typography.h2` | 24 / 700 / 32 |
| `Regular` | `Body` | `system.typography.body` | 14 / 400 / 22 |
| `Strong` | `Label` | `system.typography.label` | 12 / 600 / 16 |

> **叶子名必须唯一**：Penpot 把样式名里的 `/` 当文件夹分隔（`Heading/H1` → name `H1`, path `Heading`）；
> 若两个样本叶子同名（如都叫 `Default`），upsert 只能改到其中一个。故用 `Regular` / `Strong` 区分。

> **注册输入**：`templates/ds-styles.html` —— 色板节点的**自身名**就是 `name`（需含角色词）；
> 排版样本的 `Heading/H1` 形式用 `/` 拆成 `name=H1, path=Heading`。
>
> **可重入**：`library_register_styles` **按名 upsert**（命中同名改写、否则新建），返回
> `counts: { created, updated }`。原因：Penpot 插件 API **删不掉样式**（官方 api_types.yml 无
> `remove()`/`removeColor`），不 upsert 就会永久翻倍（见 `17-host-differences.md §4.3`）。
> 若之前已产生历史重复，只能在 Penpot UI 手动清。

---

## 7. 宿主差异声明

以下差异**必须在实现里显式降级**，不得假装一致（完整清单见 `rules/17-host-differences.md`）：

| 能力 | Penpot | MasterGo | 本规范口径 |
|---|---|---|---|
| 令牌绑定 | ✅ `shape.applyToken`（真绑定；改值需 `propagateToken`） | ❌ 无绑定通道 | `data-token-*` 仅在 Penpot 生效；MasterGo 如实 `available:false` |
| 多轴变体 | ✅ 原生（已验 `["Variant","State"]`） | ⏳ 名驱动、多轴待验 | 模板用双轴；MasterGo 单轴降级 |
| 令牌名层级 | 路径（叶子不能是前缀） | 分组路径 | 统一用**同级连字符**打平 |
| 库样式 | `LibraryColor` / `LibraryTypography`（活引用） | Paint / Text / Effect / Spacing（拷贝语义） | §6 清单两适配 |
| 网格布局 | ❌ 未接线 | ✅ | 用 flex；不写 `GRID` |
| 单边描边 | 叠加 Path 模拟（角部重叠） | 原生 | 不在 Penpot 依赖单边描边做视觉关键 |
| 字体 | Google Fonts 镜像（中文 `Noto Sans TC`） | 系统字体 | 根节点显式字体族 |

---

## 附：与计划任务的对应

| 本规范节 | 落地的计划任务 |
|---|---|
| §1 令牌 | P0-3（`data-token-*` 绑定，已完成）、P1-1（样式注册） |
| §2 / §3 组件与轴 | P0-1（模板，已完成）、P0-2（变体集，已完成） |
| §4 度量 | 模板静态实现 |
| §5 可访问性 | P1-3（自动检查） |
| §6 库样式 | P1-1 |
| §7 宿主差异 | P1-2（MasterGo 对齐，延后） |
