import { processColor } from '../utils/color-utils'

/**
 * 转换效果样式
 */
export function convertEffects(effects: any[]): any[] {
  return effects.map(effect => {
    // DSL 用 visible，运行时用 isVisible —— 两种输入都接受
    const visible = effect.visible !== undefined ? effect.visible : effect.isVisible
    const converted: any = {
      type: effect.type,
      isVisible: visible !== false
    }

    // 模糊效果需要 radius 和 blendMode 参数
    if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
      if (effect.radius !== undefined) {
        converted.radius = effect.radius
      } else {
        // 为模糊效果设置默认半径
        converted.radius = 10
      }
      // 模糊效果需要 blendMode
      converted.blendMode = 'NORMAL'
    }
    // 阴影效果需要 radius、color、offset、spread、blendMode、showShadowBehindNode、isEffectShow 参数
    else if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      // 设置模糊半径
      if (effect.radius !== undefined) {
        converted.radius = effect.radius
      } else {
        converted.radius = 10
      }

      // 设置颜色
      if (effect.color !== undefined) {
        converted.color = processColor(effect.color)
      } else {
        // 默认黑色半透明
        converted.color = { r: 0, g: 0, b: 0, a: 0.25 }
      }

      // 设置偏移量
      if (effect.offset !== undefined) {
        converted.offset = effect.offset
      } else {
        // 默认向下偏移
        converted.offset = { x: 0, y: 4 }
      }

      // 设置扩散半径（默认 0）
      converted.spread = 0

      // 设置混合模式（默认 NORMAL）
      converted.blendMode = 'NORMAL'

      // 设置阴影是否显示在节点后面（默认 false）
      converted.showShadowBehindNode = false

      // 设置是否显示效果（默认 true）
      converted.isEffectShow = true
    }
    // 液态玻璃：私版新效果，按字段直传
    else if (effect.type === 'LIQUID_GLASS') {
      for (const key of ['depth', 'dispersion', 'refraction', 'lightIntensity', 'lightAngle', 'radius', 'blendMode']) {
        if (effect[key] !== undefined) converted[key] = effect[key]
      }
      if (converted.blendMode === undefined) converted.blendMode = 'NORMAL'
    }
    // 运动模糊：私版新效果，按字段直传
    else if (effect.type === 'MOTION_BLUR') {
      for (const key of ['radius', 'angle', 'blendMode']) {
        if (effect[key] !== undefined) converted[key] = effect[key]
      }
      if (converted.blendMode === undefined) converted.blendMode = 'NORMAL'
    }
    // 未知效果类型：原样透传（不丢字段），仅保留归一化后的可见性
    else {
      return { ...effect, isVisible: visible !== false }
    }

    return converted
  })
}

/**
 * 转换混合模式
 */
export function convertBlendMode(blendMode: string): string {
  // MasterGo API 支持的混合模式
  const supportedModes = [
    'NORMAL', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'LIGHTEN', 'SCREEN',
    'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE',
    'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY',
    'PLUS_DARKER', 'PLUS_LIGHTER', 'PASS_THROUGH'
  ]

  // 如果已经是支持的值，直接返回
  if (supportedModes.includes(blendMode)) {
    return blendMode
  }

  // 映射不兼容的值
  const modeMapping: Record<string, string> = {
    'LINEAR_BURN': 'PLUS_DARKER',
    'LINEAR_DODGE': 'PLUS_LIGHTER'
  }

  // 如果有映射，返回映射后的值
  if (modeMapping[blendMode]) {
    return modeMapping[blendMode]
  }

  // 如果都不匹配，返回 NORMAL 作为默认值
  console.warn(`不支持的混合模式: ${blendMode}，将使用 NORMAL`)
  return 'NORMAL'
}

/**
 * 检查元素及其子元素是否包含阴影效果
 * 用于决定是否启用 clipsContent（有阴影的容器不应裁剪）
 */
export function hasShadowEffect(element: any): boolean {
  if (element.effects && Array.isArray(element.effects)) {
    for (const effect of element.effects) {
      if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        return true
      }
    }
  }
  const children = (element as any).children
  if (children && Array.isArray(children)) {
    for (const child of children) {
      if (hasShadowEffect(child)) return true
    }
  }
  return false
}
