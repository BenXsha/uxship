import axios from 'axios'
import type { DesignIntention } from './types.js'

function getConfig(): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  }
}

const SYSTEM_PROMPT = `你是一个设计意图解析器。将用户的设计需求解析为结构化的 JSON。
严格按照以下 JSON 格式返回，不要包含任何其他内容：

{
  "pageType": "landing|dashboard|form|list|detail|custom",
  "layout": "single-column|two-column|grid|free",
  "style": "minimal|rich|playful|corporate",
  "components": [
    { "type": "组件类型", "count": 数量 }
  ],
  "theme": {
    "mode": "light|dark",
    "primaryColor": "十六进制色值或 null"
  },
  "constraints": {
    "device": "desktop|tablet|mobile",
    "width": 像素值
  },
  "description": "设计需求简述"
}

组件类型可选: button, text-input, select, toggle, avatar, badge, progress, table, form, card, tabs, modal, chart, list, pagination, breadcrumb, slider, divider, alert, skeleton, nav, icon`

export async function interpretWithLLM(input: string): Promise<DesignIntention | null> {
  const config = getConfig()
  if (!config.apiKey) return null

  try {
    const response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    )

    const content = response.data?.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content)
    return {
      pageType: parsed.pageType || 'custom',
      layout: parsed.layout || 'single-column',
      components: (parsed.components || []).map((c: any) => ({
        type: c.type,
        count: c.count || 1,
      })),
      theme: {
        mode: parsed.theme?.mode === 'dark' ? 'dark' : 'light',
        primaryColor: parsed.theme?.primaryColor || undefined,
        style: parsed.style || 'minimal',
      },
      constraints: {
        width: parsed.constraints?.width || (parsed.constraints?.device === 'mobile' ? 375 : parsed.constraints?.device === 'tablet' ? 768 : 1440),
        device: parsed.constraints?.device,
      },
      description: parsed.description || input,
    }
  } catch {
    return null
  }
}
