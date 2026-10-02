import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const RULES_DIR = resolve(import.meta.dirname, '../../../skills/design/rules')

interface RuleDoc {
  id: string
  title: string
  description: string
  content: string
  topics: string[]
}

const TOPIC_INDEX: Record<string, string[]> = {
  quickstart: ['00'],
  'core-tags': ['01'],
  layout: ['02'],
  chart: ['03'],
  freeze: ['04'],
  pitfalls: ['05'],
  image: ['06'],
  tools: ['07'],
  dsl: ['08', '10'],
  design: ['09', '14'],
  example: ['11'],
  limitation: ['12'],
  'codebase-viz': ['15'],
}

let _cache: RuleDoc[] | null = null

function loadRules(): RuleDoc[] {
  if (_cache) return _cache

  if (!existsSync(RULES_DIR)) {
    console.warn(`[Guidelines] Rules directory not found: ${RULES_DIR}`)
    return []
  }

  const files = readdirSync(RULES_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()

  const rules: RuleDoc[] = files.map(file => {
    const content = readFileSync(join(RULES_DIR, file), 'utf-8')
    const id = file.replace('.md', '')
    const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') || id
    const descLine = content.split('\n').find(l => l.startsWith('> '))
    const description = descLine ? descLine.replace('> ', '') : ''
    const topics = Object.entries(TOPIC_INDEX)
      .filter(([_, prefixes]) => prefixes.some(p => id.startsWith(p)))
      .map(([topic]) => topic)
    return { id, title, description, content, topics }
  })

  _cache = rules
  return rules
}

export function getGuidelineTopics(): string[] {
  return Object.keys(TOPIC_INDEX)
}

export function getGuidelines(topic?: string): RuleDoc[] {
  let rules = loadRules()
  if (topic) {
    const t = topic.toLowerCase()
    rules = rules.filter(r =>
      r.topics.includes(t) ||
      r.title.toLowerCase().includes(t) ||
      r.description.toLowerCase().includes(t) ||
      r.content.toLowerCase().includes(t)
    )
  }
  return rules.map(r => ({
    ...r,
    content: r.content.length > 8000 ? r.content.slice(0, 8000) + '\n\n... (truncated)' : r.content,
  }))
}

export function getGuidelinesIndex(): { id: string; title: string; description: string; topics: string[] }[] {
  return loadRules().map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    topics: r.topics,
  }))
}
