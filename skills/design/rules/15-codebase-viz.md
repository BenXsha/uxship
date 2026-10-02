# 代码库可视化工作流

## 概述

将任意代码库（TypeScript/JavaScript/Python/Java/Rust 等）的业务逻辑和架构结构，通过 HTML+Tailwind 模板渲染为设计画布上的可读图表。

## 什么时候用

| 场景 | 适用图表 | 不适用 |
|------|---------|-------|
| 理解新项目的模块划分 | 架构图 | 项目只有一个文件的 |
| 梳理业务流程 | 流程图 | 纯工具库无业务状态的 |
| 重构前的依赖梳理 | 架构图 + 依赖关系 | 全部代码在单文件中的 |
| 评审 PR 的代码结构变更 | 流程图 | 纯样式/配置变更 |

## 工作流

```
步骤1: 了解项目结构
  ├─ 使用 `codebase_get_structure` 工具扫描目录（推荐）
  │   返回: 语言、框架、模块树、入口文件、配置文件摘要
  │   AI 据此决定流程图层级和架构图分层
  ├─ 备用: 读取目录树（ls 或 Glob 工具）+ 读取配置文件
  └─ 识别语言框架和模块边界

步骤2: 读取关键文件
  ├─ 入口文件 → 识别路由/控制器
  ├─ Service/Service 层 → 识别业务逻辑函数
  ├─ 数据模型 → 识别实体关系
  └─ 工具/工具函数 → 识别公共能力

步骤3: 设计图表布局
  ├─ 决定图表类型
  │   ├─ 架构图：分层展示模块归属，适合整体结构
  │   └─ 流程图：展示业务逻辑流转，适合具体流程
  ├─ 计算节点坐标（见下文「布局计算」）
  └─ 选择模板参考

步骤4: 生成 HTML → code_to_design
  ├─ 打开模板文件了解元素模式
  ├─ 生成填充了实际内容的 HTML
  └─ 调用 code_to_design 渲染到画布
```

## 布局计算

### 流程图节点坐标算法

流程图使用绝对定位，AI 手动计算每个节点的 (x, y)。

**标准尺寸**：

| 节点类型 | 宽(W) | 高(H) | 样式 |
|---------|-------|-------|------|
| 开始/结束 | 160px | 44px | 圆角圆形 `rounded-[22px]` 深色背景 |
| 处理步骤 | 180px | 52px | 圆角 `rounded-[6px]` 白底边框 |
| 判断/决策 | 100px | 100px | 菱形 `rotate-45` + 文本 `-rotate-45` |
| 输入/输出 | 160px | 44px | 平行四边形 `skewX(-15deg)` |
| 子流程 | 180px | 52px | 双边线 `border-left-width:4px; border-right-width:4px` |

**间距公式**（自上而下布局）：

```
节点Y = 前节点Y + 前节点H + 纵向间隔(80px)
节点X = (容器宽 - 节点W) / 2   // 居中
```

**分支布局**（判断节点后有两个分支）：

```
主路径: 继续垂直向下
分支路径: 从判断节点向左/右水平延伸 200px 后垂直向下

分支起始点:
  - 判断节点菱形中心: (X_决策 + 50, Y_决策 + 50)
  - 左分支: 从菱形左顶点(X_决策, Y_决策+50)水平向左
  - 右分支: 从菱形右顶点(X_决策+100, Y_决策+50)水平向右
  - 下（主）分支: 从菱形下顶点(X_决策+50, Y_决策+100)垂直向下
```

### 架构图布局

架构图推荐使用 `flex-col` + `flex-row` 自动布局，配合 `flex-1` 均分空间，不需要手动计算坐标。

**层高度参考**：

| 层 | 模块高 | 标签色 |
|----|-------|-------|
| 外部 | 80px | 灰 `#9CA3AF` |
| 表现层 | 100px | 蓝 `#4A90D9` |
| 应用层 | 100px | 绿 `#7ED321` |
| 领域层 | 90px | 橙 `#F5A623` |
| 基础设施 | 90px | 紫 `#9B59B6` |

### 依赖关系连线算法

适合绝对定位的独立区域，使用 `flex-row` + 固定宽度模块 + 箭头：

```
[模块A] ───▶ [模块B]

线: 模块A右边 → 模块B左边
  线宽: 60px
  箭头尖: 线末端 - 7px (margin-left)
```

## 箭头系统：SVG Marker（推荐）

箭头使用 SVG `<line>` + `<marker>` 实现，由 `svg-extractor.ts` 自动解析为原生 MasterGo 箭头（`strokeCap: TRIANGLE_ARROW`），是标准三角形箭头，非 div 模拟。

### 定义箭头模板

在 SVG `<defs>` 中定义箭头，可多次引用：

```html
<svg class="absolute overflow-visible"
     style="left:0;top:0;width:1200px;height:900px;pointer-events:none;"
     data-name="arrow-layer">
  <defs>
    <marker id="arrow-gray" markerWidth="10" markerHeight="8"
            refX="9" refY="4" orient="auto">
      <path d="M 0 0 L 10 4 L 0 8 Z" fill="#9CA3AF" />
    </marker>
  </defs>
  <!-- 垂直向下箭头 -->
  <line x1="600" y1="124" x2="600" y2="176"
        stroke="#9CA3AF" stroke-width="2"
        marker-end="url(#arrow-gray)" data-name="arrow-1" />
</svg>
```

**关键属性说明**：
- `markerWidth/Height`：箭头视口大小
- `refX/refY`：箭头与线末端的对齐点（一般 refX=线长略留间距）
- `orient="auto"`：箭头自动旋转适应线方向
- `<path d="M 0 0 L 10 4 L 0 8 Z">`：填充三角形 → `TRIANGLE_ARROW`
- `<path d="M 0 0 L 10 4 L 0 0">`：V 形开放路径 → `LINE_ARROW`

### 垂直箭头坐标计算

```
从节点A底部中心指向节点B顶部中心

x1 = x2 = XA + WA/2
y1 = YA + HA
y2 = YB

line 属性:
  x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"
  marker-end="url(#arrow-xxx)"
```

### 水平箭头坐标计算

```
从节点A右边中心指向节点B左边中心

x1 = XA + WA
y1 = y2 = YA + HA/2
x2 = XB

line 属性:
  x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"
  marker-end="url(#arrow-xxx)"
```

### 箭头标签

在箭头上加文本标记，用于判断分支说明：

```html
<section class="absolute" style="left:420px; top:343px;" data-name="arrow-label">
  <p class="text-[11px] text-[#F5A623] leading-[16px]">不通过</p>
</section>
```

## 模板参考

使用前先读取以下模板文件了解元素模式：

| 模板 | 路径 | 用途 |
|------|------|------|
| 流程图 | `templates/flowchart.html` | 业务逻辑/调用链流程图 |
| 架构图 | `templates/architecture.html` | 系统分层/模块依赖架构图 |
| 设计系统 | `templates/design-system.html` | 设计令牌参考页（配色参考） |

## 颜色约定

### 流程图

| 元素 | 颜色 |
|------|------|
| 开始/结束 | `#333333` 深色背景 |
| 处理节点边框 | `#4A90D9` 蓝色 |
| 判断/决策 | `#F5A623` 橙色 |
| 输入/输出 | `#7ED321` 绿色 |
| 子流程 | `#4A90D9` 蓝色双层边框 |
| 箭头线 | `#9CA3AF` 灰色 |
| 分支标签标注 | `#F5A623` 或 `#4A90D9` |

### 架构图

| 层 | 主色 | 浅底色 | 深色文字 |
|----|------|--------|---------|
| 表现层 | `#4A90D9` | `#EBF4FF` | `#2C5F8A` |
| 应用层 | `#7ED321` | `#F0F9EB` | `#4A7A2E` |
| 领域层 | `#F5A623` | `#FFF8EB` | `#8C6A1A` |
| 基础设施 | `#9B59B6` | `#F4ECF7` | `#6B3A8A` |
| 外部 | `#9CA3AF` | `#F3F4F6` | `#666666` |

## 代码分析指引

### TypeScript/JavaScript 项目

分析路径：

```
package.json   → 识别框架 (React/Vue/Express)
src/
├─ pages/      → 页面/路由
├─ components/ → UI 组件
├─ hooks/      → 逻辑复用
├─ services/   → API 调用
├─ stores/     → 状态管理
├─ utils/      → 工具函数
└─ types/      → 类型定义
```

**流程图适用**：服务层函数调用链（如 下单流程 → 扣库存 → 发通知）
**架构图适用**：模块分层 + 依赖关系

### Python 项目

分析路径：

```
pyproject.toml / setup.py → 识别框架 (FastAPI/Django/Flask)
src/
├─ main.py        → 入口/路由
├─ routers/        → API 路由
├─ services/       → 业务逻辑
├─ models/         → 数据模型
├─ repository/     → 数据访问
└─ utils/          → 工具函数
```

### 流程图 vs 架构图选择

**流程图** 适合：
- 函数/函数调用链
- 请求处理链路
- 状态机变换
- Pipeline 处理步骤
- 用户操作 → 系统响应流程

**架构图** 适合：
- 模块/包依赖关系
- 分层架构（Clean/DDD/Layered）
- 微服务拓扑
- 数据流（数据源 → 处理 → 存储 → 展示）

**同时需要两者**：先画架构图展示大的模块划分，再用流程图聚焦关键模块的内部流转。

## 质量标准

### 布局规则
- 流程图节点之间纵向间隔至少 60px，推荐 80px
- 流程图节点之间横向间隔至少 40px，推荐 60px
- 架构图层之间间隔至少 16px
- 所有元素必须有 `data-name` 属性
- 所有 `<p>` 必须有 `leading-[Npx]` 匹配字号

### 自检清单

渲染到画布后，用 `design_describe` / `design_review` 检查：

- [ ] 所有节点是否在合理范围内（无重叠或超出画板）
- [ ] 连线精准性：箭头尖是否对准目标节点边缘
- [ ] 文本是否完整显示（无截断）
- [ ] 颜色对比度是否可读
- [ ] data-name 是否清晰标识了节点含义

## 已知限制

1. **箭头自动对齐** — SVG `<line>` 的 `x1/y1/x2/y2` 是指向像素级坐标，浏览器渲染与 MasterGo 有 ±1px 误差，不影响可读性
2. **无自动路由** — 连线不会自动绕开障碍物，需要 AI 手动规划方向
3. **无嵌套缩放** — 复杂图建议拆分为多个子图（如 `[主流程]` + `[子流程详情]`）
4. **Connector DSL 类型** — 支持 `type: 'connector'` DSL 元素的渲染和导出，可绑定节点移动跟随。AI 可手写 DSL 使用 connector 代替 SVG 箭头，支持 `ELBOWED`（折线）和 `CURVED`（曲线）连线类型

## DSL Connector 用法（进阶）

当需要**节点绑定**（连线随节点移动）或**折线/曲线**连线时，直接用 DSL connector 元素：

```json
{
  "type": "connector",
  "name": "流程连线",
  "connectorStart": { "endpointNodeId": "Node:123", "magnet": "BOTTOM" },
  "connectorEnd": { "endpointNodeId": "Node:456", "magnet": "TOP" },
  "connectorLineType": "ELBOWED",
  "connectorEndStrokeCap": "ARROW_EQUILATERAL",
  "strokes": [{ "type": "solid", "color": "#9CA3AF" }],
  "strokeWidth": 2
}
```

注意：connector 不能通过 HTML 模板渲染，必须由 AI 生成 DSL 后直接通过 `dsl_export_node`/`dsl_export_selection` 或后续的自动布局工具使用。流程图初期推荐 SVG marker 方式。
