import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveCorsOrigin,
  extractToken,
  isAuthorized,
  requiresAuth,
} from '../src/utils/http-security.js'
import { findPortOwners, isMastergoMcpProcess, killPort } from '../src/utils/process.js'

/**
 * HTTP/进程边界安全测试
 *
 * 历史问题：响应无条件写 `Access-Control-Allow-Origin: *`、监听 0.0.0.0 且无鉴权
 * （任意网页可从 localhost 跨源驱动本机插件）；`killPort` 无差别 `kill -9` 端口占用者
 * （用户把端口配成别的服务时会误杀）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../src')

describe('resolveCorsOrigin', () => {
  it('未配置时不发 CORS 头（默认安全）', () => {
    expect(resolveCorsOrigin(undefined, 'https://evil.example')).toBeNull()
    expect(resolveCorsOrigin('', 'https://evil.example')).toBeNull()
    expect(resolveCorsOrigin('   ', 'https://evil.example')).toBeNull()
  })

  it('命中白名单源才回显', () => {
    expect(resolveCorsOrigin('http://localhost:3000', 'http://localhost:3000')).toBe('http://localhost:3000')
    expect(resolveCorsOrigin('http://localhost:3000', 'https://evil.example')).toBeNull()
    expect(resolveCorsOrigin('http://localhost:3000', undefined)).toBeNull()
  })

  it('仅显式 * 才放开（兼容旧行为）', () => {
    expect(resolveCorsOrigin('*', undefined)).toBe('*')
  })
})

describe('token 提取与鉴权', () => {
  it('支持 Authorization: Bearer 与 ?token=', () => {
    expect(extractToken({ authorization: 'Bearer abc123' }, '/sse')).toBe('abc123')
    expect(extractToken({}, '/sse?token=abc123')).toBe('abc123')
    expect(extractToken({}, '/sse?foo=1&token=a%20b')).toBe('a b')
    expect(extractToken({}, '/sse')).toBeNull()
    expect(extractToken({ authorization: 'Basic xyz' }, '/sse')).toBeNull()
  })

  it('未配置 token 时不启用鉴权（向后兼容）', () => {
    expect(isAuthorized({}, '/mcp', undefined)).toBe(true)
    expect(isAuthorized({}, '/mcp', '   ')).toBe(true)
  })

  it('配置 token 后必须匹配', () => {
    expect(isAuthorized({ authorization: 'Bearer s3cret' }, '/mcp', 's3cret')).toBe(true)
    expect(isAuthorized({}, '/mcp?token=s3cret', 's3cret')).toBe(true)
    expect(isAuthorized({ authorization: 'Bearer wrong' }, '/mcp', 's3cret')).toBe(false)
    expect(isAuthorized({}, '/mcp', 's3cret')).toBe(false)
    // 长度不同也不能崩（constant-time 比较前先比长度）
    expect(isAuthorized({ authorization: 'Bearer s3cret-longer' }, '/mcp', 's3cret')).toBe(false)
  })

  it('/health 永远公开（守护脚本探活用）', () => {
    expect(requiresAuth('/health')).toBe(false)
    expect(requiresAuth('/sse')).toBe(true)
    expect(requiresAuth('/messages')).toBe(true)
    expect(requiresAuth('/mcp')).toBe(true)
  })
})

describe('进程身份判定', () => {
  it('认得出我们自己的运行方式', () => {
    expect(isMastergoMcpProcess('node /Users/x/master-local-mcp/mcp-server/dist/index.js')).toBe(true)
    expect(isMastergoMcpProcess('node /Users/x/mcp-server/node_modules/.bin/tsx watch src/index.ts')).toBe(true)
    expect(isMastergoMcpProcess('npx mcp-server --stdio')).toBe(true)
  })

  it('拒绝把无关进程当成自己', () => {
    expect(isMastergoMcpProcess('/usr/local/bin/postgres -D /data')).toBe(false)
    expect(isMastergoMcpProcess('nginx: worker process')).toBe(false)
    expect(isMastergoMcpProcess('node /Users/x/other-project/dist/index.js')).toBe(false)
    expect(isMastergoMcpProcess('')).toBe(false)
  })

  it('在空闲端口上不做任何事（不抛异常）', () => {
    const port = 15999
    const owners = findPortOwners(port)
    expect(Array.isArray(owners)).toBe(true)
    const result = killPort(port)
    expect(result.killed).toEqual([])
    expect(result.refused).toEqual([])
  })
})

/** 源码级防回归：不允许退回「无差别 kill」与「通配 CORS」 */
describe('源码门禁', () => {
  it('process.ts 不再无差别 kill 端口占用者', () => {
    const source = readFileSync(join(SRC, 'utils/process.ts'), 'utf-8')
    expect(source).not.toMatch(/`kill -9 \$\{/)
    expect(source).toContain('isMastergoMcpProcess')
    expect(source).toContain('refused')
  })

  it('http-server.ts 默认不再发通配 CORS', () => {
    const source = readFileSync(join(SRC, 'server/http-server.ts'), 'utf-8')
    expect(source).not.toContain("Access-Control-Allow-Origin', '*'")
    expect(source).toContain('resolveCorsOrigin')
    expect(source).toContain('isAuthorized')
  })

  it('ws-bridge.ts 默认不再监听 0.0.0.0', () => {
    const source = readFileSync(join(SRC, 'server/ws-bridge.ts'), 'utf-8')
    expect(source).not.toContain("host: '0.0.0.0'")
    expect(source).toContain('this.bindHost')
  })
})
