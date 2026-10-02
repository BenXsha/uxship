/**
 * JSON Schema → zod（保留 required / enum / 嵌套结构 / description）
 *
 * 背景：`register-tools.ts` 曾把 60 个工具的手写 JSON Schema 全部压成
 * `z.any().optional()`，于是 MCP 客户端 `tools/list` 看到的 schema 里**没有必填、
 * 没有枚举**——LLM 无从知道哪些参数必填、哪些取值合法（实测 `describe` 出来的
 * 参数类型全是 any）。
 *
 * 约定：
 * - 只映射类型与约束（type / enum / items / properties / required / description），
 *   **不注入 default**：注入会让 SDK 悄悄补值，改变现有 handler 的行为。
 * - 每一层 object 都 `.passthrough()`：路由参数（如 `_sessionId`）与未在 schema 中
 *   声明的兼容参数必须原样透传，否则会静默丢参数。
 * - 无法识别的结构（未知 type）降级为 `z.any()`，但保留 description。
 * - `anyOf` / `oneOf` / `allOf` 这类**跨字段约束** zod 类型表达不出来（`refine` 不进 schema），
 *   因此**原样透传**到 `tools/list`，见下面 COMPOSITION_KEYWORDS。
 */
import { z } from 'zod'

/**
 * 无法用 zod 类型表达、必须原样透传到 `tools/list` 的 JSON Schema 组合关键字。
 *
 * 为什么需要：发布出去的 schema 是 `z.toJSONSchema(zod)` 生成的，源头是 zod 类型；
 * 而「这几个字段至少给一组」这类跨字段约束 zod 表达不出来。
 * 最典型的受害者是**合并了「单体 / 批量」双形态的工具**
 * （`node_create` / `node_update` / `node_delete` / `design_suggest`，
 * 按实参形状在服务端选路，见 `tools.ts` 的 `resolvePluginMethod`）：
 * 合并丢掉了顶层 `required`，而服务端仍强制要求至少一组参数，
 * 于是模型看到「所有参数都可选」，发出空 `{}` 被拒——
 * 实测小模型会连续重试同一个失败调用。
 *
 * 用 `.meta()` 透传：只影响发布的 schema，**不参与 zod 校验**，因此对已有调用零破坏风险。
 */
const COMPOSITION_KEYWORDS = ['anyOf', 'oneOf', 'allOf'] as const

function stringEnum(schema: any): z.ZodTypeAny | null {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null
  if (!schema.enum.every((v: unknown) => typeof v === 'string')) return null
  return z.enum(schema.enum as [string, ...string[]])
}

/** 把单个 JSON Schema 片段转成 zod 类型 */
export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any()

  let base: z.ZodTypeAny

  switch (schema.type) {
    case 'string':
      base = stringEnum(schema) ?? z.string()
      break
    case 'number':
      base = z.number()
      break
    case 'integer':
      base = z.number().int()
      break
    case 'boolean':
      base = z.boolean()
      break
    case 'array':
      base = z.array(jsonSchemaToZod(schema.items))
      break
    case 'object': {
      const properties = schema.properties
      if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) {
        const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
        const shape: Record<string, z.ZodTypeAny> = {}
        for (const [key, value] of Object.entries(properties)) {
          const field = jsonSchemaToZod(value)
          shape[key] = required.has(key) ? field : field.optional()
        }
        base = z.object(shape).passthrough()
      } else {
        // 无声明属性的对象（如自由 config / properties 覆写）→ 任意键
        base = z.object({}).passthrough()
      }
      break
    }
    default:
      // 未声明 type 或 anyOf/oneOf 等复杂结构 → 放开类型，但仍保留 description
      base = z.any()
  }

  if (typeof schema.description === 'string' && schema.description) {
    base = base.describe(schema.description)
  }

  // 组合关键字透传（见 COMPOSITION_KEYWORDS 的说明）。
  // 只在源 schema 真的声明了才调用 .meta()，其余工具的输出与改动前逐字节一致。
  const composition: Record<string, unknown> = {}
  for (const keyword of COMPOSITION_KEYWORDS) {
    const value = schema[keyword]
    if (Array.isArray(value) && value.length > 0) composition[keyword] = value
  }
  if (Object.keys(composition).length > 0) {
    base = base.meta(composition)
  }

  return base
}

/** 顶层工具 inputSchema（工具 schema 恒为 object） */
export function toolInputSchemaToZod(inputSchema: any): z.ZodTypeAny {
  if (!inputSchema || typeof inputSchema !== 'object') return z.object({}).passthrough()
  return jsonSchemaToZod(inputSchema)
}
