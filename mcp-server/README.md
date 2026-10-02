# uxship MCP Server

通过 MCP (Model Context Protocol) 协议连接 AI Agent 与设计工具画布的服务器（MasterGo / Penpot 双宿主）。支持 STDIO 和 HTTP/SSE 两种运行模式，**推荐使用 HTTP/SSE 模式以保持稳定的插件连接**。

---

## 变更记录

> 当前版本 **v3.0.0**。历史变更记录不随本包分发。

### v1.2.0

**重构**
- 提取共享 `local-tools.ts` — 所有本地工具（code/validate/dsl/icon）统一实现，STDIO 和 HTTP 路径共用
- 移除 mcp-handler.ts 中 450+ 行死代码（插件工具处理器已被 ws-bridge 拦截，不经过 mcp-handler）
- 提取共享 `killPort()` 到 `utils/process.ts`，消除 ws-bridge 和 http-server 间的重复

**新增**
- `code_to_design` — HTML+Tailwind 一键渲染到画布的推荐入口
- `task_plan` / `task_step` / `task_complete` — 任务进度通知工具
- `node_convert_to_component` — 将节点转换为组件 Master
- `component_render` — 23 种高阶组件渲染
- `search_nodes` — 强大的节点搜索工具（名称/类型/颜色/阴影/尺寸）

**修复**
- `logToFile`: 单例 WriteStream 替代每次打开新文件描述符
- Console 拦截：`Error` 对象正确输出 name+stack，不再被 `JSON.stringify` 吞掉
- WebSocket 心跳：`clearInterval` 同时挂挂载到 `close` 和 `error` 事件
- `findPendingRequest`: 消除每次查询的对象分配

### v1.1.0

- 新增 `node_batchCreate`, `node_batchUpdate`, `node_batchDelete`, `node_group`, `node_boolean`
- 新增 `dsl_spec`, `dsl_export_node`, `dsl_render`
- STDIO 模式下工具名自动转换（下划线 -> 斜杠）
- 修复 STDIO 模式响应匹配问题
- 优化错误处理和日志输出

---

## 架构说明

```
AI IDE (Trae, Claude Code, Cursor)     MCP Server (后台运行)      MasterGo 插件
         │                                    │                        │
         │── HTTP/SSE ─────────────────────►  │                        │
         │                                    │── WebSocket ─────────► │
         │                                    │                        │ (执行操作)
         │                                    │◄── WebSocket Response ─│
         │◄── HTTP/SSE Response ────────────  │                        │
         │                                    │                        │
```

**为什么推荐 HTTP/SSE 模式？**

| 模式 | Server 生命周期 | WebSocket 稳定性 | 适用场景 |
|------|----------------|------------------|---------|
| **HTTP/SSE** | 后台持续运行 | ✅ 稳定，插件连接持久 | **推荐**：设计工作流 |
| STDIO | 随 AI IDE 会话启动/退出 | ❌ 不稳定，会话结束即断开 | 仅用于临时测试 |

**关键原因**：
- MasterGo 插件通过 WebSocket（端口 15489）与 Server 保持长连接
- STDIO 模式下，Server 作为 AI IDE 子进程运行，会话结束时 Server 退出，WebSocket 断开
- HTTP/SSE 模式下，Server 在后台独立运行，不受 AI IDE 会话影响，插件连接稳定

**消息链路闭环**：
1. AI IDE 通过 HTTP/SSE 发送 JSON-RPC 请求到 MCP Server
2. 本地工具（code_to_design、icon_search 等）服务器端直接执行
3. 插件工具通过 WebSocket 转发给 MasterGo 插件
4. MasterGo 插件执行操作后返回结果
5. Server 通过 `requestKey` 匹配等待中的 Promise，将结果返回

**任务进度通知**：
- `task_plan` / `task_step` / `task_complete` 通过 JSON-RPC Notification（无 id）发送到插件端
- 插件端显示任务步骤列表和实时进度

---

## 多后端（MasterGo + Penpot）

同一个 Server 同时托管两个插件桥，因为两个插件讲的是同一套 JSON-RPC 协议。
**默认共联单 hub**：一个端口接两种插件，按 `initialize` 自述的后端分区：

```
                                           ┌─ sess_penpot_* → plugin-penpot (Penpot)
AI IDE ──HTTP/SSE/MCP──► BridgeRouter ──ws 15489 ─┤
                                           └─ sess_*        → plugin-mastergo   (MasterGo)
```

**路由依据是会话 id 前缀**（所以不需要任何新的路由参数）：

| 场景 | 结果 |
|------|------|
| `session_list` | 同时列出两端，每项带 `backend` 字段 |
| `session_switch({ sessionId })` | 按前缀自动选对后端 |
| 单次调用 `_sessionId: 'sess_penpot_xxx'` | 只走 Penpot |
| 不传会话 + 只有一个后端在线 | 自动选中在线的那个（**按后端各自计数**） |
| 不传会话 + 两个都在线 | 回落 **mastergo**（保持历史行为，不会随机挑） |
| 客户端**没自述**后端 | 共联模式下**不收编**（宁可让面板显示「未归属」，也不猜） |
| 客户端自述了**别的**后端 | 一律拒收 + 服务端告警（含端口指引） |

> 共联的代价就是「归属靠自述」，所以两条边界都做成 fail-closed。
> `initialize` 的响应会回传 `serverInfo.{backend, attributed, acceptedBackends}`，
> 插件面板据此区分「未归属」与「归属错」—— 避免正常连接被误报。

**配置**：

```bash
# 默认：共联单 hub（15489 同时接两种插件）
UXSHIP_PENPOT_DISABLE=1             # 完全不接 Penpot 客户端
UXSHIP_MCP_DEFAULT_BACKEND=penpot   # 无显式会话时默认落 penpot

# 可选：分端口（端口即后端判别，排障时两条链互不干扰）
UXSHIP_MCP_SEPARATE_PORTS=1 PENPOT_WS_PORT=4404 node dist/index.js
# 或：node dist/index.js --penpot-ws-port 4404
```

Penpot 插件在分端口模式下需用 `PENPOT_HUB_URL=ws://localhost:4404` 重新构建。

**Penpot 侧一次性准备**（详见 `plugin-penpot/README.md`）：

```bash
cd plugin-penpot && yarn install && yarn start   # 构建并在 4405 提供插件站点
```
然后在 Penpot 里 Plugins 菜单填 `http://127.0.0.1:4405/manifest.json`，打开面板点「连接 MCP 服务端」
（默认连 `ws://localhost:15489`，与 MasterGo 同一个端口）。

> 插件站点端口默认 **4405** 而非 4400：Penpot 官方 MCP 占用 4400–4403，同号无法共存。
> 想沿用旧 URL 可 `node scripts/serve.mjs --port 4400`。

**端到端自检**（手动、会占端口 15498/15499/4404）：

```bash
npm run build && npm run test:e2e:penpot
```

---

## 安装

### 安装

从仓库源码构建安装（见项目根 `README.md` 的「快速开始」章节）。

---

## 使用方法

### ⭐ HTTP/SSE 模式（推荐）

**步骤 1：后台启动 MCP Server**

```bash
# 默认端口（HTTP: 15490, WebSocket: 15489）
mcp-server

# 或使用 nohup 后台运行
nohup mcp-server > /tmp/mcp-server.log 2>&1 &

# 自定义端口
mcp-server --http-port 9000 --ws-port 9001
```

**步骤 2：配置 AI IDE 使用 SSE 连接**

在 MCP 配置文件中使用 `url` 字段连接到已运行的 Server：

```json
{
  "mcpServers": {
    "uxship": {
      "url": "http://localhost:15490/sse"
    }
  }
}
```

**步骤 3：在 MasterGo 中加载插件**

- 打开 MasterGo
- 加载 `plugin-mastergo` 插件
- 插件会自动通过 WebSocket 连接到 `localhost:15489`

**步骤 4：验证连接**

```bash
curl http://localhost:15490/health
```
返回 `pluginConnected: true` 表示插件已连接成功。

### STDIO 模式（仅用于临时测试）

⚠️ **注意**：STDIO 模式下，Server 会随 AI IDE 会话结束而退出，导致插件 WebSocket 连接断开。仅适合临时测试，不推荐用于实际设计工作。

```bash
mcp-server --stdio
```

---

## MCP 客户端配置

### ⭐ 推荐：HTTP/SSE 模式

**Trae / Claude Code / Cursor / Windsurf**

```json
{
  "mcpServers": {
    "uxship": {
      "url": "http://localhost:15490/sse"
    }
  }
}
```

配置文件位置：
- **Trae**: `~/Library/Application Support/Trae CN/User/mcp.json`
- **Claude Code**: `~/.claude/mcp.json`
- **Cursor**: `~/.cursor/mcp.json`
- **Windsurf**: `~/.windsurf/mcp.json`

**使用前提**：
1. 先在后台启动 MCP Server：`mcp-server`
2. Server 会持续运行，等待 AI IDE 通过 SSE 连接
3. MasterGo 插件连接到 WebSocket 端口（15489）

### STDIO 模式（不推荐）

```json
{
  "mcpServers": {
    "uxship": {
      "command": "mcp-server",
      "args": ["--stdio"]
    }
  }
}
```

⚠️ **局限性**：
- Server 作为 AI IDE 子进程，会话结束时退出
- 插件 WebSocket 连接会随 Server 退出而断开
- 每次新会话需要重新建立连接

---

## 可用工具完整列表（17个）

> 下列工具在 MasterGo / Penpot 两个后端上**同名可用**（能力差异由 `plugin_capabilities` 报告）；
> Penpot 侧尚未映射的能力会以 `report.skipped` / `available:false` 如实返回。

### 本地工具（服务器端执行，无需插件连接）

#### 代码转换
| 工具名 | 描述 | 输入 | 输出 |
|--------|------|------|------|
| `code_to_design` | ⭐ HTML+Tailwind 一键渲染到画布（推荐路径） | `filePath` 或 `html` | 自动完成：读取/转换/渲染 |
| `design_to_code` | DSL 转 HTML+Tailwind | `dsl: object` | `{ html, warnings, stats }` |
| `icon_search` | 搜索 Iconify 图标库（20万+） | `query: string`, `limit?: number`, `prefix?: string` | `{ total, icons, collections }` |
| `icon_render` | 从 Iconify API 获取图标并渲染到画布 | `name, x, y, size, color, bgColor` | `{ iconName, svgPathData, dsl }` |

### 插件工具（需 MasterGo 插件连接）

#### 设计上下文
| 工具名 | 描述 |
|--------|------|
| `document_getInfo` | 获取当前文档基本信息 |
| `selection_get` | 获取当前选中的节点 |
| `node_get` | 获取节点详情 |
| `search_nodes` | 搜索节点（名称/类型/颜色/阴影/尺寸） |

#### 节点操作
| 工具名 | 描述 |
|--------|------|
| `node_create` | 创建节点（单体 `type`+`properties`，或 `nodes[]` 批量）|
| `node_update` | 更新节点属性（单体 `nodeId`+`properties`，或 `updates[]` 批量）|
| `node_delete` | 删除节点（单体 `nodeId`，或 `nodeIds[]` 批量）|
| `node_convert_to_component` | 将节点转换为组件 Master |

#### DSL 操作
| 工具名 | 描述 |
|--------|------|
| `dsl_export_selection` | 导出选中节点为 DSL |
| `dsl_export_node` | 导出指定节点为 DSL |
| `design_to_code` | DSL 转 HTML+Tailwind |

#### 高阶组件
| 工具名 | 描述 |
|--------|------|
| `component_render` | 渲染 23 种高阶组件（button/badge/modal/tabs 等） |

#### 团队组件库（需插件 API 支持）
| 工具名 | 描述 |
|--------|------|
| `team_library_list` | 列出团队库与库内组件/样式（读索引缓存） |
| `team_component_search` | 搜索团队组件并返回 ukey |
| `team_component_import` | 导入团队组件并创建实例到画布 |
| `team_style_list` | 列出团队样式令牌（颜色/文本/效果/间距…） |
| `team_style_import` | 导入团队样式并可应用到节点 |
| `team_library_sync` | 同步团队库索引到 `.uxship/team-library.json` |

#### 其他
| 工具名 | 描述 |
|--------|------|
| `notify` | 显示通知消息 |
| `task_plan` | 发送任务计划到插件端 |
| `task_step` | 更新任务步骤状态 |
| `task_complete` | 标记任务完成 |

---

## 工具详解

### code_to_design（推荐）

从 HTML+Tailwind 到设计画布的**唯一推荐路径**。自动完成：
1. 读取 HTML 文件或接收 HTML 字符串
2. 解析 HTML + Tailwind 样式
3. 识别并获取图标资源（data-icon）
4. 转换为 DSL
5. 预取网络图片并转为 base64
6. 渲染到画布

```typescript
// 从文件渲染
code_to_design({ filePath: "/path/to/design.html" })

// 直接传 HTML 渲染
code_to_design({
  html: `<div class="flex p-4"><h1>Hello</h1></div>`
})
```

**支持特性**：
- section, div, p, span, i, svg, chart 标签
- flex 布局、absolute 定位
- Tailwind 样式（颜色、间距、圆角、阴影等）
- data-icon 属性自动解析为 SVG

### component_render

高阶组件渲染工具，支持 23 种组件类型：

| 类型 | 变体/选项 |
|------|----------|
| `checkbox-group` | 5种状态 |
| `radio-group` | 5种状态 |
| `button` | primary/secondary/outline/text |
| `text-input` | - |
| `badge` | default/success/warning/danger/info |
| `avatar` | 圆形头像 |
| `toggle` | 开关 |
| `select` | 下拉选择器 |
| `menu` | 菜单 |
| `tabs` | underline/pill |
| `progress` | 进度条 |
| `list` | 列表 |
| `slider` | 滑块 |
| `breadcrumb` | 面包屑 |
| `tooltip` | 提示 |
| `divider` | 分割线（horizontal/vertical） |
| `tag` | 标签 |
| `spinner` | 加载中 |
| `modal` | 模态框 |
| `alert` | 提示条 |
| `pagination` | 分页 |
| `steps` | 步骤条 |
| `accordion` | 手风琴 |

```typescript
component_render({
  type: "button",
  label: "提交",
  variant: "primary",
  position: { x: 100, y: 200 }
})
```

### search_nodes

强大的节点搜索工具，支持多种条件组合：

```typescript
// 按名称模糊搜索
search_nodes({
  name: { value: "button", matchType: "contains" }
})

// 按类型筛选
search_nodes({
  types: ["RECTANGLE", "FRAME"]
})

// 按颜色搜索（近似匹配）
search_nodes({
  colors: [{ type: "fill", color: "#FF0000", tolerance: 20 }]
})

// 组合条件
search_nodes({
  name: { value: "card", matchType: "contains" },
  hasShadow: true,
  minSize: { width: 100, height: 50 }
})
```

---

## HTTP 接口

#### 调用 MCP 工具

```bash
curl -X POST http://localhost:15490/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "selection_get",
      "arguments": {}
    }
  }'
```

#### 健康检查

```bash
curl http://localhost:15490/health
```

---

## 调试日志

日志文件位置：`/tmp/mcp-server.log`

```bash
# 实时查看
tail -f /tmp/mcp-server.log

# 筛选错误
grep ERROR /tmp/mcp-server.log
```

---

## 开机启动与服务管理

### 配置开机自动启动

#### macOS (launchd)

创建 `~/Library/LaunchAgents/com.uxship.mcp-server.plist` 文件：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.uxship.mcp-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/mcp-server</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mcp-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mcp-server.log</string>
    <key>WorkingDirectory</key>
    <string>/usr/local/lib/node_modules/mcp-server</string>
</dict>
</plist>
```

**加载并启用：**

```bash
# 加载配置
launchctl load ~/Library/LaunchAgents/com.uxship.mcp-server.plist

# 设置开机启动
launchctl enable gui/$(id -u)/com.uxship.mcp-server

# 启动服务
launchctl start com.uxship.mcp-server

# 停止服务
launchctl stop com.uxship.mcp-server

# 查看状态
launchctl list | grep mastergo
```

#### Linux (systemd)

创建 `/etc/systemd/system/mcp-server.service` 文件：

```ini
[Unit]
Description=uxship MCP Server
After=network.target

[Service]
Type=simple
User=your_username
ExecStart=/usr/local/bin/mcp-server
WorkingDirectory=/usr/local/lib/node_modules/mcp-server
Restart=always
RestartSec=5
StandardOutput=file:/var/log/mcp-server.log
StandardError=file:/var/log/mcp-server.log

[Install]
WantedBy=multi-user.target
```

**启用并启动：**

```bash
# 重新加载 systemd 配置
sudo systemctl daemon-reload

# 设置开机启动
sudo systemctl enable mcp-server

# 启动服务
sudo systemctl start mcp-server

# 查看状态
sudo systemctl status mcp-server

# 停止服务
sudo systemctl stop mcp-server

# 重启服务
sudo systemctl restart mcp-server
```

#### Windows (任务计划程序)

1. 打开「任务计划程序」
2. 点击「创建任务」
3. **常规**选项卡：
   - 名称：uxship MCP Server
   - 勾选「不管用户是否登录都要运行」
4. **触发器**选项卡：
   - 点击「新建」
   - 选择「启动时」
5. **操作**选项卡：
   - 点击「新建」
   - 操作：启动程序
   - 程序或脚本：`node`
   - 添加参数：`"C:\path\to\mcp-server\dist\index.js"`
   - 起始于：`C:\path\to\mcp-server`
6. **条件**选项卡：
   - 取消勾选「唤醒计算机运行此任务」
7. **设置**选项卡：
   - 勾选「允许任务按需运行」
   - 勾选「如果任务失败，重试次数」设置为 3
   - 勾选「如果任务运行时间超过」设置为 1 小时
8. 点击「确定」完成创建

### 重启服务器

#### 手动重启

```bash
# 查找并停止进程
pkill -f mcp-server

# 等待1秒确保进程退出
sleep 1

# 重新启动
mcp-server &
```

#### 使用端口检查重启

```bash
# 检查端口是否被占用
lsof -ti:15490 | xargs kill -9 2>/dev/null; true

# 启动服务器
nohup mcp-server > /tmp/mcp-server.log 2>&1 &

# 验证启动
sleep 2
curl http://localhost:15490/health
```

#### 热更新（零停机重启）

服务器支持通过信号实现热更新：

```bash
# 发送 SIGHUP 信号触发优雅重启
kill -SIGHUP $(pgrep -f mcp-server)

# 或使用 pkill
pkill -HUP -f mcp-server
```

### 服务状态管理

```bash
# 检查服务是否运行
curl -s http://localhost:15490/health | grep -q "pluginConnected" && echo "运行中" || echo "未运行"

# 检查端口占用
netstat -tlnp | grep 15490

# 查看进程
ps aux | grep mcp-server

# 查看日志
tail -f /tmp/mcp-server.log
```

---

## 注意事项

- **推荐使用 HTTP/SSE 模式**：先在后台启动 Server，再配置 AI IDE 通过 SSE 连接
- STDIO 模式仅适合临时测试，会随 AI IDE 会话结束而退出
- 确保先启动 MCP Server，再在 MasterGo 中加载插件
- 插件工具需要 MasterGo 插件处于连接状态，本地工具无需插件连接
- 请求超时时间为 30 秒
- 服务器启动时会自动清理占用端口的进程