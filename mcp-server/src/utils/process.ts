import { execFileSync } from 'child_process'

export interface PortOwner {
  pid: number
  command: string
}

/** 端口占用者（只取 LISTEN 状态） */
export function findPortOwners(port: number): PortOwner[] {
  let raw = ''
  try {
    raw = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch {
    return [] // 端口空闲或 lsof 不可用
  }
  if (!raw) return []

  const owners: PortOwner[] = []
  for (const pidStr of raw.split('\n').filter(Boolean)) {
    const pid = Number(pidStr)
    if (!Number.isFinite(pid)) continue
    let command = ''
    try {
      command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8', stdio: 'pipe' }).trim()
    } catch {
      command = '(unknown)'
    }
    owners.push({ pid, command })
  }
  return owners
}

/**
 * 该进程是否是我们自己的 uxship MCP Server。
 *
 * 判定依据是命令行里出现包名/目录名 `mcp-server`：
 * - 编译运行：`node .../mcp-server/dist/index.js`
 * - 开发运行：`node .../mcp-server/node_modules/.bin/tsx watch src/index.ts`
 * - npx/包安装：`mcp-server`
 */
export function isUxshipMcpProcess(command: string): boolean {
  if (!command) return false
  return /mcp-server/.test(command) && !/lsof|grep|awk|sed/.test(command)
}

/**
 * 清掉占用端口的**本服务旧实例**（重启/热更时使用）。
 *
 * 安全约束：占用者不是 uxship MCP Server 时**只报告、不 kill** ——
 * 旧实现是无差别 `lsof -ti:PORT | xargs kill -9`，用户把端口配成别的服务时会误杀。
 *
 * @returns killed 已清理的自有进程；refused 拒绝处理的陌生进程（调用方应报错退出）
 */
export function killPort(port: number): { killed: PortOwner[]; refused: PortOwner[] } {
  const owners = findPortOwners(port)
  const killed: PortOwner[] = []
  const refused: PortOwner[] = []

  for (const owner of owners) {
    if (!isUxshipMcpProcess(owner.command)) {
      refused.push(owner)
      continue
    }
    try {
      process.kill(owner.pid, 'SIGKILL')
      killed.push(owner)
      console.log(`[Process] Killed stale uxship MCP server (PID ${owner.pid}) on port ${port}`)
    } catch (err: any) {
      refused.push(owner)
      console.error(`[Process] Failed to kill PID ${owner.pid} on port ${port}: ${err?.message || err}`)
    }
  }

  if (refused.length > 0) {
    console.error(
      `[Process] Port ${port} is held by non-MasterGo process(es), refusing to kill: ` +
        refused.map((o) => `${o.pid} (${o.command.slice(0, 100)})`).join(', '),
    )
  }

  return { killed, refused }
}
