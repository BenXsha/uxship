import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROMPTS } from './prompts.js'

export function registerAllPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    const shape: Record<string, z.ZodTypeAny> = {}
    if (p.meta.arguments) {
      for (const a of p.meta.arguments) {
        shape[a.name] = a.required
          ? z.string().describe(a.description || '')
          : z.string().optional().describe(a.description || '')
      }
    }

    server.registerPrompt(p.meta.name, {
      description: p.meta.description,
      argsSchema: Object.keys(shape).length > 0 ? shape as any : undefined,
    }, async (args: Record<string, string>) => {
      const result = p.generate((args || {}) as Record<string, string>)
      return {
        messages: result.messages.map(m => ({
          role: m.role,
          content: { type: 'text' as const, text: m.content.text },
        })),
        description: result.description,
      }
    })
  }
}
