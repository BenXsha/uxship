#!/usr/bin/env tsx
/**
 * DSL 自动分片渲染工具
 * 
 * 当 DSL 文件过大无法通过 MCP tool call 传输时，使用此工具分片渲染。
 * 
 * 用法:
 *   # 直接渲染单个 DSL 文件
 *   tsx render-dsl.ts <文件路径>
 * 
 *   # 指定分片大小（每片最多元素数，默认 30）
 *   tsx render-dsl.ts <文件路径> --chunk-size=20
 * 
 *   # 指定输出目录（存放分片文件，默认 ./render-chunks）
 *   tsx render-dsl.ts <文件路径> --out-dir=./chunks
 * 
 * 工作原理:
 *   1. 读取 DSL 文件，分析元素数量和大小
 *   2. 如果紧凑 JSON < 25KB，直接生成紧凑文件供 dsl_render_from_file 使用
 *   3. 如果超过阈值，按顶层元素或元素数量分片
 *   4. 为每个分片生成独立的 DSL 文件
 *   5. 输出渲染命令，可供 AI 逐条执行
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname, basename } from 'path'

// 默认配置
const DEFAULT_CHUNK_SIZE = 30           // 每片最多元素数
const COMPACT_THRESHOLD = 25 * 1024     // 紧凑 JSON 超过 25KB 则分片
const DEFAULT_OUT_DIR = './render-chunks'

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
用法: tsx render-dsl.ts <文件路径> [选项]

选项:
  --chunk-size=N   每片最多元素数（默认 30）
  --out-dir=PATH   分片输出目录（默认 ./render-chunks）
  --dry-run        只分析不分片

示例:
  tsx render-dsl.ts ./dashboard.dsl.json
  tsx render-dsl.ts ./dashboard.dsl.json --chunk-size=20 --out-dir=./chunks
  tsx render-dsl.ts ./dashboard.dsl.json --dry-run
`)
    process.exit(0)
  }

  const filePath = resolve(args[0])
  const chunkSize = parseInt(args.find(a => a.startsWith('--chunk-size='))?.split('=')[1] || String(DEFAULT_CHUNK_SIZE), 10)
  const outDir = resolve(args.find(a => a.startsWith('--out-dir='))?.split('=')[1] || DEFAULT_OUT_DIR)
  const dryRun = args.includes('--dry-run')

  if (!existsSync(filePath)) {
    console.error(`错误: 文件不存在: ${filePath}`)
    process.exit(1)
  }

  // 读取 DSL
  let dslData: any
  try {
    const raw = readFileSync(filePath, 'utf-8')
    dslData = JSON.parse(raw)
  } catch (e: any) {
    console.error(`错误: 无法解析 DSL JSON: ${e.message}`)
    process.exit(1)
  }

  // 验证 DSL 结构
  if (!dslData.version || !Array.isArray(dslData.elements)) {
    console.error('错误: DSL 格式无效，需要包含 version 和 elements 字段')
    process.exit(1)
  }

  const compactJson = JSON.stringify(dslData, null, 0)
  const compactSize = Buffer.byteLength(compactJson, 'utf-8')
  const elementCount = countAllElements(dslData.elements)
  const topLevelCount = dslData.elements.length

  console.log(`\n📋 DSL 分析报告:`)
  console.log(`   文件: ${filePath}`)
  console.log(`   顶层元素: ${topLevelCount}`)
  console.log(`   总元素数(含嵌套): ${elementCount}`)
  console.log(`   紧凑 JSON 大小: ${(compactSize / 1024).toFixed(1)} KB`)

  // 收集所有顶层元素的名称和类型
  const topLevelInfo = dslData.elements.map((el: any, i: number) => ({
    index: i,
    name: el.name || `element-${i}`,
    type: el.type,
    childCount: countAllElements(el.children || []),
  }))

  console.log(`\n   顶层元素列表:`)
  topLevelInfo.forEach(info => {
    console.log(`     [${info.index}] ${info.name} (${info.type}, ${info.childCount} 子元素)`)
  })

  if (dryRun) {
    console.log('\n🏁 Dry-run 模式，未生成任何文件。')
    process.exit(0)
  }

  // 决策: 是否分片
  if (compactSize <= COMPACT_THRESHOLD) {
    // 文件足够小，直接生成紧凑版本
    const compactPath = filePath.replace(/\.json$/, '.compact.json')
    writeFileSync(compactPath, compactJson, 'utf-8')
    console.log(`\n✅ 文件较小 (${(compactSize / 1024).toFixed(1)}KB ≤ ${(COMPACT_THRESHOLD / 1024).toFixed(0)}KB)，无需分片。`)
    console.log(`   已生成紧凑文件: ${compactPath}`)
    console.log(`\n👉 使用 dsl_render_from_file 渲染:`)
    console.log(`   dsl_render_from_file(filePath="${compactPath}")`)
    return
  }

  // 需要分片
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  const outputFiles: string[] = []

  if (topLevelCount <= chunkSize) {
    // 顶层元素数量在分片大小内，但如果 DSL 整体很大，说明单个顶层元素(如 page-container)
    // 内部嵌套了很多子元素。这种情况下按顶层元素分片。
    console.log(`\n🔪 按顶层元素分片 (每片最多 ${chunkSize} 个)...`)
    
    for (let i = 0; i < topLevelCount; i += chunkSize) {
      const chunkElements = dslData.elements.slice(i, i + chunkSize)
      const chunkDsl = {
        version: dslData.version,
        elements: chunkElements,
      }
      const chunkPath = resolve(outDir, `chunk-${Math.floor(i / chunkSize) + 1}.json`)
      writeFileSync(chunkPath, JSON.stringify(chunkDsl, null, 0), 'utf-8')
      
      const chunkSizeBytes = Buffer.byteLength(JSON.stringify(chunkDsl, null, 0), 'utf-8')
      const chunkElementCount = countAllElements(chunkElements)
      console.log(`   生成分片 ${Math.floor(i / chunkSize) + 1}: ${chunkPath} (${(chunkSizeBytes / 1024).toFixed(1)}KB, ${chunkElementCount} 元素)`)
      outputFiles.push(chunkPath)
    }
  } else {
    // 顶层元素太多，按数量分片
    console.log(`\n🔪 按数量分片 (每片最多 ${chunkSize} 个顶层元素)...`)
    
    for (let i = 0; i < topLevelCount; i += chunkSize) {
      const chunkElements = dslData.elements.slice(i, i + chunkSize)
      const chunkDsl = {
        version: dslData.version,
        elements: chunkElements,
      }
      const chunkPath = resolve(outDir, `chunk-${Math.floor(i / chunkSize) + 1}.json`)
      writeFileSync(chunkPath, JSON.stringify(chunkDsl, null, 0), 'utf-8')
      
      const chunkSizeBytes = Buffer.byteLength(JSON.stringify(chunkDsl, null, 0), 'utf-8')
      console.log(`   生成分片 ${Math.floor(i / chunkSize) + 1}: ${chunkPath} (${(chunkSizeBytes / 1024).toFixed(1)}KB, ${chunkElements.length} 元素)`)
      outputFiles.push(chunkPath)
    }
  }

  // 生成渲染说明
  const baseName = basename(filePath, '.json')
  const summaryPath = resolve(outDir, 'render-commands.txt')
  const commands = outputFiles.map((f, i) =>
    `step ${i + 1}: dsl_render_from_file(filePath="${f}")`
  ).join('\n')
  writeFileSync(summaryPath, commands + '\n', 'utf-8')

  console.log(`\n✅ 分片完成! 共生成 ${outputFiles.length} 个分片文件。`)
  console.log(`   输出目录: ${outDir}`)
  console.log(`   渲染命令已保存至: ${summaryPath}`)
  console.log(`\n👉 逐条执行以下命令渲染:`)
  outputFiles.forEach((f, i) => {
    const size = (Buffer.byteLength(readFileSync(f, 'utf-8'), 'utf-8') / 1024).toFixed(1)
    console.log(`   [${i + 1}/${outputFiles.length}] dsl_render_from_file(filePath="${f}")  (${size}KB)`)
  })
}

function countAllElements(elements: any[]): number {
  let count = elements.length
  for (const el of elements) {
    if (el.children && Array.isArray(el.children)) {
      count += countAllElements(el.children)
    }
  }
  return count
}

main()