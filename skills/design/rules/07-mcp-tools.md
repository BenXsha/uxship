# MCP 工具参考

MCP server 暴露 **67 个业务工具**（`getToolList()` 实测），另有 2 个诊断工具 `health_get` / `dsl_spec` 与 1 个工具面控制元工具 `mcp_tools` 在 `register-tools.ts` 单独注册。它们的 `name` / `description` / `inputSchema` 会**整份**通过 `tools/list` 注入 AI 上下文，所以工具面体积是产品指标：整份 JSON 目前约 3.5 万字符。

> **默认只暴露 `gen`**（20 个工具 / ≈11.6k 字符，含全部旗舰能力）；要全量需**显式** `UXSHIP_MCP_PROFILE=full`，
> 其余工具可用 `mcp_tools({action:'enable'})` 按需取回。详见下文「[工具面按 profile 暴露](#工具面按-profile-暴露省上下文)」。

工具面构成（67）：设计上下文 4 · 节点操作 11 · 设计管线 5 · 设计分析 3 · 高阶组件 4 · 图标与样式 7 · 页面/画布/会话/任务/宿主 18 · 团队库 6 · 变量 4 · Design Agent 3 · 批量导出 1 · 顶层结构 1。

参数描述（`inputSchema.properties.*.description`）只保留「允许值 / 单位 / 默认值 / 关键约束」（≤40 字符）；教程、示例清单、跨工具引用、返回结构一律写在本文档——`tools/list` 不承载它们。以下列出工具索引和 MCP schema 无法表达的关键约定。

## 工具索引

> 📌 **单体 / 批量合并形态**：`node_create` / `node_update` / `node_delete` / `design_suggest` 各自合并了「单体」与「批量」两种形态（服务端按实参形状选路，见 `resolvePluginMethod`，没有再拆 `_batch` 工具），因此它们**没有顶层 `required`**——改为在 schema 的 `anyOf` 里声明「至少给一组」，让调用方能从 `tools/list` 直接读到约束：
>
> | 工具 | 二选一 / 三选一 |
> |------|--------|
> | `node_create` | `type` **或** `nodes[]` |
> | `node_update` | `nodeId` + `properties` **或** `updates[]` |
> | `node_delete` | `nodeId` **或** `nodeIds[]` |
> | `design_suggest` | `instruction` **或** `instructions[]`（两者均另需 `nodeId`）|
> | `node_convert_to_component` | `nodeId`（+可选 `name`）**或** `nodeIds[]` **或** `namePrefix` |
> | `variable_update` | `id` + 值字段（改值）**或** `id` + `nodeIds[]`（**绑定**，走 `variable/apply`）|
>
> `variable_update` 是「一名两义」的工具：传 `nodeIds` 即按实参形状选路到 `variable/apply`（绑定，不是改值）。
> 为何不新开一个 `variable_apply` 工具：工具面预算的硬门禁要求先想「能否并进已有工具」（与 `node_create`/`node_update`/`node_delete` 的合并形态同一套机制）。
> 选择器口径：传 `id` 时 `id` 是**选择器**、`name` 是**新名字**（改名）；只传 `name`/`variableId` 时按名字定位。详见「[变量_更新](#variable_update)」。
>
> `node_convert_to_component` 的 `containerId` / `namePrefix` 另有两个**修饰符**（不参与 `anyOf`）：`listOnly: true` 只列举不转换、`combineVariants: true` 把作用域内成员按名分组合成原生变体集（轴名 `variantPropertyName`，默认 `State`）。详见「[节点转组件](#节点转组件)」。
>
> 只传空 `{}` 会被 handler 拒绝（`Missing required parameter: …`）；批量路径都要传**非空数组**，给出数组即走批量方法。

> 📌 **响应结构要点**（v2.10.0 起）：`node_update` 批量传 `updates[]` 时**逐项回报**（`failed:[{index,nodeId,error}]`，单项失败不中断）；
> `node_clone` 返回 `{success, id, node}`（取 id 用顶层 `id`）；`node_convert_to_component` 回传新母版 `componentId`；
> `page_switch` 返回回读后的 `applied`（排队异步，`false` 不算失败）；`page_create` 返回 `currentPageId`+`hint`（新页不会自动变当前页）；
> `node_move` 传 `index` 即按序号插入（宿主不支持才回退追加并告警）。详见 `12-limitations.md §结构/页面操作的坑与护栏`。


| 类别 | 工具 |
|------|------|
| **设计上下文（4）** | `document_get_info`, `selection_get`, `node_get`, `search_nodes` |
| **设计分析修改（3）** | `design_describe`, `design_suggest`, `design_review` |
| **设计管线（5）** | ⭐ `code_to_design` — **HTML → 画布唯一推荐路径**；`dsl_export_selection`, `dsl_export_node`, `design_to_code` (options: exportSvgs, exportTokens, exportCss, syncTokens), `design_to_code_update` |
| **节点操作（11）** | `node_create`, `node_update`, `node_delete`（三者的批量形态都是传数组参数，没有再拆 `_batch` 工具；**单体/批量二选一约束见上方 📌**）, `node_convert_to_component`, `node_clone`, `node_move`, `node_swap_component`, `node_export_image`, `node_group`（打组：≥2 个节点合成 group）, `node_boolean`（布尔运算：并集/差集/交集/排除）, `node_detach_instance`（detach 实例：断开关联后才可改子层几何）|
| **批量导出（1）** | `node_export_batch`（多图层合并导出 SVG/PNG，超限截断，`savePath` 可落盘；返回结构见下文）|
| **顶层结构（1）** | `node_get_root`（根节点 / 根父层 / 祖先链 / 页面归属；**也可直接传页面 ID**）|
| **页面管理（5）** | `page_list`, `page_create`, `page_delete`, `page_switch`, `page_rename` |
| **高阶组件（4）** | `component_list`, `component_search`, `component_render`, `component_state_matrix`（状态清单见下文）|
| **图标（2）** | `icon_search`, `icon_render` |
| **样式注册与管理（5）** | `library_register_styles`, `style_list_colors`, `style_list_text`, `style_apply`, `fonts_list`（列出当前文档可用字体，避免缺字回退）|
| **团队组件库（6）** | `team_library_list`, `team_component_search`, `team_component_import`, `team_style_list`, `team_style_import`, `team_library_sync` |
| **变量系统（4）** | `variable_list`, `variable_create`, `variable_update`, `variable_delete`（Design Token：集合/模式/12 种类型/`codeSyntax`/scopes；`variable_update` 传 `nodeIds` 时改为**绑定**到图层属性、传 `value` 时**自动传播**到已绑定形状、`activateSet` 控制集合激活；`variable_delete` 传 `collectionId(s)` 可级联删集合）|
| **画布视图（3）** | `canvas_zoom_to_node`, `canvas_zoom_to_rect`, `selection_set` |
| **会话管理（2）** | `session_list`, `session_switch`（三种定位方式见下文）|
| **任务进度（3）** | `task_plan`, `task_step`, `task_complete` |
| **宿主能力探测（1）** | `plugin_capabilities`（apiVersion + 各新 API 运行时可用性；接入新 API 前先调用）|
| **设计 Agent（3）** | `agent_design_by_intent`, `agent_get_status`, `agent_iterate_design` |
| **代码库分析（1）** | `codebase_get_structure` |
| **规则文档与调试（2）** | `get_guidelines`（按 `topic` 加载设计规则）, `get_version` |
| **通知（1）** | `notify` |

## 工具面按 profile 暴露（省上下文）

`tools/list` 会**整份注入 AI 上下文**（全量 67 个业务工具 ≈ 35.6k 字符），所以服务端支持按任务只注册需要的工具：
启动时读环境变量 `UXSHIP_MCP_PROFILE`（逗号分隔可组合，**默认 `gen`**）。

> **默认值是 `gen`（2026-09-30 起），不是兼容性遗留而是产品决定**：`tools/list` 是每个会话的固定支出，
> `gen` 只占 ≈11.6k 字符且含全部旗舰生成能力。要全量必须**显式**写 `UXSHIP_MCP_PROFILE=full`
> —— 全量现在是「选择」，不再等价于「不配置」。
> 默认工具面实测 **28 个**（gen 20 + 常驻协议工具 6 + 诊断 2 + `mcp_tools`），线上约 **1.7 万字符**。

> 下表数字由 `tests/skill-docs-consistency.test.ts` 逐行校验（数量精确、字符容差 10%），
> 并与 `tests/tool-surface-budget.test.ts` 的逐 profile 预算断言同源。口径：
> `JSON.stringify(toolsForProfiles(tools, [profile])).length`，即 `mcp_tools({action:'status'})` 报的值。

| profile | 含什么 | 工具数 / 字符数（实测） |
|---|---|---|
| **`gen`** ⭐ 推荐 | 设计生成常用（**任务形状**，不是领域全集）：上下文（`document_get_info`/`selection_get`/`node_get`/`search_nodes`）+ 节点读写（`node_create`/`node_update`/`node_delete`/`node_clone`/`node_move`）+ 管线与组件（`code_to_design`/`component_render`）+ 素材（`icon_search`/`icon_render`/`design_describe`）+ 产出与收尾（`node_export_image`/`node_export_batch`/`selection_set`/`canvas_zoom_to_node`）+ 规则与自省（`plugin_capabilities`/`get_guidelines`） | **20 / ≈11.4k** |
| `core` | 仅核心节点分区（节点 CRUD、文档上下文、搜索、打组/布尔/detach） | 17 / ≈9.9k |
| `design` | **设计领域全集**：core + 设计管线 + 设计分析 + 高阶组件 + 设计系统资产（含 team/variable/style 查询）| 46 / ≈28.3k |
| `tokens` | 设计系统资产：变量（Design Token）、样式、字体、团队库、组件 | 21 / ≈13.3k |
| `ops` | 运维与宿主：页面管理、画布视图、会话、任务进度、通知、代码库分析 | 18 / ≈6.2k |
| `agent` | Design Agent 三件套 | 3 / ≈1.1k |
| **`full`** | 全部（**需显式 `UXSHIP_MCP_PROFILE=full`**）| 67 / ≈35.6k |

**常驻工具**（任何 profile 都注册，拿不掉）：`plugin_capabilities`（接入新 API 前必调）、`health_get`、
`dsl_spec`、`mcp_tools`；以及**协议级**的 `session_list`、`session_switch`（路由：技能文档要求「每次任务开始时先执行
`session_list`」）与 `task_plan`、`task_step`、`task_complete`（进度：技能文档要求「≥2 步的操作必须先发计划」）
—— 即 `ALWAYS_ON_TOOLS`。

> 为什么协议工具必须常驻：`gen` 清单**刻意不含** `session_*` / `task_*`（避免设计工具面被撑大）。
> 如果只靠「默认 profile 恰好够用」兜住，那任何更窄的 profile（`core` / `agent`）都会**静默打断**
> 文档规定的两个流程（先看会话、先发计划），用户侧表现为「不知道该画到哪个文档」「卡住不动」。

注意 `get_guidelines` **不在**常驻之列：它是 `gen` 清单里的显式成员（因此 `core`/`ops`/`agent` 等不含它）。

### 用 `mcp_tools` 查看 / 启用被隐藏的工具

```
mcp_tools({ action: "status" })
  → { profile: ["gen"], tools: { count, names }, hidden: { count, byProfile, names }, profiles: [...], alwaysOn: [...] }
     profiles[0] 是 gen（标了 recommended），hidden.byProfile 可看出某个工具属于哪个 profile

mcp_tools({ action: "enable", profile: ["design"] })        # 按 profile 批量加载
mcp_tools({ action: "enable", tool: ["component_render"] })  # 按工具名精确加载
  → { enabled: [...], alreadyActive: [...], unknown: [...], profile: [...] }
```

启用后服务端会发 `notifications/tools/list_changed`，客户端会重新拉取 `tools/list`。
**幂等**：重复 enable 同一个工具只会出现在 `alreadyActive` 里，不会重复注册，也不报错；
未知 profile / 工具名不抛错，进 `unknown` 并附合法值提示。

> **如果要用某个工具但 `tools/list` 里没有**：先调 `mcp_tools({ action: "status" })`，
> 在 `hidden.byProfile` 里找到它属于哪个 profile（例如 `component_render` → `design`/`tokens`，`variable_list` → `design`/`tokens`），
> 再 `mcp_tools({ action: "enable", profile: [...] })` 或 `mcp_tools({ action: "enable", tool: [...] })` 加载，然后正常调用。
>
> `gen` 不含 `variable_*` / `team_*` / `style_*` / `page_*` / `session_*` / `task_*` / `agent_*` ——
> 这些属于领域集 / 运维集，需要整块加载时用 `mcp_tools({ action: "enable", profile: ["design"] })`。
>
> ⚠️ **但旗舰生成能力不会被踢出 `gen`**：`component_render`（高阶组件）· `icon_render`（图标直渲，
> 给已有图层补图标时用它比重新渲 HTML 更直接）· `node_export_image` · `node_export_batch` ·
> `selection_set`（生成后选中成果）**都在 `gen` 内** —— `tests/tool-profiles.test.ts` 有断言
> 「旗舰能力不允许为了省字符被踢出 gen」。要更少工具时应新增一个更窄的 profile，而不是削 gen。

## MCP 不表达的关键约定

### 工具执行位置

| 执行位置 | 工具 | 说明 |
|---------|------|------|
| **服务端（无需插件连接）** | `design_to_code`, `design_to_code_update`, `icon_search`, `design_suggest`, `design_review`, `codebase_get_structure`, `get_version`, `get_guidelines`, `team_library_list`, `team_component_search`, `team_style_list`, `team_library_sync` | 由 MCP server 本地执行（`local-tools.ts` / 服务端 handler）。团队库索引类工具优先读 `.uxship/team-library.json`，缓存缺失或过期时才向插件拉取 |
| **服务端预处理 + 插件渲染** | `code_to_design`, `icon_render` | 服务端准备数据（HTML/图标 DSL），再交插件/客户端渲染到画布 |
| **插件** | 其余工具 | 需插件保持连接 |

> 路由规则：工具名命中 `PLUGIN_METHOD_MAP`（或默认 `_`→`/` 映射）的转发插件；在 `LOCAL_TOOLS` 中的交给 `executeLocalTool`，不会静默变成 `Method not found`。新增工具时请同步更新 `tools.ts` 的映射与 `PLUGIN_REGISTERED_METHODS` 断言。

### `content` vs `characters` 字段名映射

| 上下文 | 使用字段 |
|--------|---------|
| **DSL 上下文**（`design_to_code`、`dsl_export_selection`、`dsl_export_node`、`code_to_design` 内部转换） | `content` |
| **MasterGo 原生 API 上下文**（`node_create` 含其 `nodes` 批量形态、`node_update`） | `characters` |

两者不可混用——DSL JSON 中用 `characters` 被忽略，API 调用中用 `content` 不生效。

### 文本属性设置

`TextNode` 没有直接的 `fontSize` / `fontName` 属性，需通过 `setRangeFontSize()` / `setRangeFontName()` 设置。`node_create` / `node_update` 已内置该转换，调用方按常规传入即可。

### Instance 约束

- 创建实例：`node_create`（批量时为 `nodes` 数组）+ `type: "instance"` + `properties.componentId`
- Instance 的**子节点不可直接创建**——由 Master 自动继承
- 实例的 `type` 为 `INSTANCE`，子节点路径格式为 `<instanceId>/<originalChildId>`

### 节点嵌套

先 `node_create` 创建容器（frame/component），再用 `node_create` 的 `nodes` 数组创建子节点并传入 `parentId` 指向容器。

### 几何口径（`node_create` / `node_update`）

**服务端会在转发前归一化几何参数**，所以下面两种写法都能用。
（2026-09-30 之前不行：工具说明写 `type`+`properties`，而**两个宿主**的插件只认 `element`/`nodes`（DSL 元素）
—— 单体创建必失败，批量则把 `properties` 当未知字段**静默丢弃**，节点只剩默认样式。）

| 工具 | 你写 | 服务端转成 | 宿主真正收到 |
|------|------|-----------|------------|
| `node_create` | `{ type, properties: { x, y, width, height, … } }` | DSL 元素 `{ type, position:{x,y}, size:{width,height}, … }` | `element` / `nodes[]` |
| `node_update` | `{ properties: { position:{x,y}, size:{width,height} } }` | 扁平 `{ x, y, width, height }` | 宿主端口的扁平键 |

- **显式优先**：已给了 `element` / `position` / `size` / 扁平键的一律不覆盖。
- 折叠后**删掉被折叠的键**；`node_update` 里若留着 `position`/`size`，宿主会回一堆「尚未映射该属性」的噪声。

### 打组 / 布尔运算 / 实例 detach（`node_group` / `node_boolean` / `node_detach_instance`）

三个工具都是插件方法直通（`node/group`、`node/boolean`、`node/detachInstance`），入参极简：

| 工具 | 参数 | 说明 |
|------|------|------|
| `node_group` | `nodeIds`（≥2，必填）、`groupName?` | 把多个节点合成 GROUP，不改几何；不传 `groupName` 时沿用宿主命名 |
| `node_boolean` | `nodeIds`（≥2，必填）、`operation`（必填） | `union` 并集 / `subtract` 差集 / `intersect` 交集 / `exclude` 排除；运算消耗原节点、原地生成 `BOOLEAN_OPERATION` 结果节点 |
| `node_detach_instance` | `nodeId`（必填） | 实例分离：断开与主组件的关联 |

关键约定：

- **`node_detach_instance` 是「改实例子层几何 / 增删子层」的前置步骤** —— 未 detach 的实例子层由 Master 派生，直接改几何/结构不生效或被宿主回滚。detach 后实例变成普通 frame 副本（子层可自由编辑），但**不再随主组件更新、覆写对应关系丢失**，所以客户端把它标为破坏性工具（`destructiveHint`），需要用户确认；该操作仍可撤销。
- detach 前先用 `plugin_capabilities` 看 `node.detachInstance` 是否为真：宿主两者都缺时返回 `{ success: false, reason: "unsupported" }`（不抛错）；节点不是实例（`type !== INSTANCE`）时抛硬错，不要硬试。
- **`node_boolean` 的节点顺序有意义**：`subtract` 是「第一个节点减其余」，顺序传反会得到相反结果；布尔结果节点可继续用 `node_get` / `node_update` 操作。
- **GROUP 是「松散集合」**：它的 `x` / `y` / `width` / `height` 由子层并集推导，因此改 GROUP 直接子层的几何或在 GROUP 内新建节点会触发宿主做组级重算（组边界被炸开、图标被等比拉伸）。这是宿主既有行为，插件**只告警不阻断**（响应 `warnings`）。布局敏感的内容请建在 frame 里（`node_create` 的 `type: "frame"`）。

### 字体查询（`fonts_list`）

列出当前文档可用字体（插件方法 `fonts/list`，无入参）：`{ count, fonts: [{ family, style, referrer }] }`。

**在写文本前先用它确认字体可用**：`node_create` / `node_update` 的 `fontName` 传了宿主机没有的字体时会被静默回退（渲染出来不是你要的字体，且不报错）。同一文档内结果稳定，不必重复调用。

### 效果激活检查

设置 `effects` 后，用 `dsl_export_selection` 导出确认 `isEffectShow === true`，否则效果可能不显示。

### 组件化优先

重复出现的原子组件（按钮、输入框、复选框等）优先创建为 `component` Master，再通过 `instance` 复用。仅使用一次的独有元素无需封装。

### 节点转组件

`node_convert_to_component` 将已有节点就地转换为 component Master，自动继承全部样式和子节点。再用 `node_create(type:"instance", properties:{componentId:"..."})` 复用。**注意**：`keepOriginal: true` 会创建新 Component 并将原节点的子节点移过去，原节点成为空 frame 残余；使用 `keepOriginal: false`（默认）直接删除原节点、仅保留 Component Master。

三种形态（`anyOf` 三选一，见上方 📌）：

| 形态 | 参数 | 语义 |
|------|------|------|
| A 单个 | `nodeId`（+ 可选 `name`）| 转一个；母版名 = `name ?? 原节点名` |
| B 批量 | `nodeIds[]` | 逐个转，**各自保留自己的名字**（不接受共用 `name`，传了会被忽略并在 `notes` 说明）|
| C 按名建库 | `namePrefix` | 当前页里名字以该前缀开头的节点，**只取最外层**（祖先也匹配的只留祖先，避免先转父节点后子节点 id 失效），逐个转、各自用自己的名字 |
| D 按容器建库 | `containerId` | 只在指定容器的**直接子层**取节点（无名字过滤），逐个转、各自用自己的名字；**变体合成推荐用此形态**（R6 已弃 `DS_` 前缀） |

形态 C 典型用法（把模板里 N 个同前缀节点一次建成组件库）：`node_convert_to_component({ namePrefix: "Button_" })`，额外回 `matched`（最外层候选数）/ `count`（实际转换数）/ `skipped`（原因：`already-component` / `not-found` / `convert-failed`）。

**幂等**：已是 `COMPONENT` 的节点**跳过并记入 `skipped`**（不再抛 `already a component`），所以重复跑形态 C/D 不会失败、也不会生成重复母版。四种形态都回可用的 `componentId`（形态 B/C/D 在 `components[]` 里逐项给）。

#### 变形一：只列举不转换（`listOnly`）

`node_convert_to_component({ containerId: "<Components frame id>", listOnly: true })` → 回 `matched: [{ nodeId, name, type }]`（**只取最外层**，不动画布）。先看会建哪些库、再决定是否执行；它也是 `combineVariants` 的第一阶段。

#### 变形二：按容器分组合成原生变体集（`combineVariants`）

`node_convert_to_component({ containerId: "<Components frame id>", combineVariants: true, variantPropertyName: "State" })`

**必须**给作用域：`containerId`（推荐）或 `namePrefix`（旧式），否则报 `-32602`。这条路径是**服务端编排两次插件调用**（不是一次纯转发，两次都落在同一个 `_sessionId` 会话上）：

1. `{ containerId, listOnly: true }` → 取 `matched[]`；
2. 服务端用纯函数 `src/utils/variant-groups.ts` 把名字解析成**显式属性表** `variantGroups[]`（属性名与取值不靠宿主猜）；
3. `{ variantGroups: [{ setId, propertyName, members: [{ nodeId, value }] }], keepOriginal }` → 插件改名 + 合成原生变体集。

解析规则（**两个宿主共用**，逐字实现；R6）：

| # | 规则 |
|---|------|
| 1 | 名字按 `_` 切段；**首段 = 组件类型 = `setId`**（`Button_Primary` → `Button`）。**不需要 `DS_` 前缀**（范围由 `containerId` 保证） |
| 2 | 轴值 `value` = **第 2 段起的原样拼接**：`Button_Primary` → `Primary`；`Button_Primary_Disabled` → `Primary_Disabled` |
| 3 | 只有一段（`Button`）→ 跳过并写进 `notes`（那是容器/组框本身，不是成员） |
| 4 | **组内成员 < 2 不合成**：该成员进 `singles` 与 `skipped`（`reason: variant-group-too-small`）并在 `notes` 说明；它**不会**被转成组件 |
| 5 | 轴名默认 `State`，可用 `variantPropertyName` 覆盖 |
| 6 | 顺序稳定：组按 `setId` 首次出现顺序，组内成员按输入顺序 |
| 7 | 同一 `setId` 内**重复轴值**：保留全部成员，但在 `notes` 明确告警（宿主侧可能出现歧义），**不静默去重** |

返回：`variantSets[]`（`{ setId, containerId, propertyName, memberCount, values, ok, reason }`）+ `components[]` + `skipped[]` + `notes[]`（另带 `count` / `success`，与三种旧形态一致）。`notes` 按来源加前缀：`服务端解析（containerId=…）：…`（跳过 / 单成员 / 重复轴值）与 `插件执行：…`（宿主降级）。没有成员 ≥2 的组时**不发第 2 次请求**，回 `ok: false` + notes。

**命名建议**：作用域内每个变体成员写成 `<类型>_<轴值>`（如 `Button_Hover` / `Button_Disabled`），同一 `setId` 下 ≥2 个成员才会合成。

> **多轴（已真机验证，Penpot）**：`variantPropertyName` 支持**逗号分隔多轴**，如 `"Variant,State"` → `Button_Primary_Hover` 解析为 `Variant=Primary, State=Hover`，产出 `variantGroups[{ properties[], members[{values[]}] }]`。Penpot 侧回读 `Variants.properties` 已确认为 `["Variant","State"]`（无幽灵属性）。
>
> ⚠️ **Penpot 坑（已修）**：`createVariantFromComponents` 容器**自动带 1 个属性**，第 0 轴必须**复用只 rename**、不能 add；否则每加一轴都多一个幽灵属性。
>
> ⚠️ **MasterGo 多轴未验证**：`combineAsVariants` 从成员名 `Prop=Value` 推导轴（无显式 addProperty）。适配层按 `Prop1=Value1, Prop2=Value2` 编码，能否推导出两轴**需真机确认**；未确认前 MasterGo 侧请按单轴用。

### HTML 渲染唯一路径

```
HTML 文件/code → code_to_design(filePath | html) 
  → 服务端预处理（图标本地缓存、图表 ECharts SSR、组件预渲染）
  → 客户端浏览器真实渲染（Flexbox/Grid 布局精度）
  → 提取精确像素值 → 渲染到设计画布
```

不推荐直接传 DSL 负载给插件——`code_to_design` 是唯一路径，零 token 传输。

### 渲染模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `client`（唯一模式） | 服务端预处理后发送到插件 UI 在浏览器中真实渲染，提取精确像素值后渲染到画布 | 所有场景，布局精度最高 |

> 服务端渲染（`server`）已移除。所有 HTML 渲染统一走客户端浏览器真实渲染路径，确保 100% Tailwind class 兼容和 Flexbox/Grid 布局精度。

### data-icon 图标自动解析

HTML 中 `data-icon="ri:icon-name"` 在 `code_to_design` 中自动渲染为 SVG 元素。3229+ Remix Icon 本地缓存，无需网络。服务端预处理会将本地图标替换为内联 SVG，非缓存图标集回退到客户端在线获取。

### 团队组件库（团队库）引用

团队库索引（库 / 组件 ukey / 样式 ukey）来自插件 `teamLibrary/list`，服务端缓存到 `.uxship/team-library.json`（默认 6h 有效，`UXSHIP_TEAM_LIBRARY_CACHE` 可改路径，`team_library_sync` 强制刷新）。仅插件模式（WebSocket）可用。

推荐工作流：

```
team_library_list（有什么库）
  → team_component_search / team_style_list（拿到 ukey）
  → team_component_import / team_style_import（落到画布）
```

导入类工具的参数形状（`team_component_import` / `team_style_import`）：

| 参数 | 形状 |
|------|------|
| `ukey` / `ukeys` | 团队组件 / 样式的 ukey，最精确的引用方式 |
| `component` (+ `library`) | 无 ukey 时按名称解析；`library` 限定库名或库 id |
| `components` | 批量导入数组，**元素与顶层参数同构**：`[{ ukey?/component?/library?/variant?/x?/y?/width?/height?/name?/overrides?/variantProperties? }]`；配合 `layout: "row" \| "column" \| "none"` + `columns` / `gap` / `startX` / `startY` 自动排布 |
| `variantProperties` | 组件集变体属性覆写，如 `{"State":"Hover","Size":"Large"}`，实例创建后调用 `setVariantPropertyValues` 应用 |
| `overrides` | 实例子节点覆写，键为子节点名：`{ "子节点名": { "text": "文案", "fill": "#4340EA", "visible": "true" } }` |
| `applyTo` / `applyAs` | `team_style_import` 专用：`applyTo` 是目标节点 ID，`applyAs` 决定颜色样式落到 `fill`（默认）还是 `stroke` |

`team_library_sync` 的 `path` 可用环境变量 `UXSHIP_TEAM_LIBRARY_CACHE` 覆盖（默认 `.uxship/team-library.json`）；`includeCover: true` 会缓存组件封面地址（体积大，默认 false）。

HTML 中引用团队组件的属性（`code_to_design` 自动处理）：

| 属性 | 说明 |
|------|------|
| `data-library-ukey` | 直接引用团队组件 ukey，优先级最高 |
| `data-library-component` | 值可为 ukey / 组件名 / 「库名/组件名」，服务端解析后重写为 `data-library-ukey`；解析不到会移除属性并告警（元素按普通容器渲染） |
| `data-library-library` | 配合 `data-library-component="组件名"` 限定库 |
| `data-library-variant` | 组件集（COMPONENT_SET）选定 variant，如 `Selected` |
| `data-library-variant-properties` | 变体属性覆写，JSON 字符串，如 `{"State":"Hover"}` |
| `data-swap-node-id` | **换组件**：目标已有对象节点 ID，多个用逗号/空格分隔（如 `1:2,3:4`）。出现即声明该元素为「换组件指令」——不新建节点：目标是 INSTANCE 则换主组件，目标是非实例对象则原位替换为组件实例 |
| `data-swap-ukey` | 换组件目标：团队库组件 ukey（最终形态，直接导入）|
| `data-swap-component` | 换组件目标：值可为 ukey / 组件名 / 「库名/组件名」，服务端解析后重写为 `data-swap-ukey`；解析不到会移除属性并告警 |
| `data-swap-library` | 配合 `data-swap-component="组件名"` 限定团队库 |
| `data-swap-component-id` | 换组件目标：当前文档内已有组件（COMPONENT / COMPONENT_SET）ID |
| `data-swap-variant` | 换组件目标组件集的 variant 名称片段（如 `Hover`）|
| `data-swap-variant-properties` | 换组件后写入的变体属性覆写，JSON 字符串，如 `{"State":"Hover"}` |
| `data-swap-keep-size` | `true` 时保持替换前的宽高（重主组件默认采用新组件尺寸；非实例对象原位替换**默认保持**原宽高）|
| `data-swap-reset-overrides` | `true` 时重置实例的直接覆写（默认保留可对应的覆写）|
| `data-swap-keep-original` | `true` 时保留被替换的原对象（默认删除；原位替换模式）|

换组件用法：

```html
<!-- 按名称引用团队库组件，选定 variant 并保持宽高 -->
<div data-swap-node-id="1:2" data-swap-component="库名/按钮" data-swap-variant="Hover" data-swap-keep-size="true"></div>

<!-- 批量换成团队库 ukey / 文档内组件 -->
<div data-swap-node-id="1:2,3:4" data-swap-ukey="ukey:xxx"></div>
<div data-swap-node-id="1:2" data-swap-component-id="Component:abc"></div>
```

约定：

- 换组件指令元素不产生新节点，因此可挂在 0 尺寸占位元素上（早于尺寸早退判断）；纯换组件 HTML 不会额外创建根 frame
- 目标组件解析顺序：`data-swap-component-id` → `data-swap-ukey` / `data-swap-component` → 回退 `data-component-id` / `data-component-name` / `data-library-ukey` / `data-library-component`（与 `node_swap_component` 一致：componentId → ukey → componentName，本地文档优先，其次团队库名称解析）
- 语义标签自动注入（`component-auto-map`）在元素已带 `data-swap-*` 时不会覆写目标组件
- 仅对可替换对象生效：实例换主组件；`FRAME / GROUP / RECTANGLE / ELLIPSE / TEXT / POLYGON / STAR / LINE / PEN / VECTOR / BOOLEAN_OPERATION` 原位替换为组件实例（保持父容器与图层顺序、继承位置/宽高/旋转、按图层名带过文字与可见性，然后删除原对象）；`COMPONENT / COMPONENT_SET` 拒绝替换
- 目标节点不是实例、对象类型不可替换、ID 不存在、组件解析失败时只告警不中断整个渲染

### 设计完成后自动聚焦

`code_to_design` / `dsl/render` 渲染完成后会默认把可视区**滚动 + 缩放**到刚创建的根节点并选中它，用户无需手动寻找成果。

| 参数 | 默认 | 说明 |
|------|------|------|
| `focus` | `true` | `false` 时保持用户当前视角（不滚动、不缩放）|
| `select` | `true` | `false` 时只聚焦不改变选中 |
| `focusNodeId` | — | 改为聚焦指定节点（`dsl/render` 层）|
| `zoom` | — | 聚焦后强制缩放比例（1 = 100%）|

手动控制视角的三个工具：

| 工具 | 说明 |
|------|------|
| `canvas_zoom_to_node` | 聚焦节点（`nodeId`/`nodeIds`，缺省用当前选区），可选 `select` / `zoom`；返回聚焦后的 `focusedNodeIds` 与 `viewport`（zoom/center/bound）|
| `canvas_zoom_to_rect` | 聚焦画布坐标矩形（`x`/`y`/`width`/`height`），不改选中 |
| `selection_set` | 改变选中：`nodeIds`（`[]` 清空）/ `addToSelection` / `selectAll` |

实现依据：`mg.viewport.scrollAndZoomIntoView(nodes)`、`mg.viewport.zoom` / `mg.viewport.center`（center 需整体赋值）、`mg.document.currentPage.selection`（需整体赋值）。插件方法为 `canvas/zoomToNode`、`canvas/zoomToRect`、`selection/set`；`focusNodes()` 被 DSL 渲染链路复用，保证自动聚焦与手动聚焦行为一致。

注意事项：

- 实例优先级：`componentUkey`（团队库）→ `componentId`（本文档 Component Master）→ `componentName`；均未命中时 fallback 为普通 frame
- 团队组件导入需要团队库已启用/关联且账号有权限，否则报 `团队组件导入失败 (ukey=...)`
- 团队组件参与语义标签自动匹配（`<button>`→`DS_Button`）仅作为本地 Component Master 的**兜底**，且只接受归一化后完全同名的组件（如 `DS_Button` / `Button`）
- 实例不支持 fills/strokes 样式覆盖（继承 Master），可用 `overrides` 覆写子节点文字/颜色/可见性
- 实例导入会向文档写入节点，属副作用操作，dispatcher 不缓存其结果

### 图表自动处理

HTML 中 `<chart option='{...}' />` 在 `code_to_design` 中由服务端预处理，通过 ECharts SSR 渲染为 SVG 后发送到客户端。

### 预设组件自动处理

HTML 中 `<component type='button' config='{...}' />` 在 `code_to_design` 中由服务端预处理，预渲染为 HTML 片段后发送到客户端。支持 33 种组件类型：checkbox-group, radio-group, checkbox, radio, button, badge, avatar, toggle, progress, text-input, select, menu, tabs, list, slider, breadcrumb, tooltip, divider, tag, spinner, modal, alert, pagination, steps, accordion, card, table, form, toast, skeleton, page-shell, feature-grid, pricing-table

### `component_render` 主题默认值

```json
{
  "brand": "#4340EA",
  "brandLight": "#F4F3FF",
  "border": "#D0D5DD",
  "borderHover": "#4340EA",
  "borderDisabled": "#E0E0E0",
  "bgWhite": "#FFFFFF",
  "bgDisabled": "#F5F5F5",
  "bgDisabledChecked": "#E0E0E0",
  "textPrimary": "#333333",
  "textDisabled": "#999999",
  "textTitle": "#1A1A2E",
  "checkMark": "#FFFFFF",
  "checkMarkDisabled": "#999999",
  "containerWidth": 400,
  "containerCornerRadius": 12,
  "shadowColor": "rgba(0,0,0,0.10)",
  "shadowOffset": {"x": 0, "y": 4},
  "shadowRadius": 12,
  "titleSize": 18,
  "labelSize": 14,
  "componentSize": 16,
  "componentCornerRadius": 6,
  "strokeWeight": 1.5
}
```

### Token 层级与覆盖规则

设计系统 Token 按 **通用 Scale → 组件级 Token** 两层组织，通过 `theme` 参数覆盖：

```
用户设置 borderRadiusLg: 8
  ↓ mergeTheme 自动推导
  buttonRadius, tagCornerRadius → 8
  componentCornerRadius → 4 (borderRadiusMd)
```

**Scale Token → 组件 Token 映射表：**

| Scale Token | 默认值 | 影响的组件 Token |
|-------------|--------|----------------|
| `borderRadiusSm` | 2 | `tooltipCornerRadius` |
| `borderRadiusMd` | 4 | `componentCornerRadius`, `paginationBtnCornerRadius`, `accordionCornerRadius`, `alertCornerRadius` |
| `borderRadiusLg` | 6 | `buttonRadius`, `tagCornerRadius` |
| `borderRadiusXl` | 8 | `radioCornerRadius`, `containerCornerRadius`, `modalCornerRadius` |
| `borderRadiusFull` | 9999 | `sliderHandleSize` (圆形手柄) |

**覆盖优先级（高 → 低）：**
1. 用户显式设置组件 Token（如 `buttonRadius: 10`）
2. 用户设置 Scale Token（如 `borderRadiusLg: 10` → 自动推导 buttonRadius）
3. DEFAULT_THEME 默认值

**快速示例：**
```js
// 只传 brand + 调整圆角阶梯，所有组件自动继承
component_render type: "button", theme: { brand: "#C9A94E", borderRadiusLg: 12 }

// 等于 buttonRadius: 12, tagCornerRadius: 12（除非显式覆盖）
```

## 组件交互状态矩阵（`component_state_matrix`）

为指定组件类型一次性生成各交互状态的 COMPONENT master 并排展示。`config` 与 `component_render` 的 config 同构（`label` / `variant` / `size.tier` / `theme.mode` 等），状态配色由组件类型决定，不需要自己传颜色。

### 支持的组件类型与状态清单（14 种）

| `type` | 状态 | 个数 |
|--------|------|------|
| `button` | default / hover / active / disabled / focused | 5 |
| `text-input` | default / hover / focused / disabled / error | 5 |
| `badge` | default / hover / disabled | 3 |
| `toggle` | default / checked / hover / disabled | 4 |
| `checkbox` | unchecked / checked / hover-unchecked / hover-checked / disabled-unchecked / disabled-checked | 6 |
| `radio` | 同 `checkbox`：unchecked / checked / hover-unchecked / hover-checked / disabled-unchecked / disabled-checked | 6 |
| `select` | default / hover / focused / disabled / error / open | 6 |
| `tabs` | active / inactive / hover / disabled | 4 |
| `tag` | default / hover / active / disabled / closable | 5 |
| `card` | default / hover / selected / disabled | 4 |
| `menu-item` | default / hover / active / disabled | 4 |
| `slider` | default / hover / active / disabled | 4 |
| `accordion` | collapsed / expanded / hover | 3 |
| `list-item` | default / hover / selected / active | 4 |

- `states` 不传时的默认值是 `["default","hover","active","disabled","focused"]`——它只对默认状态集有意义的组件（button / text-input / badge 等）成立。`checkbox` / `radio` / `tabs` / `accordion` 等请显式传上表里对应的状态名，否则拿不到该类型的专用配色。
- 未登记的 `type` 退化为通用样式（default / hover / active / disabled / focused 的基础色），仍会渲染出对应数量的状态组件。
- 状态标签：`default`→Default, `hover`→Hover, `active`→Active, `disabled`→Disabled, `focused`→Focused, `checked`→Checked, `unchecked`→Unchecked, `error`→Error, `open`→Open, `hover-unchecked`→Hover Unchecked, `hover-checked`→Hover Checked, `disabled-unchecked`→Disabled Unchecked, `disabled-checked`→Disabled Checked, `inactive`→Inactive, `closable`→Closable, `collapsed`→Collapsed, `expanded`→Expanded, `selected`→Selected。

### 两种命名模式（`naming`）

| `naming` | 组件命名 | 是否合成多态组 |
|----------|----------|----------------|
| `default`（默认） | `DS_{Type}_{Variant}_state={state}`，如 `DS_Button_Primary_state=hover` | 否：各状态是独立 COMPONENT master，需手动选中后右键 Combine as Variants |
| `variant` | `{variantPropertyName}={state}`，默认 `State=hover`（符合 MasterGo 变体组命名格式） | 是：调用 `mg.combineAsVariants` 自动合成 ComponentSet（多态属性在 Assets 面板可见），命名 `DS_{Type}_{Variant}`；合成失败时降级为告警提示手动合成 |

`variantPropertyName` 仅在 `naming="variant"` 时生效，默认 `"State"`。返回值含 `components[]`（`{id, name, state}`）、`componentSet`（合成成功时）、`namingPattern`（实际使用的命名模板）。

## 变量系统（`variable_*`）返回结构与口径

工具面只保留参数要点，字段口径都在这里。客户端能力：`mg.variables` 可用（私有企业版 MasterGoPrivate 1.10.3 实测）。Design Token 类型共 12 种：`COLOR` / `NUMBER` / `STRING` / `BOOLEAN` / `PAINT` / `TEXT` / `EFFECT` / `GRID` / `STROKE_WIDTH` / `CORNER_RADIUS` / `PADDING` / `SPACING`。

### `variable_list`

```
{ available,
  collections: [{ id, name, isExternal, modes: [{ id, name }], variableCount,
      variables: [{ id, name, type, description, alias, isExternal, supportScope, codeSyntax?, scopes?, values? }] }],
  stats: { collections, variables },
  warnings? }
```

- `values` 的键是 **modeId**：某模式只有一个值时返回**标量**，多个值时返回**数组**；`includeValues: false` 时整个 `values` 字段省略（只要 Token 名与分类、在意返回体量时用它）。
- `includeExternal: false`（默认）时 `isExternal=true` 的变量与集合不返回。
- `groupPath` 对应变量名里的 `/` 路径，如 `color/brand`。
- 空文档（无集合 / 零变量）返回空数组且不报错；客户端不支持变量 API 时 `available: false`，原因见 `warnings`。

### `variable_create`

- 不传 `collectionId` 时自动落到文档第一个集合；一个集合都没有时先创建名为 `"Design Tokens"` 的集合，并在返回里给出 `createdCollectionId`。
- 传了 `value` 时用该集合的第一个 Mode 通过 `setVariableValue` 写入初始值；写值失败不影响变量创建，原因进 `warnings`。
- `value` 的形状随 `type`：`COLOR` 传 RGBA 对象 `{ r, g, b, a }`（0–1）或十六进制字符串；`NUMBER` 传数字；`STRING` 传字符串；`BOOLEAN` 传布尔；`PAINT` / `TEXT` / `EFFECT` / `GRID` 传对象。不传 `value` 则创建空值变量。
- 变量名支持分组路径，如 `color/brand/primary`。返回 `{ success, variable, createdCollectionId?, warnings? }`。
- **批量形态**：传 `variables: [{name,type,value}]` 走 `variable/batchCreate` —— 逐条幂等建/更新、单条失败进 `errors[]` 不中断；可选 `collectionName`（目标/新建集合）与 `activate: true`（建完激活集合，暗色主题切换用）。`variables: []` 或只传 `name` 仍走单条。

### `variable_update`

- 只有实际传入的字段会被写入（`applied` 精确列出真正生效的字段），未传的字段一律不触碰。
- 改 `value` 不传 `modeId` 时取该变量所属集合的第一个 Mode；客户端缺少某个方法或单步失败会进 `warnings`，不中断其它字段。
- 可更新字段：`name` / `description` / `value` / `codeSyntax`（`{ web, android, ios }` 三平台代码语法）/ `scopes`（ScopeName 列表，决定 Token 能绑定到哪些图层属性）/ `alias`（语义化引用名，如 `Brand/Primary`）。返回 `{ success, variable, applied, warnings? }`。
- **选择器口径（两个宿主同义）**：传了 `id` → `id` 是**选择器**，`name` 是**新名字**（改名）；只传 `name` / `variableId` → 按名字定位（兼容旧用法）。
  为什么要把这条写清：工具 schema 的必填字段是 `id`（为 MasterGo 的形状），而 Penpot 的宿主方法按**名字**定位 —— 不把 `id` 反查成名字，
  调用方拿 `variable_create` 返回的 id 去改值会**必失败**，而"改一次令牌、全稿联动"正是设计系统流水线的主循环。

### `variable_update` 的绑定路径（传 `nodeIds`）

传 `nodeIds` 时按实参形状选路到插件方法 **`variable/apply`**：把令牌**绑定**到这些节点的属性上（默认 `fill`，`properties` 可改），**不是**把值拷过去。

```
variable_update({ id: "<令牌id>", nodeIds: ["<节点id>", ...], properties: ["fill"] })
  → { ok, name, properties, total, applied, nodes: [{ nodeId, applied, bound }], skipped? , note }
```

- **绑定是引用**：`shape.tokens` 记下引用；**但"改令牌值就自动改渲染"是错的** —— 见下节「改值传播」。
- **顺序敏感**：宿主"直接改属性即解绑" —— 绑定之后再 `node_update` 写 `fills` 会静默掉落引用，必须重新绑定。
  所以流水线顺序是「先落结构与属性 → **最后**统一绑令牌」。
- **幂等**：对**已绑定同一令牌**的节点再下发会**解绑**（真机实测：`tokens` 变回 `{}`、fills 留旧值），
  所以实现会在下发前先回读、已绑则跳过（响应 `note` 写明"已绑定，跳过重复下发"）。
- **校验只认回读**：`applied` 来自 `shape.tokens` 的读回（逐节点 `bound`），不来自"调用没报错"。
- **能力差异**：Penpot 支持真绑定；**MasterGo 侧没有这条通道**（本插件未回写变量绑定），会返回 `available: false` +
  运行时探测证据（`probe[]`）而不是假装成功。

### 改值传播（value 改动 → 全稿联动）

**改令牌值不会自动回写已绑定形状**（真机实测 Penpot 2.18.0：集合 `active`、引用也在，改值后
`fills` 与导出 PNG 像素仍是旧色；而在 Penpot 面板里手改同一个令牌却会刷新 —— 差别是面板会**重下发**）。

所以 `variable_update` 传了 `value` 时会**自动传播一次**，并在响应里如实回报：

```
variable_update({ id, value: "#0066FF" })
  → { ok, name, updated: ["value"], propagated: { matched, rewritten, rebound, mechanism } }
```

| 字段 | 含义 |
|------|------|
| `matched` | 本页扫到多少块绑着该令牌（Penpot 只能看当前页）|
| `rewritten` | **回读**确认 fills 真的变了多少块（不是乐观值）|
| `rebound` | **回读**确认绑定引用回来了多少块 |
| `mechanism` | 当前是 `unbind+rebind …` —— 理由见下 |

**为何是"解绑+重绑"**：宿主这两个 API（`shape.applyToken()` / `Token.applyToShapes()`）是**切换**语义，
对**已绑定**的形状再下发 = **解绑**，而且**不写新值**。只有"解绑 → 重绑"里的重绑那一步会
把当前令牌值写进 fills（初次绑定就是这么写入的）。传播失败会进 `warnings`，不会谎报成功。

### `activateSet`（集合激活）与新建集合的坑

Penpot 的令牌模型是「**激活的集合**里的令牌才驱动渲染」。真机实测：`addSet` 新建的集合默认 `active: false`，
此时绑定只是引用、**渲染不会跟着令牌走**。

- 新建令牌时若集合未激活，`variable_create` 的响应会带 `setActive: false` + `hint`（指引用 `activateSet` 激活），
  避免调用方误以为自己弄错了。
- 激活：`variable_update({ id, activateSet: true })` → 响应 `setActive: true`（回读确认）。
- 官方另有一套 **主题（TokenTheme）** 模型（`active` / `activeSets` / `toggleActive()` / `addSet()`）—— 多主题场景才需要，当前未接线。

> 参考（可核对）：官方插件 API 文档 <https://doc.plugins.penpot.app>（由上游 `api_types.yml` 生成）。
> 注意 npm 上 `@penpot/plugin-types@latest`（1.4.2）**没有任何 token 字样**，令牌 API 自 **1.5.0** 起公开 ——
> 拿 npm 包对账会得出"这 API 不存在"的错误结论。

### `variable_delete`

- 支持单个 `id` / 批量 `ids`（删变量）与 `collectionId` / `collectionIds`（删集合）。**传 `collectionId(s)` 会连集合内的变量一起删**。
- 逐个删除、部分失败不中断：返回 `{ success, deleted: [id], deletedCollections: [id], failed: [{ id, error }] }`，全部成功才 `success: true`。
- 删除不可撤销（会进撤销栈，可在客户端撤销），已绑定到图层的引用会一并失效——删前先用 `variable_list` 确认目标。

## 导出类工具返回结构

### `node_export_batch`（多图层合并导出）

- `format: "svg"` 走宿主 `mg.exportSvgByLayerIds`（矢量源码文本）；`format: "png"` 走 `mg.exportPng`（多图层合并，`scale` 指定倍率、`filterIds` 排除图层）。不传 `layerIds` 时回退当前选区（`useSelection: false` 可关闭回退）。
- 返回 `{ encoding: "text" | "base64", data, mimeType, bytes, truncated, warnings }`：
  - `encoding=text` → `data` 是 SVG 源码；
  - `encoding=base64` → `data` 是纯 base64，**data URI 前缀已剥离**。
- 内容超过 `maxBytes`（默认 4MB）会截断并置 `truncated=true`，此时建议传 `savePath` 让服务端落盘（响应返回文件路径与体积），或缩小导出范围。
- 失败**不抛异常**，返回 `{ success: false, reason, message }`：`unsupported`（当前客户端没有 `exportSvgByLayerIds` / `exportPng`，可用 `plugin_capabilities` 复核）、`export-failed`（宿主报错或返回空内容）、`invalid-params`（`format` 不是 `svg` / `png`）、`no-layers`（没有可导出的图层）。

### `dsl_export_selection` / `dsl_export_node` / `design_to_code`

三者共用 `convertToCode` / `exportSvgs` / `svgOutputDir` 口径：

| 参数 | 默认 | 说明 |
|------|------|------|
| `convertToCode` | `false` | `true` 时返回**原始 DSL + SVG 资产**，DSL 不进入 AI 上下文（AI 直读 DSL 渲染），并可用于创建 DesignCache session 供 `design_to_code_update` 增量导出 |
| `exportSvgs` | `false` | 仅 `convertToCode: true` 时生效：把 `__svg` 后缀的图标导出为独立 SVG 文件 |
| `svgOutputDir` | `"icons"` | 仅 `exportSvgs: true` 时生效的 SVG 输出目录名 |
| `exportTokens` | `false` | 从 DSL 提取设计令牌（CSS 变量 / Tailwind / DTCG）；传 `theme.brand` 时额外推导三层色板 `palette`（P2-2），`darkMode` 时给暗色板 |
| `exportCss` | `false` | 需 `nodeId`：调宿主 `style/generateCss`（Penpot `generateStyle` + `generateFontFaces`）拿**原生 CSS + @font-face**，结果在 `hostCss`；宿主不支持时 `available:false`（不伪造） |
| `syncTokens` | `false` | 需 `exportTokens` + `theme.brand`：把推导出的 `palette.system` 批量写入画布令牌（`variable/batchCreate`）并激活集合，结果在 `syncedTokens`（暗色写入 `Design Tokens (Dark)`）|

## 大输出工具与收窄方式

工具**结果**是每次调用都进 AI 上下文的付费内容。服务端对下列「重输出」工具加了**输出侧预算**
（默认上限 **24,000 字符**，实现见 `mcp-server/src/utils/response-budget.ts`）：

| 分组 | 受预算约束的工具 |
|---|---|
| DSL 导出（最大头） | `dsl_export_selection`、`dsl_export_node` |
| DSL → 代码 | `design_to_code`、`design_to_code_update` |
| 节点查询 | `node_get`、`node_get_root`（`includeSubtree` 更易膨胀；均支持 `fields` 白名单） |
| 检索类 | `search_nodes`、`component_list`、`component_search`、`variable_list` |
| 团队库 | `team_library_list`、`team_component_search`、`team_style_list` |
| 其他 | `codebase_get_structure`、`design_describe`（`depth` 传大时） |

**看到 `_budget.truncated: true` 时，不要把结果当作完整设计。**
响应形状（结构保持式截断，永远是合法 JSON）：

```jsonc
{
  "nodes": [ /* 只保留前 N 项，从 50 起逐次减半直到进预算 */ ],
  "_truncated": { "field": "nodes", "shown": 50, "total": 300 },  // 被截字段的兄弟位；多个字段被截时为数组
  "_budget": {
    "maxChars": 24000,
    "actualChars": 7193,          // 截断后的实际字符数（未截断时等于原始长度）
    "truncated": true,
    "notes": [ { "field": "nodes", "shown": 50, "total": 300 } ],
    "hint": "输出已被截断（原 41218 字符 > 上限 24000）：收窄搜索条件（name / types / colors）或调小 limit；需要整体概览时改用 design_describe 拿摘要"  // 工具感知：直接给当前工具该用的手段
  }
}
```

收窄方式（按优先级）：

1. **读 `_budget.hint`** —— 它是服务端给出的**工具感知**中文收窄建议（直接指出该工具该用的手段），不要无视；
2. **`node_get` / `node_get_root` 传 `fields`** —— 只取需要的**顶层**字段，从源头就小（`id` 始终返回）；
3. `design_describe`：轻量结构化摘要，比 DSL 小 60–80%，先看结构再决定取谁；
4. `design_describe({ depth })` / `dsl_export_node({ maxDepth })` / `node_get_root({ maxDepth })`：限制递归深度；
5. **只取子节点逐个查**：拿 `node_get` 查一层、需要时再往下，而不是一次导出整棵子树；
6. `dsl_export_node({ convertToCode: true })`：DSL 不进上下文，只拿代码/SVG 资产；
7. 检索 / 列表类用过滤参数缩小结果集：`search_nodes` 收窄条件或调小 `limit`；`component_*` / `variable_list` / `team_*` 用 `limit` / `type` / `collectionId` / `library`；
8. `codebase_get_structure`：传更具体的 `dir` 子目录（或调小 `depth`），别一次扫整仓；
9. 图片 / 大文件用 `node_export_image` / `node_export_batch` 的 `savePath` 落盘；
10. 确实需要全文时传 `maxChars: 0`（不限制）或 `maxChars: <更大值>`——**逃生阀，谨慎用**。

#### `fields` 白名单（`node_get` / `node_get_root`）

**主动收窄优于超限后被动截断**：只要几个字段时，不要先把整棵树拉进上下文再被截。`fields` 接受数组或
逗号分隔字符串，只过滤**顶层**（嵌套子对象原样保留），且 **`id` 始终返回**：

```jsonc
// 调用：node_get({ nodeId: "1:2", fields: ["name", "fills"] })
{
  "name": "Frame",
  "fills": ["#FFFFFF"],
  "id": "1:2",                        // 自动保留：AI 定位 / 续查节点必需
  "_fields": { "kept": ["name", "fills", "id"], "missing": ["fill"] }
}
```

**`_fields.missing` 非空 = 你把字段名写错了**（本次没返回该字段，也不会静默纠正大小写）。照 `missing` 里的原名
改对再重试，不要臆测「这个节点没有这个属性」。`node_get_root` 只过滤响应顶层，`root` 等子对象保持原样。

不受预算影响的工具（刻意不叠两层）：`node_export_image` / `node_export_batch` 自带 `maxBytes` + `savePath` 机制；
`health_get` / `dsl_spec` / `mcp_tools` / `plugin_capabilities` 体积小且是 AI 做决策的依据。

> `component_render` 的类型专属参数目录见 `rules/16-component-catalog.md`。

## 宿主能力探测与规则文档

### 宿主能力探测（`plugin_capabilities`）

**接入任何新插件 API 前先调用它**，不要仅凭 typings 判断——私有化企业版客户端通常落后主线很多。返回 `mastergoApiVersion` / 本插件版本 / 运行模式，以及各组新 API 的运行时可用性：

| 能力组 | 覆盖的 API |
|--------|-----------|
| `teamLibrary` | 团队库索引与导入（`importComponentByKeyAsync` 等） |
| `node` | `swapComponent` 等节点新 API |
| `export` | `exportPng` / `exportSvgByLayerIds` / `getExportList` |
| `variables` | `mg.variables`（Design Token 读写） |
| `misc` | `setCloseConfirm` / WebSocket / `positionOnDom` |

`node_get_root` 的实际可用性同样受宿主限制：私有化企业版仅支持 `getRootNodeById` / `getRootParentLayerId`，`getTopContainerInfoListByPageID` 不可用，因此**没有**整页顶层容器列表工具。

### 顶层结构查询（`node_get_root`）

- 返回三部分：所属根节点（`rootNodeId` + 摘要）、根父层 id（`getRootParentLayerId`）、祖先链（自下而上到所在页面）与页面归属（`pageId` / `pageName`）。**也可以直接传页面 ID** 查询页面归属（节点解析支持 PAGE）。
- `includeSubtree: true` 时额外返回该节点的子树序列化快照；`maxDepth` 限制递归层数（`0` = 仅查询节点本身，默认 `3`），**仅在 `includeSubtree: true` 时生效**。
- 宿主缺少根查询 API 时返回 `{ success: false, reason: "unsupported" }`，不抛错。

### 规则文档加载（`get_guidelines`）

AI 在设计前应调用它加载相关规则，确保生成的 HTML+Tailwind 符合设计系统规范。`topic` 取值（不传返回全部规则的索引）：

| `topic` | 规则文档 |
|---------|----------|
| `quickstart` | 快速入门（`00-quickstart.md`） |
| `core-tags` | 标签规范（`01-core-tags.md`） |
| `layout` | 布局样式（`02-layout-styles.md`） |
| `chart` | 图表（`03-charts.md`） |
| `freeze` | 冻结节点（`04-freeze-nodes.md`） |
| `pitfalls` | 避坑指南（`05-pitfalls.md`） |
| `image` | 图片（`06-images.md`） |
| `tools` | MCP 工具参考（`07-mcp-tools.md`，本文档） |
| `dsl` | DSL 规范 / HTML 转 DSL（`08-dsl-specification.md` + `10-html-to-dsl.md`） |
| `design` | 设计指南 / 设计系统（`09-design-guide.md` + `14-design-system.md`） |
| `example` | 示例（`11-examples.md`） |
| `limitation` | 已知限制（`12-limitations.md`） |
| `codebase-viz` | 代码库可视化（`15-codebase-viz.md`） |

`get_version` 返回服务器版本号、Node.js 版本与运行时间，用于调试和确认服务器状态。

---

## 换组件（替换主组件 / 普通对象换组件）

工具：`node_swap_component`（插件方法 `node/swapComponent`；插件端 `applyComponentSwap` 同时被 `dsl/render` 的 HTML 换组件复用，两条链路行为一致）。

### 两种工作模式

| 目标对象 | 行为 | 关键点 |
|---------|------|--------|
| `INSTANCE` | 调 `InstanceNode.swapComponent()` 换主组件 | 能按子图层名对上的覆写自动保留；`resetOverrides: true` 清空；调用后会轮询校验 `mainComponent` 是否真的切换，未生效时返回 `warning`（不静默成功）|
| `FRAME` / `GROUP` / `RECTANGLE` / `ELLIPSE` / `TEXT` / `POLYGON` / `STAR` / `LINE` / `PEN` / `VECTOR` / `BOOLEAN_OPERATION` | **原位替换**为组件实例 | `parent.insertChild(原 index)` 保持父容器与图层顺序；继承 `x/y`、宽高（默认保持，不破坏布局占位）与 `rotation`；按图层名把原内容的**文字 / 文字色 / 可见性**带到实例对应子图层；默认删除原对象 |
| `COMPONENT` / `COMPONENT_SET` | 拒绝 | 会破坏引用中的实例，需直接修改组件内容 |

### 目标组件（三选一，优先级从高到低）

| 参数 | 说明 |
|------|------|
| `componentId` | 当前文档内 COMPONENT / COMPONENT_SET 的 id（`component_list` / `component_search` 获取）|
| `ukey` | 团队库组件 ukey（`team_component_search` 获取），自动 `importComponentByKeyAsync` 导入当前文档 |
| `component` (+ `library`) | 组件名：先在当前文档按精确 / 归一化 / 包含匹配，找不到再按「库名 + 组件名」解析团队库 |

组件集（`COMPONENT_SET`）自动落到 `variant` 指定变体或第一个变体；`variantProperties` 在替换后写入（`setVariantPropertyValues`）。

### 常用参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `nodeId` / `nodeIds` | — | 目标对象；两者都不传时回退**当前选区**；`useSelection: false` 可禁用回退 |
| `keepSize` | 实例 `false` / 非实例 `true` | 是否保持替换前的宽高 |
| `keepOriginal` | `false` | 非实例替换时保留原对象（留在实例旁，便于对比/回退）|
| `carryOverOverrides` | `true` | 非实例替换时按图层名继承文字 / 文字色 / 可见性 |
| `resetOverrides` | `false` | 换主组件后清空实例上的直接覆写 |
| `properties` | — | 替换后写组件属性（键为属性 id），用于 `INSTANCE_SWAP` 插槽换组件 |
| `overrides` | — | 按**子图层名**覆写子层：`{ "Label": { "text": "确定", "fill": "#FF0066", "visible": "true" } }`；`fill` 只接受 `#RGB` / `#RRGGBB`，其它形式（`rgba(...)` / 具名色）被拒绝并计入降级上报，不做颜色猜测 |
| `name` | 原对象名 | 替换出的实例名称 |

### 返回结构与错误语义

`{ success, summary, target, total, swapped, replaced, skipped, failed, results[], warnings?, hint }`

- 每个 result 带 `mode: 'swap' | 'replace'`、`mainComponentId` / `mainComponentName`、`removedOriginal`、`carriedOverrides`、`verified`（实例模式）
- **全部失败时抛错**（MCP 侧需要硬错误）；部分失败以 `failed` + `results[].error` 报告，不会静默；已相同的实例计入 `skipped`
- 原对象带子图层被一并删除时进 `warnings`，并说明哪些内容已按名称带过（没同名子图层也会明说）

### HTML 用法（`code_to_design` / `dsl/render`）

属性表见上节「团队组件库（团队库）引用」，等价写法：

```html
<!-- 实例换主组件 + 保持宽高；非实例对象则触发原位替换 -->
<div data-swap-node-id="1:2" data-swap-component="库名/按钮" data-swap-variant="Hover" data-swap-keep-size="true"></div>

<!-- 批量 + 保留原对象 -->
<div data-swap-node-id="1:2,3:4" data-swap-ukey="ukey:xxx" data-swap-keep-original="true"></div>
```

纯换组件 HTML **不产生新节点**（不会多出根 frame），响应 `rootNodeIds` 为空属于正常。

---

## 设计分析与修改

| 工具 | 描述 | 参数 |
|------|------|------|
| `design_describe` | 获取当前节点结构的轻量摘要（非完整 DSL，比 DSL 小 60-80%），包含节点树和关键样式信息。AI 先用此工具了解结构，再分解修改指令 | `nodeId`: string, `depth?`: number（默认 3）, `includeStyle?`: boolean（默认 false，置 true 才附带颜色/字体等样式摘要） |
| `design_suggest` | 用自然语言指令修改设计：单体传 `instruction`，批量传 `instructions` 数组（合并成一个工具，不再有 `design_suggest_batch`）。支持 25 类原子指令，目录见下节。**复杂主观指令（"优化排版"）必须先经 AI 用 `design_describe` 看结构后自行拆解成原子指令，不要直接传入。** | `nodeId`: string, `instruction?`: string, `instructions?`: string[], `autoApply?`: boolean（默认 false，仅返回建议） |
| `design_review` | 对指定节点做设计自检：结构启发式（命名/字号/空容器/阴影裁剪）+ **可访问性硬指标**（WCAG 对比度 4.5:1 / 大字号 3:1、`_Focus` 成员 ≥2px 描边、交互元素点击区 <32 error / 32–44 warning）。兼容两宿主 describe 形态（MasterGo `{tree}` / Penpot `{nodes}`）；返回 `issues`（带 rule/path/evidence）与 `a11y.skipped`（取不到色/尺寸的项，不谎报）。 | `nodeId`: string, `depth?`: number（默认 3） |

### `design_suggest` 引擎支持范围（25 类原子指令）

引擎是**规则匹配器**，不做自然语言理解：AI 必须用自身的 LLM 把复杂意图（"优化排版"）拆成下表里的原子指令，一条指令尽量只含一个属性。复合指令（一行里写多个属性）也能匹配，但仍建议先拆开。

| # | 属性类别 | 可用说法示例 |
|---|---------|-------------|
| 1 | 颜色 | `改成蓝色` / `深蓝` / `浅蓝` / `红色` / `品牌色` / `透明`、`描边红色`、`改成渐变蓝紫` |
| 2 | 间距 | `间距16` / `加大` / `减小` |
| 3 | 内边距 | `右边内边距加大` / `内边距24` / `顶部边距16` |
| 4 | 对齐 | `居中对齐` / `左` / `右` / `分散` / `两端对齐` |
| 4b | **对象之间**对齐/分布 | `把这三个对象左对齐` / `选中的对象水平居中` / `这几个图层等距分布`（**多对象标记**触发；Penpot 走 `alignHorizontal/Vertical`、`distribute*`，与 4 的容器语义不同） |
| 5 | 交叉轴对齐 | `垂直居中` / `顶部` / `底部` / `拉伸` |
| 6 | 字号 | `字号20` / `加大` |
| 7 | 字重 | `加粗` / `字重600` / `300` |
| 8 | 字体 | `字体苹方` / `思源黑体` / `Inter` |
| 9 | 行高 | `行高28` / `加大` |
| 10 | 字间距 | `字间距2` / `加大` |
| 11 | 段落间距 | `段落间距16` |
| 12 | 宽高 | `宽度800` / `高度500` / `加宽到400` |
| 13 | 圆角 | `圆角8` / `加大` / `圆点` |
| 14 | 阴影 | `加阴影` / `去阴影` |
| 15 | 模糊 | `模糊4` / `毛玻璃` / `背景模糊16` |
| 16 | 透明度 | `透明度50` |
| 17 | 布局方向 | `横向` / `纵向` |
| 18 | 换行 | `允许换行` / `不换行` |
| 19 | 旋转 | `旋转45` |
| 20 | 锁定 | `锁定` / `解锁` |
| 21 | 隐藏/显示 | （开关类，无需数值） |
| 22 | 裁剪 | `裁剪溢出` |
| 23 | 内阴影 | （与阴影同类，只作用于内侧） |
| 24 | 主题 | `暗色主题` / `亮色主题` / `轻量主题` |
| 25 | 品牌风格 | `苹果风` |

- **批量路径**：`instructions` 数组里每条独立匹配（与单体同套 25 类规则），合并全部命中属性后一次性应用，比逐条调用更高效。
- **`unmatched`** 是**未被引擎匹配**的指令原文列表（单体与批量都返回）：说明措辞不在上表覆盖范围内，AI 应改写为更接近上表的原子说法后重试，而不是原样重复提交。

### 设计修改工作流

详见 SKILL.md §自然语言设计修改混合工作流，核心原则：

1. **AI 侧负责理解** — MCP Server 不调用 LLM，所有自然语言理解由 AI Agent 自身的 LLM 完成
2. **规则引擎负责执行** — 属性验证、值范围、类型安全，零幻觉
3. **`design_describe` 先行** — 在修改前先获取结构摘要，AI 了解上下文后再拆解指令
4. **批量提交减少 roundtrip** — 分解后的多条原子指令放进 `design_suggest` 的 `instructions` 一次提交

## 会话管理（多文档切换）

| 工具 | 描述 | 参数 |
|------|------|------|
| `session_list` | 列出当前所有已连接的插件会话。每个会话对应一个打开的设计文档。返回 sessionId、codename（代号）、文档名、文档 ID、页面名、页面 ID、连接时间。在生成新设计前应先调用此工具了解可用文档。AI 可通过 codename 快速辨识目标会话。 | 无参数 |
| `session_switch` | 切换当前 AI 客户端的目标插件会话。指定目标后，后续的所有工具调用自动路由到该会话对应的文档。调用方式分两种：**全局切换**（用 `session_switch` 改变后续所有调用）和 **单次路由**（在工具参数中加 `_sessionId`）。 | `clientId?`: number, `codename?`: string, `sessionId?`: string |

### `session_switch` 的三种定位方式

| 参数 | 精度 | 说明 |
|------|------|------|
| `clientId`（number） | 最高（推荐） | 目标客户端 ID，来自 `session_list` 返回体。同一文档开着多个插件实例时**唯一** |
| `codename`（string） | 中 | 插件代号（如 `Nova` / `Pixel`），来自 `session_list` 返回体；由插件 UI 设置，**不保证全局唯一**，命中第一个匹配项 |
| `sessionId`（string） | 最低 | 目标会话 ID；**同一文档的多个插件实例 `sessionId` 相同**，需要精确定位时改用 `clientId` |

### 会话管理使用方式

**方式 A：全局切换（session_switch）**
```
session_list  →  查看可用文档列表
session_switch({ sessionId: "sess_doc1" })  →  切换到文档 A
code_to_design(...)  →  路由到文档 A（自动）
node_create(...)  →  路由到文档 A（自动）
session_switch({ sessionId: "sess_doc2" })  →  切换到文档 B
code_to_design(...)  →  路由到文档 B（自动）
```

**方式 B：单次路由（_sessionId）**
```
# 不改变全局 session，仅本次调用路由到指定文档
node_create({ type: "rectangle", _sessionId: "sess_doc2", ... })
  → 本次调用路由到文档 B，后续调用仍指向文档 A
```

### 多会话典型工作流

```
【发现】session_list
  → [{ sessionId: "sess_xxx", codename: "Nova", documentName: "首页设计" },
     { sessionId: "sess_yyy", codename: "Pixel", documentName: "后台管理" }]
【快捷呼叫】"让 Nova 画个渐变圆" → AI 解析 codename Nova → 自动路由
【切换】session_switch({ sessionId: "sess_xxx" })
  → 目标: 首页设计 (代号: Nova)
【操作】code_to_design(html: "...")  → 渲染到 Nova 的文档
【切换】session_switch({ sessionId: "sess_yyy" })
  → 目标: 后台管理 (代号: Pixel)
【操作】search_nodes, node_create 等 → 渲染到 Pixel 的文档
```

### 注意事项

1. `session_list` 只显示已初始化并连接好的插件实例，未初始化或已关闭的不会列出
2. `session_switch` 仅改变当前 AI 客户端的路由目标，不影响其他客户端
3. `_sessionId` 参数仅对本次工具调用有效，不会持久化到 AI 客户端的全局 session
4. 如果切换到的 sessionId 对应的插件已断开，工具调用会返回错误提示
5. 首次连接时默认使用第一个可用插件（向后兼容），无需显式切换
6. **代号可自定义**：插件 UI 的紫色代号徽章可点击 → 输入新名 → 自动保存到 `mg.clientStorage` 并推送到服务端。AI 用代号直接呼叫（如"让 Nova 画个圆"），比手动切换更自然

## 样式管理

| 工具 | 描述 | 参数 |
|------|------|------|
| `style_list_colors` | 列出当前文档中的所有颜色样式（Paint Style），返回样式 id、名称、色值、透明度、paints 原始数据。适用于查看和管理设计系统中的颜色令牌。 | 无参数 |
| `style_list_text` | 列出当前文档中的所有文本样式（Text Style），返回样式 id、名称、字体、字号、字重、行高、字间距。适用于查看设计系统的排版规范。 | 无参数 |
| `style_apply` | 将指定样式应用到画布上的节点。支持 fill（填充颜色）、stroke（描边颜色）、text（文本样式）三种类型。调用前先用 `style_list_colors` / `style_list_text` 获取样式的 id。 | `nodeId`: string, `styleId`: string, `styleType`: "fill" \| "stroke" \| "text" |

### 样式管理工作流

```
【查询】style_list_colors / style_list_text
  → 获取所有样式的 ID 和名称
【搜索目标】search_nodes({ types: ["FRAME"], name: { value: "DS_", matchType: "startsWith" } })
  → 定位要应用样式的节点
【应用】style_apply(nodeId, styleId, "fill")
  └→ 可批量应用：对多个 nodeId 逐个调用
```

**典型场景：**
1. **设计系统样式一致性检查**：`style_list_colors` 列出所有注册的颜色样式，对比 Token 面板确认颜色准确
2. **快速应用品牌色**：找到 `Brand Text` 样式后，`style_apply` 应用到所有选中的文本或形状节点
3. **排版统一**：`style_list_text` 查看字号阶，将 `H1` 文本样式应用到所有标题节点

### 最佳实践

1. **先获取选中对象**：操作前先调用 `selection_get` 获取当前选中对象
2. **错误处理**：处理可能的错误响应，如节点不存在、连接断开等
3. **批量操作**：创建多个节点时，用 `node_create` 的 `nodes` 数组一次提交（同一把撤销栈）
4. **效果激活检查**：设置 `effects` 后，用 `dsl_export_selection` 导出确认 `isEffectShow` 是否为 `true`，否则效果可能不显示
5. **自然语言设计修改工作流**：收到复杂主观指令（"优化排版"）时，先 `design_describe` 获取结构，再用自身 LLM 拆解为原子指令，最后放进 `design_suggest` 的 `instructions` 批量提交。不要直接将主观意图传给规则引擎
