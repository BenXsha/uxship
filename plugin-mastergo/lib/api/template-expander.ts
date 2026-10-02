import { TemplateRenderer } from './template-renderer'
import {
  BaseElement,
  TemplateRefElement,
  TemplateElement,
  GeneratorElement,
  TreeElement,
} from './dsl-types'

/**
 * 展开所有模板和生成器为基本元素
 */
export function expandTemplatesAndGenerators(elements: BaseElement[]): BaseElement[] {
  const result: BaseElement[] = []

  for (const element of elements) {
    if ((element.type === 'group' || element.type === 'frame' || element.type === 'component') && (element as any).children) {
      (element as any).children = expandTemplatesAndGenerators((element as any).children)
      result.push(element)
    } else if (element.type === 'template-ref') {
      const ref = element as TemplateRefElement
      try {
        const expanded = TemplateRenderer.expandTemplate(ref.ref, ref.overrides || {})
        result.push(...expandTemplatesAndGenerators(expanded))
      } catch (error) {
        console.error(`展开模板引用 "${ref.ref}" 失败:`, error)
      }
    } else if (element.type === 'template') {
      const tmpl = element as TemplateElement
      try {
        const expanded = TemplateRenderer.expandTemplate(tmpl.template, tmpl.config, tmpl.data)
        result.push(...expandTemplatesAndGenerators(expanded))
      } catch (error) {
        console.error(`展开模板 "${tmpl.name}" 失败:`, error)
      }
    } else if (element.type === 'generator') {
      console.warn(`生成器元素 "${element.name}" 暂不支持动态展开，跳过`)
    } else if (element.type === 'tree') {
      const tree = element as TreeElement
      try {
        const expanded = TemplateRenderer.expandTree(tree.data, tree.config)
        result.push(...expandTemplatesAndGenerators(expanded))
      } catch (error) {
        console.error(`展开树形组件 "${tree.name}" 失败:`, error)
      }
    } else {
      result.push(element)
    }
  }
  return result
}

/**
 * 将渲染出的节点合并为 Group。
 * MasterGo 的 API 是 mg.group(nodes)（没有 createGroup），因此先渲染出节点再成组。
 */
function groupRenderedNodes(name: string, childNodes: any[]): any {
  if (childNodes.length === 0) return null
  if (childNodes.length === 1) return childNodes[0]
  const group = mg.group(childNodes as SceneNode[])
  if (group && name) group.name = name
  return group
}

/**
 * 渲染模板引用
 */
export function renderTemplateRef(
  element: TemplateRefElement,
  renderElement: (element: BaseElement) => any
): any {
  try {
    const expanded = TemplateRenderer.expandTemplate(element.ref, element.overrides || {})
    if (expanded.length === 0) return null
    if (expanded.length === 1) {
      return renderElement(expanded[0])
    }
    const childNodes = expanded.map((child) => renderElement(child)).filter(Boolean)
    return groupRenderedNodes(element.name, childNodes)
  } catch (error) {
    console.error(`渲染模板引用 "${element.name}" 失败:`, error)
    return null
  }
}

/**
 * 渲染模板定义
 */
export function renderTemplate(
  element: TemplateElement,
  renderElement: (element: BaseElement) => any
): any {
  try {
    const expanded = TemplateRenderer.expandTemplate(element.template, element.config, element.data)
    if (expanded.length === 0) return null
    if (expanded.length === 1) {
      return renderElement(expanded[0])
    }
    const childNodes = expanded.map((child) => renderElement(child)).filter(Boolean)
    return groupRenderedNodes(element.name, childNodes)
  } catch (error) {
    console.error(`渲染模板 "${element.name}" 失败:`, error)
    return null
  }
}

/**
 * 渲染生成器
 */
export function renderGenerator(
  element: GeneratorElement,
  parentIsInAutoLayout: boolean | undefined,
  renderUIComponent: (element: GeneratorElement, parentIsInAutoLayout?: boolean) => any
): any {
  if (element.generatorType === 'component') {
    return renderUIComponent(element, parentIsInAutoLayout)
  }
  console.warn(`生成器元素 "${element.name}" 暂不支持，跳过渲染`)
  return null
}

/**
 * 渲染树形结构组件
 */
export function renderTree(
  element: TreeElement,
  renderElement: (element: BaseElement) => any
): any {
  try {
    const expanded = TemplateRenderer.expandTree(element.data, element.config)
    if (expanded.length === 0) return null
    if (expanded.length === 1) {
      return renderElement(expanded[0])
    }
    const childNodes = expanded.map((child) => renderElement(child)).filter(Boolean)
    return groupRenderedNodes(element.name, childNodes)
  } catch (error) {
    console.error(`渲染树形组件 "${element.name}" 失败:`, error)
    return null
  }
}
