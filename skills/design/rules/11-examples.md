# 示例与常见场景

> **说明**：推荐通过 `code_to_design` 一键渲染 HTML 文件，或通过 `component_render` 直接创建组件。以下仅保留高阶 API 示例和常见场景。

## 使用 `component_render` 高阶 API（推荐方案）

`component_render` 自动完成从容器创建到勾选标记的全流程，一次调用替代多步手写 DSL。

### CheckboxGroup 5 态
```json
{ "type": "checkbox-group", "position": { "x": 100, "y": 100 }, "title": "Checkbox 复选框状态",
  "theme": { "brand": "#4340EA", "textTitle": "#1A1A2E" } }
```

### RadioGroup 5 态
```json
{ "type": "radio-group", "position": { "x": 580, "y": 100 }, "title": "Radio 单选框状态" }
```

### Button
```json
{ "type": "button", "position": { "x": 100, "y": 500 }, "label": "Primary Button", "variant": "primary" }
```

### TextInput
```json
{ "type": "text-input", "position": { "x": 100, "y": 560 }, "placeholder": "请输入内容...", "size": { "width": 248, "height": 36 } }
```

### 优点对比
| 维度 | 手写 DSL | `component_render` |
|------|---------|-------------------|
| 调用次数 | 多次分步 | **1 次** |
| 需知内部 ID | 每个子节点 ID | 无需 |
| pen 路径 | 手动处理 | 插件层自动处理 |
| 主题定制 | 手动改每个颜色 | `theme` 参数一键覆盖 |
| 学习成本 | 高 | 一个参数表 |

## 两步工作流（当 `code_to_design` 无法满足时）

`code_to_design` 覆盖 90% 场景，以下情况需两步工作流：

### 场景 A：精确控制父容器尺寸与子层坐标
**新建的 frame 默认 `flexMode: "NONE"`（普通容器，不会自动布局）**，所以 `width`/`height` 与子层 `x`/`y` 都可控：

```
// 1) 建容器（默认就是 NONE；不需要再写 layoutMode:"NONE"）
node_create({ type: "frame", name: "Card", properties: { x: 100, y: 100, width: 280, height: 200, cornerRadius: 12, fills: [{type:"SOLID",color:"#FFFFFF"}] } })
// 2) 子节点直接带坐标建（v2.9.0 起会在插入父层后二次应用几何，落点即所写）
node_create({ nodes: [{ type: "text", parentId: "<frameId>", properties: { name: "Title", characters: "标题", x: 20, y: 20, width: 240 } }] })
```

> 要点（v2.9.0 实测更新，旧文档在本节的「auto-layout 默认」说法是错的）：
> - **需要自动布局时**写 `flexMode`（或别名 `layoutMode`）：`node_update({ properties: { layoutMode: "HORIZONTAL" } })`
>   → 真生效（子层按 `padding*` / `itemSpacing` 排列、父层自动 hug 到内容尺寸）。
> - **只有自动布局容器**才会忽略 `size`（hug / fill 语义）——那时子层 `x`/`y` 由引擎计算：
>   位移用父层 `padding*`，顺序用 `node_move`。
> - 非自动布局容器里，建节点时传入的 `x`/`y`/`width`/`height` **直接生效**（不必再逐个子节点 post-fix）。

### 场景 B：椭圆渐变填充 + 效果
渲染器对椭圆渐变支持有限，先用 solid 占位再 update：

```
code_to_design(filePath)  → 椭圆渲染为 solid 占位色
→ node_update({ nodeId: "<ellipseId>", properties: { fills: [{type:"GRADIENT_RADIAL", ...}] } })
```

### 场景 C：批量建节点后修正尺寸
未显式给尺寸时，新建 frame 取宿主默认值（常见 100×100）；**显式传 `width`/`height`/`x`/`y` 现在会生效**（v2.9.0）：

```
node_create({ nodes: [{ type: "frame", properties: { name: "Box", width: 16, height: 16, x: 24, y: 62, cornerRadius: 4 } }] })
```

> 详见 `12-limitations.md` 渲染限制表。

## 常见场景

### 场景一：设计稿转 React 代码
1. 选中页面，调用 `dsl_export_selection` 导出 DSL
2. 遍历 elements，分析结构
3. 递归生成组件代码

### 场景二：批量调整组件样式
1. 调用 `search_nodes` 搜索目标元素（按名称、类型、颜色）
2. 调用 `node_update` 逐项更新属性
3. 调用 `selection_get` 验证结果

### 场景三：组件库规范化
1. 导出组件库为 DSL
2. 提取设计令牌（颜色、间距、圆角）
3. 生成 Style Dictionary 格式

### 场景四：HTML 代码转设计
```
code_to_design(filePath="/path/to/page.html") → 自动完成: 读文件→转DSL→渲染画布
```

### 场景五：使用模板生成表格/网格等结构化布局
1. 确定布局类型（table/grid/list/form/pagination/carousel）
2. 构建 `TemplateElement`：`{ type: "template", name: "...", template: "table", config: { columns: [...], ... }, data: [...] }`
3. `template-renderer.ts` 会在渲染前自动展开模板为基础元素
4. 支持一次性生成完整页面：`config.allInOne: true` 配合 `data` 数组

### 场景六：使用树形组件
1. 构建递归 `TreeData[]`，每个节点含 `id`, `label`, `children?`
2. 构建 `TreeElement`：`{ type: "tree", name: "...", data: [...], config: { ... } }`
3. `template-renderer.ts` 自动展开为带缩进、连接线、展开/折叠图标的多层级布局

## Checkbox 5 种状态差异参考

| 状态 | 背景色 | 描边色 | 勾选 pen | 文字色 |
|------|:------:|:------:|:--------:|:------:|
| Unchecked | `#FFFFFF` | `#D0D5DD` | ❌ 无 | `#333333` |
| Checked | `#4340EA` | `#4340EA` | ✅ `#FFFFFF` | `#333333` |
| Hover | `#F4F3FF` | `#4340EA` | ❌ 无 | `#333333` |
| Disabled Unchecked | `#F5F5F5` | `#E0E0E0` | ❌ 无 | `#999999` |
| Disabled Checked | `#E0E0E0` | `#E0E0E0` | ✅ `#999999` | `#999999` |

## Radio 5 种状态差异参考

| 状态 | 背景色 | 描边色 | 内圆点 | 文字色 |
|------|:------:|:------:|:------:|:------:|
| Unchecked | `#FFFFFF` | `#D0D5DD` | ❌ 无 | `#333333` |
| Checked | `#4340EA` | `#4340EA` | ✅ 白 `#FFFFFF` | `#333333` |
| Hover | `#F4F3FF` | `#4340EA` | ❌ 无 | `#333333` |
| Disabled Unchecked | `#F5F5F5` | `#E0E0E0` | ❌ 无 | `#999999` |
| Disabled Checked | `#E0E0E0` | `#E0E0E0` | ✅ 白 `#FFFFFF` | `#999999` |

## 表单布局间距参考

| 关系 | 间距 | DSL 属性 |
|------|:----:|----------|
| 输入框之间 | 16px | `itemSpacing` |
| 输入框与提交按钮 | 16px | `itemSpacing` |
| 提交按钮与底部链接 | 16px | `itemSpacing` |
| 输入框内图标→文字 | 12px | 子容器 `itemSpacing` |
| 输入框文字左侧 | 16px | `paddingLeft` |
| 卡片上下留白 | 40px | `paddingTop/Bottom` |
| 卡片左右留白 | 32px | `paddingLeft/Right` |

## 关键知识点参考

## 注意事项

- 图标推荐使用 `data-icon`（`type: 'svg'` + `svgContent`，SVG 直接导入）。仅自定义矢量形状（如 checkbox 勾）使用 pen + `svgPathData`
- **渲染引擎支持子节点嵌套**：inline DSL 的 `children` 数组和 `template` / `tree` 类型展开的结构均可正确渲染为父子层级。字体加载失败时会自动回退到已加载的字体（如 Semi Bold → Bold），确保渲染不中断
- **`fontWeight` 建议使用 `fontName.style` 替代**：渲染引擎支持 `fontWeight`，但 `node_create`/`node_create`（批量传 `nodes[]`） 不处理 `fontWeight`，应改用 `fontName: { family: "Inter", style: "Bold" }`
- **原子组件必须组件化**：按钮、复选框、单选框、下拉列表、菜单、搜索框、输入框等原子级 UI 元素在页面中出现 2 次及以上时，**必须**先创建 `component` Master 再通过 `instance` 引用，禁止各自创建独立 frame。参见 `09-design-guide.md`「组件化设计原则」