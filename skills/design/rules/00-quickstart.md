# 快速入门：设计工作场景关键提示词

> 按场景组织，每个场景包含一句话目标、关键步骤和执行提示词。

---

## 1. 设计系统建设

**目标**：从零搭建完整设计系统（Token 面板 + 组件库 + 图标集 + 样式注册）

```
【准备】page_create("Design System") → page_switch
【Token 面板】code_to_design(filePath: "templates/design-system.html")
  → 渲染 13 类设计令牌
【组件库】code_to_design(filePath: "templates/design-system-components.html")
  → search_nodes COMPONENT 类型 → node_convert_to_component 逐个转换
  → component_list 验证
【图标集】icon_search(query: "...") → icon_render 批量渲染
【样式注册】library_register_styles(parentId: "...")
【Token 导出】dsl_export_selection({ convertToCode: true })
  → design_to_code(mode:"tokens") 输出 CSS 变量 / Tailwind / DTCG
```

**提示词模板**：
```
请帮我创建一个设计系统，包含品牌色板、排版阶、间距、阴影、圆角等 13 类 Token 面板。
使用 design-system.html 模板渲染，然后创建组件库（按钮、输入框、徽标等 23+ 组件），
搜索图标集并注册为宿主原生样式。
```

---

## 2. 排版优化

**目标**：统一画布上所有文字的层级、字号、字重、行高

```
【发现】search_nodes({ types: ["TEXT"] })
  → 按 data-name 或字号分布识别语义层级
【分析】design_describe(nodeId, { includeStyle: true, depth: 2 })
【修正】node_update({ updates: [
  { nodeId, properties: { fontSize, fontName, lineHeight, characters } }
])
```

**提示词模板**：
```
请检查当前页面的所有文本节点，将标题统一为 20px Bold，正文统一为 14px Regular，
行高统一为 1.5 倍字号。先搜索所有 TEXT 节点，分析层级分布，再批量更新。
```

---

## 3. 需求转设计

**目标**：将产品需求描述直接转化为画布上的 UI 设计稿

```
【理解】AI 分析需求 → 确定布局结构、组件类型、内容层级
【生成】编写 HTML+Tailwind（语义标签 + flex 布局 + 精确像素）
  → 使用 <component> 标签引用标准组件
  → 使用 data-icon 属性放置图标
  → 使用 <chart> 标签嵌入图表
【渲染】code_to_design(html: "...")
【检查】design_describe(nodeId) 或 dsl_export_node(nodeId) 验证布局
```

**提示词模板**：
```
请根据以下需求生成一个登录页面的设计稿：
- 品牌色 #4340EA
- 包含 Logo、标题、邮箱和密码输入框、登录按钮、忘记密码链接
- 底部有注册入口
- 居中布局，最大宽度 400px
使用 HTML+Tailwind 实现，用 <component> 渲染输入框和按钮。
```

---

## 4. 代码项目转设计稿

**目标**：将现有代码库分析结果渲染为架构图或流程图

```
【分析】codebase_get_structure(dir: "/path/to/project", depth: 3)
  → 获取模块树、入口文件、依赖关系
【选型】判断输出类型：
  → 分层架构 → templates/architecture.html
  → 业务流程 → templates/flowchart.html
【生成】AI 根据结构数据填充模板 → code_to_design(filePath: "...")
【连线条】node_create({ nodes: [{ type: "connector", ... }] })
  → 在模块间绘制 ELBOWED/STRAIGHT 连线 + 箭头
```

**提示词模板**：
```
请分析 /path/to/project 的代码结构，生成一个四层架构图
（展示层/应用层/领域层/基础设施层），
包含模块框、依赖连线、外部系统边界。
使用 architecture.html 模板风格。
```

---

## 5. 设计稿输出为代码

**目标**：将画布上的设计导出为原始 DSL + SVG 资产，AI 直读渲染

```
【导出+SVG】dsl_export_node({ nodeId, convertToCode: true, exportSvgs: true })
  → 自动语义化图层（__svg 后缀）→ 原始 DSL + 插件原生 SVG 资产
【Token】design_to_code({ dsl, options: { exportTokens: true, darkMode: true } })
  → CSS 变量 / Tailwind Config / DTCG JSON
【增量】design_to_code_update(sessionId, [changedNodeIds])
```

**提示词模板**：
```
请将当前选中的设计导出为原始 DSL + SVG 资产，我会自行渲染为 HTML。
先执行 semanticizeIcons 预处理，再导出。
```

---

## 6. 截图转设计稿

**目标**：将截图/参考图在画布上重现为可编辑的设计稿

```
【分析】AI 观察截图：
  → 识别布局结构（上下/左右/嵌套）
  → 提取色板（品牌色、背景色、文字色）
  → 识别组件类型（按钮/卡片/导航/表单）
  → 测量比例关系
【生成】AI 编写 HTML+Tailwind 近似还原
  → 图标用 data-icon 精确匹配或 data-name 占位
  → 颜色用精确色号，品牌色多次确认
  → 文字用 data-name 标注语义角色
【渲染】code_to_design(html: "...")
【修正】design_describe → 对照截图 → design_suggest / search_nodes + node_update（批量传 `updates[]`）
```

**提示词模板**：
```
请根据这张参考截图在画布上生成设计稿：
- 整体为 Dashboard 布局：左侧导航 240px，右侧内容区
- 顶部有搜索栏和用户头像
- 内容区为 2×2 卡片网格
- 品牌色 #4340EA，背景 #F8F9FA
- 卡片含标题、数值、趋势箭头
使用精确像素值，图标用 data-icon 占位。
```

---

## 7. 设计稿微调

**目标**：通过自然语言指令对已有设计进行精确修改

```
【单指令】design_suggest(nodeId, instruction: "标题字号28 间距16 圆角12")
【批量】design_suggest(nodeId, instructions: [  // 同一个工具，传数组即批量
  "改成蓝色", "间距加大", "居中对齐"
])
【复杂意图】AI 分解：
  1. design_describe(nodeId) 获取当前结构
  2. AI LLM 分解为原子指令
  3. design_suggest(nodeId, [原子指令...])  // instructions 数组
【手工精细控制】search_nodes → node_update（批量传 `updates[]`）：
  search_nodes({ name: { value: "标题", matchType: "contains" }, types: ["TEXT"] })
  → node_update({ updates: [{ nodeId, properties: { fontSize: 28 } }])
```

**提示词模板**：
```
请修改当前画板：标题字号改为 28px 并加粗，卡片间距改为 16px，
整体背景改为浅灰色 #F5F5F5，所有按钮圆角改为 8px。
先用 design_describe 获取结构，再逐条执行修改。
```

---

## 8. 组件交互状态矩阵

**目标**：为设计的组件创建全套交互状态 COMPONENT master（方案A：视觉矩阵 + 方案B：命名约定支持合成多态组）

```
【创建】component_state_matrix({
    type: "button",
    config: { label: "确定", variant: "primary" },
    naming: "variant",        // "default" 或 "variant"
    variantPropertyName: "State",
    states: ["Default","Hover","Active","Disabled","Focused"]
  })
  → 创建 5 个 COMPONENT master + 视觉状态标签
【合成多态组】（仅 naming:"variant" 时）
  选中所有组件 → 右键 "Combine as Variants"（MasterGo UI）
  → 自动识别为 1 个属性（State）5 个值
【引用】component_list 查看组件 ID
  → HTML 中用 data-component-id 引用指定状态实例
```

**提示词模板**：
```
请为这个按钮创建完整的交互状态矩阵，包含 Default/Hover/Active/Disabled/Focused
五个状态，使用 variant 命名模式以便后续合成为多态组。
```

## 9. 设计稿内容翻译

**目标**：将画布上所有文本内容翻译为目标语言

```
【发现】search_nodes({ types: ["TEXT"] })
  → 获取全部文本节点 ID 和原文
【翻译】AI 逐条翻译 → 构造更新列表
【更新】node_update({ updates: [
  { nodeId: "...", properties: { characters: "翻译结果" } },
  ...
])
```

**提示词模板**：
```
请将当前页面上的所有英文文本翻译为中文。
先搜索所有 TEXT 节点读取原文，逐条翻译后批量更新到画布上。
注意保持字号、字重、颜色等样式不变，仅替换文字内容。
```

---

## 10. 多会话文档切换

**目标**：在多个打开的插件间切换操作目标，**用代号直接呼叫指定插件**

```
【发现】session_list
  → [{ sessionId: "sess_xxx", codename: "Nova", documentName: "首页设计" },
     { sessionId: "sess_yyy", codename: "Pixel", documentName: "后台管理" }]
【自定义代号】插件 UI 点击紫色代号徽章 → 输入新名 → 自动保存到服务端
【全局切换】session_switch({ sessionId: "sess_xxx" })
  → 后续所有工具自动路由到目标插件
【单次路由】在工具参数中添加 _sessionId
  → node_create({ type: "rectangle", _sessionId: "sess_xxx", ... })
【🔔 快捷呼叫】AI 可直接用代号自然语言指令：
  "让 Nova 画个渐变圆" → AI 解析 codename → 查找 sessionId → 路由
```

**提示词模板**：
```
请让 Nova 在画布上画一个 200x200 的紫色渐变圆形，
让 Pixel 画一个 120x120 的金色五角星。
使用 _sessionId 参数分别路由到对应插件。
```

---

## 11. 样式库管理

**目标**：查询和复用已注册的宿主原生样式（Paint/Text Style）

```
【查询颜色样式】style_list_colors
  → 获取所有 Paint Style 的 ID、名称、色值、透明度
【查询文本样式】style_list_text
  → 获取所有 Text Style 的 ID、名称、字体、字号、字重
【应用样式】style_apply(nodeId, styleId, styleType)
  → 类型: "fill"（填充）/ "stroke"（描边）/ "text"（文本）
【批量应用】search_nodes 选中目标 → 循环 style_apply
  → search_nodes({ name: { value: "Button", matchType: "contains" } })
  → 对每个结果调用 style_apply
```

**提示词模板**：
```
请列出当前文档中的所有颜色样式，查看有哪些设计系统色板可用。
然后将 Primary 色样式应用到所有标题节点的填充。
```

---

## 12. 节点导出为图片

**目标**：将画布上的节点导出为图片文件（PNG/JPG/WEBP/SVG/PDF）

```
【导出当前选中】selection_get
  → node_export_image(nodeId, { format: "PNG", constraint: { type: "SCALE", value: 2 } })
【导出到文件】node_export_image(nodeId, { format: "PNG", saveToPath: "/tmp/design.png" })
【导出 SVG】node_export_image(nodeId, { format: "SVG" })
  → 返回纯文本 SVG 内容，可直接在 `<img>` 或 `<svg>` 中使用
【导出 PDF】node_export_image(nodeId, { format: "PDF" })
  → 适合打印或交付文档
```

**提示词模板**：
```
请将当前选中的卡片节点导出为 2x PNG 图片，保存到 /tmp/card-export.png。
```

---

## 13. 暗黑主题导出
**目标**：将 Token 面板导出为含暗色变量的开发者资源

```
【导出】design_to_code(dsl, {
    mode: "tokens",
    darkMode: true,
    theme: { brand: "#4340EA" }
  })
  → CSS: .dark { --color-neutral-bg: #131426; ... }
  → Tailwind: darkMode: 'class' + dark: 变体
  → DTCG: dark/ 组
```

**提示词模板**：
```
请将当前设计系统的 Token 面板导出为开发者资源，
同时生成 Light 和 Dark 两套主题的 CSS 变量和 Tailwind 配置。
品牌色使用 #4340EA。
```

---

## 14. 换组件与画布聚焦

**目标**：把画布上的对象换成指定组件，并把用户视角带到成果上

```
【实例换主组件】component_list / component_search 拿 componentId
  → node_swap_component({ nodeId: "1:2", componentId: "3:4" })

【团队库组件】team_component_search 拿 ukey
  → node_swap_component({ nodeIds: ["1:2","1:3"], ukey: "ukey:xxx", variant: "Hover" })

【普通对象换成组件（原位替换）】frame/矩形/文本均可
  → node_swap_component({ nodeId: "1:2", component: "库名/Primary Button", carryOverOverrides: true })
  → 保持父容器与图层顺序、继承位置/宽高、按图层名带过文字并删除原对象
  → 想保留原对象：keepOriginal: true；想用组件默认尺寸：keepSize: false

【HTML 中换组件】code_to_design
  → <div data-swap-node-id="1:2" data-swap-ukey="ukey:xxx" data-swap-keep-size="true"></div>

【设计完成后聚焦】code_to_design / dsl/render 默认自动聚焦 + 选中新成果
  → 保持原视角：focus: false；只聚焦不改选中：select: false
  → 手动聚焦：canvas_zoom_to_node(nodeId | nodeIds, zoom) / canvas_zoom_to_rect(x, y, w, h)
  → 只改选中：selection_set(nodeIds | addToSelection | selectAll)，[] 清空
```

**提示词模板**：
```
把这页里的“主操作”按钮换成团队库的 Primary Button，保持原宽高和文案；
换完把画布聚焦到这几个按钮上。
```

**约束**：`COMPONENT` / `COMPONENT_SET` 不能作为被替换对象（会破坏引用中的实例）；纯换组件 HTML 不会新建任何节点。

---

## 场景速查表

| 场景 | 入口工具 | 关键步骤数 | 典型耗时 |
|------|----------|-----------|----------|
| 场景 | 入口工具 | 关键步骤数 | 典型耗时 |
|------|----------|-----------|----------|
| 设计系统建设 | `code_to_design` + 模板 | 5 步 | 2-3 轮交互 |
| 排版优化 | `search_nodes` + `node_update`（批量传 `updates[]`） | 3 步 | 1 轮 |
| 需求转设计 | 编写 HTML → `code_to_design` | 3 步 | 1-2 轮 |
| 代码项目转设计稿 | `codebase_get_structure` + 模板 | 4 步 | 2 轮 |
| 设计稿输出为代码 | `dsl_export_selection` | 1 步 | 秒级 |
| 截图转设计稿 | 分析 → HTML → `code_to_design` → 修正 | 4 步 | 2-3 轮 |
| 设计稿微调 | `design_suggest`（`instruction` 或 `instructions[]`）| 1-3 步 | 秒级-1 轮 |
| 组件状态矩阵 | `component_state_matrix` | 1 步 | 秒级 |
| 内容翻译 | `search_nodes` + `node_update`（批量传 `updates[]`） | 3 步 | 1 轮 |
| 多会话文档切换 | `session_list` / `session_switch` | 2 步 | 秒级 |
| 样式库管理 | `style_list_colors` / `style_list_text` / `style_apply` | 2 步 | 秒级 |
| 节点导出为图片 | `node_export_image` | 1 步 | 秒级 |
| 暗黑主题导出 | `design_to_code({mode:"tokens", darkMode:true})` | 1 步 | 秒级 |
| 换组件（替换主组件 / 普通对象换组件） | `node_swap_component`（或 HTML `data-swap-node-id`） | 1 步 | 秒级 |
| 画布聚焦 / 选中 | `code_to_design` 默认自动聚焦；`canvas_zoom_to_node` / `selection_set` | 1 步 | 秒级 |
