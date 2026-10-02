#!/usr/bin/env node
/**
 * 给 CJS 产物补一个 `package.json`。
 *
 * 为什么需要它：根 `package.json` 是 `"type": "module"`，所以 `dist/cjs/index.js` 里
 * 那套 `exports.x = …` 会被 Node 当成 ESM 解析而直接报错。往 `dist/cjs/` 里放一个
 * `{"type":"commonjs"}` 是双产物（dual package）的标准做法 —— 让 Node 按后缀找最近的作用域。
 *
 * 不做这一步的后果是「import 能用、require 报 ERR_REQUIRE_ESM」，而本地用 ESM 的开发
 * 流程完全测不出来 —— 所以顺手在 test 里对两种入口各测一次。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'dist/cjs')

mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
console.log('✅ 已写入 dist/cjs/package.json（type: commonjs）')
