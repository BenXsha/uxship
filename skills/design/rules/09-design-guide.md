# 设计指南

## 组件化设计原则（关键规则）

> **核心规则**：生成设计时，必须识别出可复用的 UI 原子组件，优先创建为 `component` Master，再通过 `instance` 引用复用。禁止为重复出现的相同组件各自创建独立 frame。

### 原子组件清单

以下组件在页面中出现 **2 次及以上** 时，必须创建为 component Master 并通过 instance 引用：

| 类别 | 组件 | 识别特征 |
|------|------|----------|
| 按钮 | PrimaryButton / SecondaryButton / OutlineButton / TextButton / IconButton | 固定尺寸、品牌色/灰色背景、圆角、居中文字 |
| 输入 | TextInput / SearchInput / Textarea | 白色背景、1px 描边、圆角、占位文字 |
| 选择 | Select / Dropdown / MenuItem | 下拉箭头图标、灰色描边、圆角 |
| 单选 | Radio (checked/unchecked) | 16×16 满圆、品牌色/灰色 |
| 复选 | Checkbox (checked/unchecked) | 16×16 圆角、品牌色/灰色 + 勾选路径 |
| 徽标 | Badge / Tag / StatusDot | 小尺寸、圆角或满圆、纯色背景 |
| 图标 | Icon_* | 24×24 frame + svg 元素 |
| 导航 | NavItem / Tab / Breadcrumb | 文字 + 可选下划线/背景色 |
| 头像 | Avatar | 圆形/圆角、图片或文字首字母 |
| 切换 | Switch / Toggle | 长条圆角背景 + 圆形滑块 |

### 不适用组件的场景
- 一次性使用的独有元素（如页面标题、装饰性插图）
- 结构差异大、无法统一抽象的复合组件
- `template` / `tree` 类型生成的元素（已由内部展开，无需额外封装）

### Component Master/Instance 创建步骤

当需要创建可复用的组件 Master 时，使用以下 API 工作流：

**第1步：创建 Component Master**
```
node_create({ type: "component", name: "PrimaryButton",
  properties: { size: {width:88,height:32}, cornerRadius:4, fills: [{type:"SOLID",color:"#4340EA"}],
    flexMode: "HORIZONTAL", mainAxisAlignItems:"CENTER", crossAxisAlignItems:"CENTER" } })
```

**第2步：创建子节点（Master 内容）**
```
node_create({ nodes: [{ type: "text", parentId: "<masterId>",
  properties: { characters: "Button", fontSize: 14, fontName: {family:"Inter",style:"Bold"},
    fills: [{type:"SOLID",color:"#FFFFFF"}], textAutoResize:"WIDTH_AND_HEIGHT", name:"Label" } }])
```

**第3步：在页面中引用 Instance**
```
node_create({ type: "instance", properties: { componentId: "<masterId>", x: 100, y: 200, name: "PrimaryButton_1" } })
```

> **注意**：Instance 的子节点自动继承 Master，不可通过 `node_create` 向 Instance 添加子节点。

### 后置提取工作流（页面渲染后抽取组件）

当页面已通过 `code_to_design` 渲染完成，发现多处结构相同的元素组（卡片、列表项、按钮等）时，可后置提取为 Component Master：

**第1步：识别与导出**
```
selection_get         → 选中一个典型实例
dsl_export_node(id)    → 导出其 DSL 结构，分析哪些属性是变量（x, y, name）vs. 固定值
```

**第2步：创建 Component Master**
```
node_create({ type: "component", name: "CardComponent",
  properties: { ... } })  // 用导出的固定结构作为初始属性
```

**第3步：补齐 Master 子节点**
```
node_create({ nodes: [{
  { type: "text", parentId: "<masterId>", properties: { ... } }  // 从导出 DSL 提取的子节点
])
```

**第4步：搜索同类节点并替换为 Instance**
```
search_nodes({ name: { value: "Card", matchType: "contains" } })
→ 对结果中每个重复节点:
  1. node_get(id) 记录其位置 (x, y)
  2. node_delete(id)
  3. node_create({ type: "instance", properties: { componentId: "<masterId>", x, y, name: "Card_1" } })
```

也可直接通过 `node_create`（批量传 `nodes[]`） 批量创建所有 Instance，传入各自的 `componentId` 和位置。

> 对于完整设计系统（Design System）的组件库生成工作流（含 Token 面板、网格布局策略、`component_render` 批量生成等），见 `14-design-system.md §第二阶段：组件库生成`。

### 排版优化工作流（渲染后统一文字样式）

`code_to_design` 渲染后的文本元素可能字号不统一、字重不一致，需后置规范化：

**第1步：扫描当前排版状态**
```
search_nodes({ types: ["TEXT"] })        → 获取所有文本节点
dsl_export_selection                      → 导出查看实际字号/字重分布
```

**第2步：按语义层级批量修正**
```
// 标题（>18px）统一字号与字重
search_nodes({ types: ["TEXT"], minSize: { height: 18 } })
→ node_update({ nodeId, properties: { fontSize: 24, fontName: {family:"Inter",style:"Bold"}, lineHeight: {unit:"PIXELS",value:32} } })

// 正文（14-16px）统一
search_nodes({ types: ["TEXT"], ... })
→ node_update({ nodeId, properties: { fontSize: 14, fontName: {family:"Inter",style:"Regular"}, lineHeight: {unit:"PIXELS",value:22} } })

// 辅助文字（12px）统一
search_nodes({ types: ["TEXT"], ... })
→ node_update({ nodeId, properties: { fontSize: 12, fontName: {family:"Inter",style:"Regular"}, letterSpacing: {unit:"PIXELS",value:0.5} } })
```

**第3步：对齐与颜色修正**
```
search_nodes({ name: { value: "title", matchType: "contains" } })
→ node_update({ nodeId, properties: { textAlignHorizontal: "LEFT", fills: [{type:"SOLID",color:"#1A1A1A"}] } })

search_nodes({ name: { value: "desc", matchType: "contains" } })
→ node_update({ nodeId, properties: { textAlignHorizontal: "LEFT", fills: [{type:"SOLID",color:"#666666"}] } })
```

> **技巧**：HTML 中使用 `data-name` 属性标记语义角色（如 `data-name="page-title"`），渲染后层名即带语义前缀，便于 `search_nodes` 精确匹配。

### 图层识别优化工作流（渲染后整理图层结构）

`code_to_design` 渲染的图层按 HTML 结构自动命名，但可能层级扁平、命名泛化，需结构化整理：

**第1步：分析当前图层结构**
```
selection_get / dsl_export_selection    → 获取所有顶层元素及其排列
```
识别出哪些是独立区域（导航栏、侧边栏、内容区、底部）、哪些元素应归入同一容器。

**第2步：创建容器 Frame 并归组**
```
// 创建区域容器（auto-layout 方便后续调整）
node_create({ type: "frame", name: "Header",
  properties: { size: {width:1440,height:64}, layoutMode:"HORIZONTAL", ... } })

// 将分散的元素移入容器
node_update({ nodeId: "<logoId>", properties: { parentId: "<headerFrameId>" } })
node_update({ nodeId: "<navId>", properties: { parentId: "<headerFrameId>" } })
node_update({ nodeId: "<avatarId>", properties: { parentId: "<headerFrameId>" } })
```

**第3步：批量重命名语义化**
```
// 按元素类型/内容模式批量改名
search_nodes({ types: ["TEXT"], name: { value: "div", matchType: "contains" } })
→ node_update({ nodeId, properties: { name: "BodyText_1" } })

search_nodes({ types: ["RECTANGLE"], name: { value: "div", matchType: "contains" },
             colors: [{ type: "fill", color: "#4340EA", tolerance: 10 }] })
→ node_update({ nodeId, properties: { name: "PrimaryButton_bg" } })
```

**第4步：整理 Z 轴顺序（重排图层）**
```
// 通过 node_create({ nodes: [...] }) 按所需顺序重建子节点索引
// MasterGo 中后创建的节点在上层，按「背景→内容→浮层」顺序创建
```

> **技巧**：HTML 中通过 `data-name="sidebar"`、`data-name="header"` 等语义属性，`code_to_design` 渲染后图层名即为 `sidebar`、`header`，可直接用于 `search_nodes`，省去重命名步骤。

### 自动布局套用工作流（渲染后修正撑开/塌陷问题）

`code_to_design` 渲染的 frame 可能因缺少 auto-layout 导致子元素溢出、高度固定撑不开、或内边距丢失。可通过后置套用自动布局属性修复：

**第1步：诊断——哪些 frame 缺失 auto-layout**
```
dsl_export_selection                              → 导出渲染结果
// 查找 flexMode 为 "NONE" 或缺失、但包含多个子元素的 frame（注意：回读字段是 flexMode，不是 layoutMode）
// 典型特征：子元素 absolute 定位、frame 高度固定值、子元素超出边界
search_nodes({ types: ["FRAME"], ... })            → 定位问题 frame
node_get(id)                                      → 查看具体 flexMode / width·height（回读是扁平字段，没有 size）
```

**第2步：套用 auto-layout（核心修复）**
```
// 垂直排列的容器（如列表、卡片内容区）
node_update({ nodeId, properties: {
  flexMode: "VERTICAL",              // 宿主字段名（写 layoutMode 也会被自动归一化）
  mainAxisSizingMode: "AUTO",        // 主轴高度随内容撑开
  crossAxisSizingMode: "FIXED",      // 交叉轴宽度保持固定（或也设 AUTO）
  itemSpacing: 12,                   // 子元素间距
  paddingLeft: 16, paddingRight: 16,
  paddingTop: 16, paddingBottom: 16,
} })

// 水平排列的容器（如导航栏、按钮组）
node_update({ nodeId, properties: {
  flexMode: "HORIZONTAL",
  mainAxisSizingMode: "AUTO",
  crossAxisSizingMode: "FIXED",
  itemSpacing: 8,
  paddingLeft: 20, paddingRight: 20,
} })
```

**第3步：根据父级容器适配子元素尺寸**
```
// 情况 A：子元素宽度应填满父容器（父 HORIZONTAL，子拉伸）
// 子元素在主轴方向填满父容器（横向父层 → 用 layoutSizingHorizontal）
node_update({ nodeId: "<childId>", properties: { layoutSizingHorizontal: "FILL" } })
// （纵向父层对应的字段是 layoutSizingVertical: "FILL"；没有 layoutGrow / layoutAlign 这两个宿主字段）

// 情况 B：子元素高度应填满父容器交叉轴
// 父 VERTICAL → 子在交叉轴拉伸：宿主字段是 alignSelf
node_update({ nodeId: "<childId>", properties: { alignSelf: "STRETCH" } })

// 情况 C：父容器宽度应随最宽子元素自适应
// 父设置 crossAxisSizingMode: "AUTO"
node_update({ nodeId: "<parentId>", properties: { crossAxisSizingMode: "AUTO" } })
```

**第4步：验证与微调**
```
selection_get
dsl_export_selection     → 检查 frame 高度是否已变为 auto
node_get(id)            → 确认 flexMode / layoutSizingHorizontal / alignSelf 生效（回读用宿主字段名）
```

> **典型场景**：HTML 中一个 `<section>` 包含多个 `<div>`，渲染后 frame 高度固定 0 或很小——套用 `flexMode: "VERTICAL"` + `mainAxisSizingMode: "AUTO"` 即可让 frame 高度自适应内容。

---

## WCAG 2.0 可视性标准

### 对比度要求
| 级别 | 标准 |
|------|------|
| AA 级 | ≥ 4.5:1（普通文字），≥ 3:1（大文本 ≥18px） |
| AAA 级 | ≥ 7:1（普通文字），≥ 4.5:1（大文本） |

### 可访问性检查清单
- [ ] 文本与背景对比度 ≥ 4.5:1（普通文字）
- [ ] 大文本（≥18px）对比度 ≥ 3:1
- [ ] 非文本元素有 ≥ 3:1 对比度
- [ ] 所有可交互元素可键盘访问
- [ ] Focus 状态有清晰可见的焦点指示
- [ ] 不只依赖颜色传达信息
- [ ] 文字可调整大小

---

## 渲染注意事项

1. **渲染限制**：嵌套层级不超过 20 层，单文档元素不超过 1000 个，图片元素需有效 imageUrl，字体需系统已安装
2. **字体回退机制**：字体加载失败时自动回退（Semi Bold → Bold → Medium → Regular）
3. **图标渲染**：优先使用 `data-icon`（`type: 'svg'` + `svgContent`，SVG 直接导入，无变形，多色原生支持）
4. **填充与描边**：在 HTML 中通过 Tailwind 类（`bg-[color]`、`border-[color]`）声明，`code_to_design` 自动映射为 fills/strokes
5. **椭圆渐变填充不生效**：先用 `code_to_design` 渲染基础形状（带 solid 占位色），再通过 `node_update` 单独设置 `fills` 为渐变填充
6. **投影效果**：通过 Tailwind `shadow-[...]` 类声明，`code_to_design` 自动设置 `isEffectShow: true`
7. **两步渲染法**：渐变/图片填充 + 阴影效果时，通过 HTML 中的 Tailwind `shadow-[...]` 和背景色类一次性声明，`code_to_design` 自动处理
8. **模板/树形组件自动展开**：`template` 和 `tree` 元素在渲染前自动展开为基础 DSL 元素（frame/text/rectangle）
9. **调试技巧**：先渲染单个元素测试 → 检查错误信息 → 用 `selection_get` 确认 → 用 `dsl_export_selection` 验证

## 截图复刻注意事项

从截图/图片复刻页面时，图标和颜色识别受视觉模型能力限制，需遵循以下策略：

### 图标识别策略

| 场景 | 处理方式 |
|------|----------|
| 标准图标可辨认 | 使用 `data-icon="ri:xxx-line"` 精确匹配 |
| 图标模糊不确定 | 使用 `ri:question-line` 占位，并添加 `data-name="icon-xxx"` 标注语义 |
| 自定义业务图标 | 用彩色圆角矩形 + 文字标注代替，如 `<section class="w-[24px] h-[24px] bg-[#3B82F6] rounded-[4px]"><p class="text-[12px] text-[#FFFFFF]">同</p></section>` |
| 状态圆点 | 直接使用 `ellipse` 或 `rounded-full` 实现，不依赖图标库 |

### 颜色处理策略

| 场景 | 处理方式 |
|------|----------|
| 背景色 | 显式使用 `bg-[#RRGGBB]`，不使用 Tailwind 命名色（如 `bg-gray-100`） |
| 品牌色 | 优先询问用户确认品牌色值，避免模型自动推断 |
| 状态色 | 使用精确 hex：成功 `#10B981`、警告 `#F59E0B`、错误 `#EF4444`、信息 `#3B82F6` |
| 文字色 | 主文字 `#1F2937`、次文字 `#6B7280`、辅助文字 `#9CA3AF` |

### 后置修正工作流

复刻完成后，使用以下步骤批量修正偏差：

```
// 1. 修正颜色
search_nodes({ name: { value: "status-badge", matchType: "contains" } })
→ node_update({ nodeId, properties: { fills: [{type:"SOLID",color:"#10B981"}] } })

// 2. 替换图标
search_nodes({ name: { value: "icon-sync", matchType: "contains" } })
→ node_delete(id) → node_create({ type: "instance", properties: { componentId: "<correct-icon-id>" } })

// 3. 修正文本
search_nodes({ types: ["TEXT"], name: { value: "source", matchType: "contains" } })
→ node_update({ nodeId, properties: { fontSize: 13, fills: [{type:"SOLID",color:"#6B7280"}] } })
```

---

## 设计转代码指南

### 元素映射
| DSL 类型 | CSS |
|----------|-----|
| `frame` (HORIZONTAL) | `display: flex; flex-direction: row` |
| `frame` (VERTICAL) | `display: flex; flex-direction: column` |
| `text` | inline |
| `rectangle` | block |
| `ellipse` | border-radius: 50% |

### 样式转换
| DSL 属性 | CSS |
|----------|-----|
| `cornerRadius: 8` | `border-radius: 8px` |
| `fills[{color: '#F00'}]` | `background: #F00` |
| `paddingTop: 20` | `padding-top: 20px` |
| `opacity: 0.5` | `opacity: 0.5` |
| `itemSpacing: 16` | `gap: 16px` |