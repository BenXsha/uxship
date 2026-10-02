# DSL 规范

文档结构：`{ "version": "2.0", "elements": [/* 元素列表 */] }`
颜色格式：`#RRGGBB` 或 `#RRGGBBAA`

## 元素类型

| 类型 | 说明 |
|------|------|
| `frame` | 容器（可含 children），最常用 |
| `text` | 文本节点，使用 `content` 字段 |
| `rectangle` / `ellipse` / `line` / `polygon` / `star` | 基础形状 |
| `svg` | SVG 矢量元素（图标导入），由 `data-icon` 自动生成 |
| `pen` / `path` | 自定义矢量路径（仅用于自定义形状，图标请用 `data-icon`） |
| `group` / `component` / `boolean_operation` | 组合/组件/布尔运算 |
| `template` | 模板自动展开（table/grid/list/form/pagination/carousel） |
| `tree` | 树形结构自动展开 |
| `generator` | UI 组件生成器（`generatorType: "component"` + `componentType`） |

## 模板类型 (Template)

`type: 'template'` 用于生成结构化布局，渲染展开为基础元素。

### 表格 (table)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `columns` | `{key, label, width?, align?}[]` | 列定义 |
| `headerStyle` | object | 表头样式：height, fontSize, fontWeight, fills |
| `rowStyle` | object | 行样式：height, fontSize, fills, alternatingFills |
| `cornerRadius` | number | 表格圆角 |

便捷模式：`config.allInOne: true` + `data` 数据行数组，columns 自动从首行键推断。

### 网格 (grid)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `columns` | number | 列数（默认3） |
| `itemWidth/Height` | number | 单项尺寸 |
| `gap` | number | 间距 |
| `style` | object | 项目样式 |

### 列表 (list)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `itemHeight` | number | 列表项高度 |
| `gap` | number | 项间距 |
| `showDivider` / `dividerColor` | boolean/string | 分割线 |
| `style` / `labelStyle` | object | 项目样式/文本样式 |
| `avatar` / `avatarSize` | boolean/number | 头像占位 |

### 表单 (form)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `labelWidth` / `labelAlign` | number/enum | 标签设置 |
| `gap` | number | 表单项间距 |
| `fields` | `{key, label, type, placeholder?}[]` | 字段定义（type: input/select/textarea/switch/radio/checkbox） |

### 分页 (pagination)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `total` / `activePage` | number | 总页数/当前页 |
| `itemWidth/Height` | number | 页码尺寸（默认32） |
| `gap` | number | 页码间距（默认4） |
| `activeColor` | string | 选中颜色 |
| `showPrevNext` | boolean | 显示上/下一步 |

### 轮播 (carousel)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `slideWidth/Height` | number | 幻灯片尺寸 |
| `count` | number | 幻灯片数量（默认3） |
| `dotPosition` | 'bottom'\|'top' | 指示器位置 |
| `showArrows` / `cornerRadius` / `autoPlay` | - | 箭头/圆角/自动播放 |

## 树形组件 (Tree)

`type: 'tree'` 自动展开为缩进层级+连接线+展开/折叠图标。data 递归结构：

| 字段 | 说明 |
|------|------|
| `data` | `TreeData[]`：`{id, label, children?, expanded?, selected?, disabled?, icon?}` |
| `config.itemHeight` | 行高（默认36） |
| `config.indentSize` | 缩进像素（默认24） |
| `config.showIcon/ExpandIcon` | 显示节点图标/展开图标 |
| `config.lineStyle` | `{show?, color?, width?}` 连接线 |
| `config.nodeStyle/LabelStyle/IconStyle` | 样式配置 |
| `config.hoverStyle/SelectedStyle/DisabledStyle` | 状态样式 |

## UI 组件生成器 (Generator + componentType)

`type: "generator"` + `generatorType: "component"` 通过内置渲染器绘制标准组件。

```json
{
  "type": "generator", "name": "submit-button",
  "generatorType": "component",
  "config": { "componentType": "button", "label": "Submit", "variant": "primary", "width": 120, "height": 32 }
}
```

**config 字段：** `componentType`(23种必填), `width/height`, `label`, `placeholder`, `variant`, `checked`, `initial`, `bgColor`, `percent`, `items`, `activeIndex`, `current`, `total`, `title`, `content`, `direction`, `closable`, `separator`, `options`, `showTrack`, `bordered`

**渲染行为：** 作为容器子元素参与 auto-layout；作为顶层元素默认位置 (100, 100)。