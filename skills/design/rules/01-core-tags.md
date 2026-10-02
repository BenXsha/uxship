# 别名与调用方式

本技能可通过以下名称调用：

| 别名 | 类型 | 说明 |
|------|------|------|
| `mcp/uxship-design` | 完整路径 | 命名空间限定名 |
| `uxship-design` | 短名 | 自动解析的短名（推荐） |
| `mg` | 别名 | 最简别名 |
| `mgd` | 别名 | 简写变体 |

调用示例：在对话中使用 `mg: 帮我生成一个登录页面设计`

---

# 模块一：核心原则与限制

## 1. 技术需求转视觉表达
- 用户提出的技术实现需求（如 Grid 布局、Form 表单等）应转化为纯视觉表达。
- 例如："三列表单布局" → "三个等宽的内容区块"
- 例如："Grid网格系统" → "规则的多行多列布局"
- 例如："表单验证" → "输入框的不同视觉状态"

## 2. 交互元素的处理
- 将所有交互元素（button、input等）转换为对应的视觉展示，**禁止使用交互标签**。
- 按钮 → 使用 `section` + 背景色 + 圆角实现
- 输入框 → 使用 `section` + 边框实现
- 下拉菜单 → 使用 `section` + 绝对定位实现选项列表

## 3. 严格限制（红色警戒）
- ❌ **禁止使用** `<button>`、`<input>`、`<form>` 等交互标签。
- ❌ **禁止使用** `<style>`、`margin`、`grid`、`calc`、`vw/vh/%` 等。
- 🔶 **例外**：`style="background: ..."` 可用于多层背景（渐变+图片叠加），因 Tailwind 单值 `bg-[...]` 无法表达多层。见 `05-pitfalls.md §20`。
- ❌ **禁止使用** Tailwind 中未列出的 class（仅限本规范允许的 class）。
- ❌ **禁止嵌套不合规结构**（例如 `p` 中嵌 `p`、`span` 中嵌 `span`）。
- ✅ **必须使用** `data-name` 属性描述标签用途，如 `<section data-name="button">`。
- 🔴 **强制规则：所有元素必须有 data-name**
  - 每个 `<section>`、`<div>`、`<p>`、`<i>`、`<svg>` 等标签**必须**包含 `data-name` 属性
  - 用途：确保 DSL→HTML→DSL 往返时图层名称不丢失，设计稿导出后可正确还原层级结构
  - ✅ 正确：`<section class="flex" data-name="header">...</section>`
  - ❌ 错误：`<section class="flex">...</section>` — 无 data-name，往返后图层名丢失
- ✅ **推荐使用** `data-icon` 属性指定图标（支持 3229+ Remix Icon 本地缓存），如 `<i data-icon="ri:search-line" data-name="search-icon">`，自动转换为 SVG 元素渲染（`type: 'svg'` + `svgContent`，通过 `mg.createNodeFromSvgAsync()` 导入）。
- ✅ **data-icon 格式**：`<prefix>:<name>`，如 `ri:search-line`。省略前缀时默认使用 `ri:`。当前支持的内置图标见下方「内置图标列表」。
- ✅ **模板化表格** 使用 `data-table` JSON 属性传入列定义和数据数组，服务端自动展开为 `type: "template"`+`template:"table"` DSL，**严禁逐行重复 HTML** → 见 `05-pitfalls.md §18.10`
- ✅ **图表（ECharts）** 使用 `<chart option='{ECharts option JSON}' />`，属性值必须用**单引号**包裹（因为 JSON 含双引号）。示例：`<chart option='{"xAxis":{"data":["Mon","Tue"]},"series":[{"type":"line","data":[10,20]}]}' class="w-[400px] h-[300px]" data-name="chart" />`
- 🔴 **ECharts option 格式要求**：`type` 必须在每个 `series` 对象内部，不在顶层；`color` 应使用 `itemStyle.color` 而非顶层 `color`
- ✅ **预设组件** 使用 `<component type='button' config='{...}' />`，属性值必须用**单引号**包裹。支持的组件类型：button（label, variant）、badge（label, variant）、avatar（initial, bgColor）、toggle（checked）、progress（percent）、checkbox-group（items）、radio-group（items）、text-input（placeholder）、select（placeholder, options）、menu（items）、tabs（items, activeIndex）、list（items）、slider（percent）、breadcrumb（items）、tooltip（label）、divider（direction）、tag（label）、spinner（showTrack）、modal（title, content）、alert（title, content, type）、pagination（current, total）、steps（items, activeIndex）、accordion（items）、card（title, content）、table（columns, rows）、form（fields）、toast（message, type）、skeleton（variant, rows）、page-shell、feature-grid、pricing-table。示例：`<component type='button' config='{"label":"确定","variant":"primary"}' class="w-[120px] h-[36px]" data-name="confirm-btn" />`

---

# 模块二：结构标签规范

**仅允许使用以下 HTML 标签：**

| 标签 | 用途 | 限制 |
| --- | --- | --- |
| `section` | 容器或 layout frame | ✅ 可嵌套、可包含子节点；🔴 **必须包含 `flex`/`flex-col`/`flex-row` 之一**（否则 padding 无法清零） |
| `div` | 矩形视觉块（叶子节点）| ❌ 不可含任何子元素，如需包含请改用 `section` |

> ⚠️ **关于 div → DSL frame 转换**：在 HTML 规范中 `<div>` 是叶子节点（不可含子元素），这是为了控制 HTML 嵌套层级。但在转换为 DSL 时，`<div>` 会被映射为 `frame` 类型，而 `frame` 在 MasterGo 中作为容器可包含子节点。因此转换引擎会自动将叶子 `<div>` 在 DSL 中提升为容器 `frame`，无需担心丢失层级能力。
| `p` | 文本段落 | ✅ 仅允许包含纯文字或 `span`；❌ 不可嵌套 `p` |
| `span` | 内联文本片段 | ✅ 仅允许纯文字内容；❌ 不可嵌套 `span`，必须在 `p` 内 |
| `i` | FontAwesome图标 | ✅ 仅允许FA图标；❌ 不可包含任何子元素 |
| `svg` | 图标/路径/不规则图形 | ✅ 必须设置 `w` `h`；❌ 禁止使用 `transform` |
| `chart` | 可视化图表（ECharts SSR 渲染为 SVG） | ✅ 必须设置 `w` `h`；🔴 必须用 `option='{...}'` 属性传入 ECharts 配置（属性值用**单引号**包裹，内部 JSON 用双引号）；支持 `data-chart='{...}'` 作为别名 |
| `component` | 预设 UI 组件（服务端预渲染为 HTML） | ✅ 必须设置 `type` 属性；支持 `config` 属性传入组件配置（JSON 格式，单引号包裹）；支持的类型：button, badge, avatar, toggle, progress, checkbox-group, radio-group, text-input, select, menu, tabs, list, slider, breadcrumb, tooltip, divider, tag, spinner, modal, alert, pagination, steps, accordion, card, table, form, toast, skeleton, page-shell, feature-grid, pricing-table |
| `table` / `thead` / `tbody` / `tr` / `th` / `td` | 表格模板（模板化布局） | 🔴 仅当含 `data-table` 属性或作为 `<table>` 子元素时生效；渲染引擎自动展开为 `type: "template"` + `template: "table"`；**禁止逐行重复 HTML** → 见 `05-pitfalls.md §18.10` |

**关键规则（标签层级关系）：**
1. **`<div>` 标签 = 叶子节点**：永远不能包含任何子元素，必须是DOM树的末端。如果需要包含任何内容，立即改用 `<section>`。
2. **`<section>` 标签 = 容器节点**：唯一允许包含子节点的布局容器。
3. **图标使用 `data-icon` 属性**：在任何标签上使用 `data-icon="ri:icon-name"`，转换引擎会自动加载本地 SVG 并渲染为 SVG 元素（`type: 'svg'` + `svgContent`）。

> 🔴🔴🔴 **强制规则：所有带 `px-`/`py-`/`p-` 的 `<section>` 必须含 `flex`/`flex-col`/`flex-row`**
>
> MasterGo API **不支持在 NONE layout 的 frame 上设置 padding**（静默忽略，保持默认 10px）。任何使用了 `px-`、`py-`、`p-` 的 `<section>` 如果没有 `flex` 类，padding 将完全无效，元素尺寸异常膨胀。
>
> ❌ **典型错误**：`<section class="px-[14px] py-[10px] bg-[#F1F5F9]">` — 无 flex，padding 不生效
>
> ✅ **正确写法**：`<section class="flex flex-col gap-[0px] px-[14px] py-[10px] bg-[#F1F5F9]">`
>
> 这条规则是 **#1 最容易被忽视的错误**，详见 `05-pitfalls.md §18 生成前自检清单`。

### 内置图标列表（常用 Remix Icon 快速参考，完整 3229+ 图标通过 `icon_search` 查询，无需网络请求）

| data-icon 值 | 说明 |
|---|---|
| `ri:search-line` | 搜索 |
| `ri:notification-line` | 通知/铃铛 |
| `ri:cloud-line` | 云 |
| `ri:server-line` | 服务器 |
| `ri:cpu-line` | CPU/处理器 |
| `ri:refresh-line` | 刷新/同步 |
| `ri:add-line` | 添加/加号 |
| `ri:play-circle-line` | 播放/运行中 |
| `ri:dashboard-line` | 仪表盘 |
| `ri:hard-drive-line` | 硬盘/存储 |
| `ri:network-line` | 网络 |
| `ri:settings-line` | 设置 |
| `ri:history-line` | 历史/活动 |
| `ri:stop-circle-line` | 停止/已停止 |
| `ri:alert-line` | 警报/警告 |
| `ri:user-line` | 用户/个人 |
| `ri:home-line` | 首页 |
| `ri:menu-line` | 菜单/汉堡 |
| `ri:close-line` | 关闭/叉号 |
| `ri:check-line` | 勾选/完成 |
| `ri:edit-line` | 编辑 |
| `ri:delete-bin-line` | 删除 |
| `ri:download-line` | 下载 |
| `ri:upload-line` | 上传 |
| `ri:eye-line` | 可见/眼睛 |
| `ri:eye-off-line` | 隐藏/闭眼 |
| `ri:mail-line` | 邮件 |
| `ri:phone-line` | 电话 |
| `ri:map-pin-line` | 位置/地图 |
| `ri:time-line` | 时间/时钟 |
| `ri:star-line` | 星标/收藏 |
| `ri:heart-line` | 喜欢/心形 |
| `ri:warning-line` | 警告三角 |
| `ri:info-line` | 信息 |
| `ri:copy-line` | 复制 |
| `ri:lock-line` | 锁定 |
| `ri:global-line` | 全球/地球 |
| `ri:arrow-left-line` | 左箭头 |
| `ri:arrow-right-line` | 右箭头 |
| `ri:more-line` | 更多/三点 |
| `ri:logout-box-line` | 登出 |
| `ri:login-box-line` | 登入 |
| `ri:file-line` | 文件 |
| `ri:folder-line` | 文件夹 |

未列出的图标可通过 `icon_search` 搜索可用图标名，然后使用 `data-icon` 属性通过 `code_to_design` 渲染。如需确认图标是否已在本地 SVG 缓存中，请检查 `data-icon` 转换引擎的图标映射表。

---

# 模块三：UI 组件标签规范

**使用 `<component type='...' config='{...}' />` 完整格式**，不支持简写标签。

| 格式 | 示例 | 说明 |
|------|------|------|
| `<component type='...' config='{...}' />` | `<component type='tabs' config='{"items":[...]}' />` | **唯一可用格式** ✅ |

> ⚠️ **简写标签（`<tabs />`、`<pagination />` 等）已废弃**。服务端渲染模式已移除，简写标签不再生效。一律使用 `<component type='...' config='{...}' />` 完整格式。

以下为已废弃的简写标签（仅作历史参考，不再可用）：`<button>`, `<input>`, `<select>`, `<textarea>`, `<switch>`, `<toggle>`, `<badge>`, `<tag>`, `<avatar>`, `<progress>`, `<spinner>`, `<divider>`, `<tooltip>`, `<breadcrumb>`, `<tabs>`, `<menu>`, `<list>`, `<pagination>`, `<steps>`, `<slider>`, `<alert>`, `<modal>`, `<accordion>`。

### 组件标签使用规则

1. `<component>` 标签 **可放在 `<section>` 容器内** 参与 auto-layout：`<section class="flex flex-col gap-[12px]"><component type='button' config='{"label":"Submit"}' /><component type='text-input' config='{"placeholder":"Name"}' /></section>`
2. 组件标签 **不自含子元素** — 所有参数通过 `config` 属性传递
3. 尺寸通过 Tailwind 的 `w-[Npx]` / `h-[Npx]` 指定，不传则使用组件默认尺寸
4. `config` 属性值必须为合法的 JSON 对象
5. 复杂组件（如 checkbox-group、radio-group）请使用 `component_render` MCP 工具直接调用