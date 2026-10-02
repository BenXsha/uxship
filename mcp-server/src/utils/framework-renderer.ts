import { escapeHtml } from './dsl-to-code.js'

export interface FrameworkRenderer {
  openTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string
  closeTag(tag: string): string
  voidTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string
  text(content: string): string
  indent(level: number): string
  wrapComponent(name: string, body: string, options?: {
    imports?: string[]
    props?: Record<string, string>
    children?: boolean
  }): string
  wrapPage(title: string, body: string, options?: { imports?: string[] }): string
}

export class HtmlRenderer implements FrameworkRenderer {
  constructor(private indentSize: number = 2) {}

  indent(level: number): string {
    return ' '.repeat(level * this.indentSize)
  }

  openTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    const attrStr = this.buildAttrs(attrs)
    return `<${tag}${attrStr}>`
  }

  closeTag(tag: string): string {
    return `</${tag}>`
  }

  voidTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    const attrStr = this.buildAttrs(attrs)
    return `<${tag}${attrStr} />`
  }

  text(content: string): string {
    return content
  }

  wrapComponent(name: string, body: string, options?: {
    imports?: string[];
    props?: Record<string, string>;
    children?: boolean;
  }): string {
    const imp = options?.imports?.length ? `${options.imports.join('\n')}\n\n` : ''
    return `${imp}<!-- ${name} -->\n${body}`
  }

  wrapPage(title: string, body: string, _options?: { imports?: string[] }): string {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>${title}</title>\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body>\n${body}\n</body>\n</html>`
  }

  private buildAttrs(attrs?: Record<string, string | boolean | number | undefined>): string {
    if (!attrs) return ''
    let result = ''
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue
      if (value === true) {
        result += ` ${key}`
      } else {
        result += ` ${key}="${escapeHtml(String(value))}"`
      }
    }
    return result
  }
}

export class ReactRenderer extends HtmlRenderer {
  constructor(indentSize: number = 2) {
    super(indentSize)
  }

  openTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    if (attrs?.class) {
      attrs = { ...attrs, className: attrs.class }
      delete attrs.class
    }
    if (attrs?.for) {
      attrs = { ...attrs, htmlFor: attrs.for }
      delete attrs.for
    }
    return super.openTag(tag, attrs)
  }

  voidTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    if (attrs?.class) {
      attrs = { ...attrs, className: attrs.class }
      delete attrs.class
    }
    if (attrs?.for) {
      attrs = { ...attrs, htmlFor: attrs.for }
      delete attrs.for
    }
    return super.voidTag(tag, attrs)
  }

  wrapComponent(name: string, body: string, options?: {
    imports?: string[]
    props?: Record<string, string>
    children?: boolean
  }): string {
    const imp = options?.imports?.length ? `${options.imports.join('\n')}\n\n` : ''
    const propsEntries = Object.entries(options?.props || {})
    const propsType = propsEntries.length
      ? `interface ${name}Props {\n${propsEntries.map(([k, v]) => `  ${k}?: ${v}`).join('\n')}\n}\n\n`
      : ''
    const params = propsEntries.length || options?.children ? `{ ${propsEntries.map(([k]) => k).join(', ')}${options?.children ? `${propsEntries.length ? ', ' : ''}children` : ''} }: ${name}Props` : ''
    return `${imp}${propsType}export const ${name} = (${params}) => (\n${body}\n)\n`
  }

  wrapPage(title: string, body: string, options?: { imports?: string[] }): string {
    const imp = options?.imports?.length ? `${options.imports.join('\n')}\n\n` : ''
    return `${imp}export const ${title.replace(/\s+/g, '')}Page = () => (\n${body}\n)\n`
  }
}

export class VueRenderer extends HtmlRenderer {
  constructor(indentSize: number = 2) {
    super(indentSize)
  }

  openTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    return super.openTag(tag, attrs)
  }

  voidTag(tag: string, attrs?: Record<string, string | boolean | number | undefined>): string {
    return super.voidTag(tag, attrs)
  }

  wrapComponent(name: string, body: string, options?: {
    imports?: string[]
    props?: Record<string, string>
    children?: boolean
  }): string {
    const propsEntries = Object.entries(options?.props || {})
    const setupAttrs = propsEntries.length
      ? `\ndefineProps<{\n${propsEntries.map(([k, v]) => `  ${k}?: ${v}`).join('\n')}\n}>()`
      : ''
    return `<template>\n${body}\n</template>\n\n<script setup lang="ts">${setupAttrs}\n</script>\n`
  }

  wrapPage(title: string, body: string, options?: { imports?: string[] }): string {
    const imp = options?.imports?.length ? `${options.imports.join('\n')}\n` : ''
    return `<template>\n${body}\n</template>\n\n<script setup lang="ts">\n${imp}</script>\n`
  }
}

export function createRenderer(framework: string, indentSize: number = 2): FrameworkRenderer {
  switch (framework) {
    case 'react': return new ReactRenderer(indentSize)
    case 'vue3': return new VueRenderer(indentSize)
    default: return new HtmlRenderer(indentSize)
  }
}
