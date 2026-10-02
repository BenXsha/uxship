/**
 * 组件渲染处理器
 *
 * 高阶组件 API：将原子组件（checkbox/radio/button/input）的创建封装为一次调用。
 * 遵循 B1 方案（Token 参数注入），提供最佳实践默认值，支持 theme 覆盖。
 */

import { mergeTheme } from './design-theme'
import { solidFill, dropShadow, makeNode, serializeNode, getSize, SizeTier, SPINNER_TRACK, SPINNER_ARC, renderSvgIcon, StateSubset, renderStateGroup } from './component-utils'

/**
 * 单个状态的覆写。只有这几个键会被 `render*` 读取，其余键由各预设自行决定。
 * 用真实形状而不是 `Record<string, any>`：写错键名（如 `textcolor`）会直接被编译报错拦住。
 */
interface ButtonStateOverride {
  bg?: string
  textColor?: string
  stroke?: string
  name?: string
}

// ─── 基础组件 — 按钮、徽标、头像、开关、进度、分割线、标签、提示、加载、骨架屏 ───

export function renderButton(params: any): any {
  const t = mergeTheme(params.theme)
  const variant = params.variant || 'primary'
  const shape = params.shape || 'default'
  const tier: SizeTier = params.size?.tier || 'md'
  const btnText = params.label || 'Button'

  const BTN_SIZES: Record<string, Record<string, unknown>> = {
    sm: { height: t.buttonHeightSm, fontSize: t.buttonFontSizeSm, paddingX: 12, radius: Math.min(t.buttonRadius - 1, t.buttonHeightSm / 2) },
    md: { height: t.buttonHeightMd, fontSize: t.buttonFontSize, paddingX: t.buttonPaddingX, radius: t.buttonRadius },
    lg: { height: t.buttonHeightLg, fontSize: t.buttonFontSizeLg, paddingX: t.buttonPaddingX + 4, radius: t.buttonRadius + 2 },
  }

  const size = getSize(tier, BTN_SIZES, params.size)
  const height = size.height

  const VARIANTS: Record<string, { bg: string; textColor: string; stroke?: string }> = {
    primary: { bg: t.brand, textColor: '#FFFFFF' },
    secondary: { bg: t.bgWhite, textColor: '#333333' },
    outline: { bg: t.bgWhite, textColor: '#444444', stroke: '#DDDDDD' },
    text: { bg: 'transparent', textColor: t.brand },
  }

  const v = VARIANTS[variant] || VARIANTS.primary
  const cornerRadius = shape === 'pill' ? height / 2 : (size.radius ?? t.buttonRadius)

  const estCharW = size.fontSize * 0.5
  const textW = Math.round(btnText.length * estCharW)
  const iconSize = size.fontSize + 2
  const gap = 6

  let totalW = textW + size.paddingX * 2
  if (params.icon) totalW += iconSize + gap
  if (params.iconRight) totalW += iconSize + gap
  const width = params.size?.width ?? totalW

  function renderSingleButton(overrides: ButtonStateOverride, parentId: string, offsetX: number): { width: number; height: number } {
    const bg = overrides.bg ?? v.bg
    const textColor = overrides.textColor ?? v.textColor
    const stroke = overrides.stroke ?? v.stroke
    const btnName = overrides.name || `Button-${variant}`

    const frame = makeNode('frame', {
      name: btnName,
      width, height,
      x: offsetX, y: 0,
      cornerRadius,
      fills: [solidFill(bg)],
      ...(stroke ? { strokes: [solidFill(stroke, 1)], strokeWeight: 1 } : {}),
      clipsContent: true,
      flexMode: 'HORIZONTAL',
      mainAxisAlignItems: 'CENTER',
      crossAxisAlignItems: 'CENTER',
      paddingLeft: size.paddingX,
      paddingRight: size.paddingX,
      mainAxisSizingMode: 'FIXED',
      crossAxisSizingMode: 'FIXED',
      itemSpacing: gap,
    }, parentId)

    if (params.icon) {
      makeNode('text', { name: 'Icon', characters: params.icon, fontSize: iconSize, fills: [solidFill(textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
    }
    if (params.iconRight) {
      makeNode('text', { name: 'Label', characters: btnText, fontSize: size.fontSize, fontName: { family: 'Inter', style: variant === 'primary' ? 'Bold' : 'Regular' }, fills: [solidFill(textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
      makeNode('text', { name: 'IconRight', characters: params.iconRight, fontSize: iconSize, fills: [solidFill(textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
    } else {
      makeNode('text', { name: 'Label', characters: btnText, fontSize: size.fontSize, fontName: { family: 'Inter', style: variant === 'primary' ? 'Bold' : 'Regular' }, fills: [solidFill(textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
    }
    return { width, height }
  }

  // States mode: render multi-state group
  if (params.states) {
    const allStates: StateSubset = {
      default: { label: 'Default', overrides: { name: `Button-${variant}-default` } },
      hover: { label: 'Hover', overrides: { name: `Button-${variant}-hover`, bg: t.brandHover } },
      active: { label: 'Active', overrides: { name: `Button-${variant}-active`, bg: '#2A2899' } },
      disabled: { label: 'Disabled', overrides: { name: `Button-${variant}-disabled`, bg: t.bgDisabled, textColor: t.textDisabled } },
    }
    const activeStates: StateSubset = {}
    for (const s of params.states) { if (allStates[s]) activeStates[s] = allStates[s] }
    const groupW = Object.keys(activeStates).length * (width + 16) - 16
    const group = makeNode('frame', {
      name: `ButtonGroup-${variant}`,
      width: groupW,
      height: height + 20,
      x: params.position?.x ?? 100,
      y: params.position?.y ?? 100,
      fills: [],
    })
    renderStateGroup(group, renderSingleButton, activeStates, 0, 0)
    mg.commitUndo()
    return { success: true, container: serializeNode(group) }
  }

  // Single mode (backward compatible)
  const frame = makeNode('frame', {
    name: `Button-${variant}`,
    width, height,
    x: params.position?.x ?? 100, y: params.position?.y ?? 100,
    cornerRadius, fills: [solidFill(v.bg)],
    ...(v.stroke ? { strokes: [solidFill(v.stroke, 1)], strokeWeight: 1 } : {}),
    clipsContent: true, flexMode: 'HORIZONTAL',
    mainAxisAlignItems: 'CENTER', crossAxisAlignItems: 'CENTER',
    paddingLeft: size.paddingX, paddingRight: size.paddingX,
    mainAxisSizingMode: 'FIXED', crossAxisSizingMode: 'FIXED', itemSpacing: gap,
  })
  if (params.icon) {
    makeNode('text', { name: 'Icon', characters: params.icon, fontSize: iconSize, fills: [solidFill(v.textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
  }
  if (params.iconRight) {
    makeNode('text', { name: 'Label', characters: btnText, fontSize: size.fontSize, fontName: { family: 'Inter', style: variant === 'primary' ? 'Bold' : 'Regular' }, fills: [solidFill(v.textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
    makeNode('text', { name: 'IconRight', characters: params.iconRight, fontSize: iconSize, fills: [solidFill(v.textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
  } else {
    makeNode('text', { name: 'Label', characters: btnText, fontSize: size.fontSize, fontName: { family: 'Inter', style: variant === 'primary' ? 'Bold' : 'Regular' }, fills: [solidFill(v.textColor)], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }, frame.id)
  }
  mg.commitUndo()
  return { success: true, frame: serializeNode(frame) }
}

export function renderBadge(params: any): any {
  const t = mergeTheme(params.theme)
  const label = params.label || 'Badge'
  const variant = params.variant || 'default'
  const tier: SizeTier = params.size?.tier || 'md'

  const BADGE_SIZES: Record<string, Record<string, unknown>> = {
    sm: { height: t.badgeHeightSm, fontSize: 10, paddingX: 6 },
    md: { height: t.badgeHeightMd, fontSize: t.badgeFontSize, paddingX: t.badgePaddingX },
    lg: { height: t.badgeHeightLg, fontSize: 13, paddingX: 10 },
  }

  const size = getSize(tier, BADGE_SIZES, params.size)
  const height = size.height
  const paddingX = size.paddingX

  const badgeVariants: Record<string, { bg: string; text: string }> = {
    default: { bg: '#E8E8E8', text: '#333333' },
    success: { bg: '#E6F7E6', text: '#1A7D1A' },
    warning: { bg: '#FFF3E0', text: '#92400E' },
    danger: { bg: '#FFEBEE', text: '#C62828' },
    info: { bg: '#E3F2FD', text: '#1565C0' },
  }
  const v = badgeVariants[variant] || badgeVariants.default

  const text = makeNode('text', {
    name: 'Label',
    characters: label,
    fontSize: size.fontSize,
    fontName: { family: 'Inter', style: 'Medium' },
    fills: [solidFill(v.text)],
    textAlignHorizontal: 'CENTER',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  })
  const tw = text.width
  const th = text.height

  const frame = makeNode('frame', {
    name: `Badge-${variant}`,
    width: tw + paddingX * 2,
    height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: height / 2,
    fills: [solidFill(v.bg)],
    clipsContent: true,
  })
  frame.appendChild(text)
  text.x = Math.round((frame.width - tw) / 2)
  text.y = Math.round((frame.height - th) / 2)

  mg.commitUndo()
  return { success: true, frame: serializeNode(frame), text: serializeNode(text) }
}

export function renderAvatar(params: any): any {
  const t = mergeTheme(params.theme)
  const initial = params.initial || 'U'
  const size = params.size?.width ?? 36
  const bg = params.bgColor || t.brand
  const textColor = params.textColor || '#FFFFFF'

  const frame = makeNode('frame', {
    name: 'Avatar',
    width: size,
    height: size,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: size / 2,
    fills: [solidFill(bg)],
    clipsContent: true,
  })

  const text = makeNode('text', {
    name: 'Initial',
    characters: initial,
    fontSize: size * 0.4,
    fontName: { family: 'Inter', style: 'Bold' },
    fills: [solidFill(textColor)],
    textAlignHorizontal: 'CENTER',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  }, frame.id)
  text.x = Math.round((size - text.width) / 2)
  text.y = Math.round((size - text.height) / 2)

  mg.commitUndo()
  return { success: true, frame: serializeNode(frame), text: serializeNode(text) }
}

export function renderToggle(params: any): any {
  const t = mergeTheme(params.theme)
  const checked = params.checked !== false
  const tier: SizeTier = params.size?.tier || 'md'

  const TOGGLE_SIZES: Record<string, Record<string, unknown>> = {
    sm: { w: t.toggleWidthSm, h: t.toggleHeightSm },
    md: { w: t.toggleWidth, h: t.toggleHeight },
    lg: { w: t.toggleWidthLg, h: t.toggleHeightLg },
  }

  const sz = getSize(tier, TOGGLE_SIZES, params.size)
  const trackW = sz.w
  const trackH = sz.h
  const knobSize = trackH - 4

  if (trackH > trackW) throw new Error('Toggle track height must be <= width')

  const trackColor = checked ? t.brand : '#E0E0E0'
  const knobColor = '#FFFFFF'
  const knobGap = Math.max(2, Math.round(trackH * 0.08))

  const frame = makeNode('frame', {
    name: 'Toggle',
    width: trackW,
    height: trackH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: trackH / 2,
    fills: [solidFill(trackColor)],
    clipsContent: true,
  })

  const knobX = checked ? trackW - knobSize - knobGap : knobGap
  const knob = makeNode('ellipse', {
    // 图层名走 R2 保留名 `Thumb`（不变量：变量名与响应字段仍是 knob，见 api 兼容）
    name: 'Thumb',
    width: knobSize,
    height: knobSize,
    fills: [solidFill(knobColor)],
    effects: [dropShadow('#00000026', { x: 0, y: 1 }, 2)],
    x: knobX,
    y: knobGap,
  }, frame.id)

  mg.commitUndo()
  return { success: true, frame: serializeNode(frame), knob: serializeNode(knob), checked }
}

export function renderProgress(params: any): any {
  const t = mergeTheme(params.theme)
  const width = params.size?.width ?? 300
  const height = params.size?.height ?? t.progressHeight
  const percent = Math.max(0, Math.min(100, params.percent ?? 60))
  const showLabel = params.showLabel !== false

  const frame = makeNode('frame', {
    // R4：无 variant 的类型用单段根名（`ProgressBar` 与 Penpot 侧 `Progress` 漂移）
    name: params.name || 'Progress',
    width,
    height: showLabel ? height + 22 : height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  const track = makeNode('frame', {
    name: 'Track',
    width,
    height,
    x: 0, y: 0,
    cornerRadius: params.size?.cornerRadius ?? t.progressCornerRadius,
    fills: [solidFill(t.progressTrackColor)],
    clipsContent: true,
  }, frame.id)

  const fillW = Math.round(width * percent / 100)
  const fill = makeNode('frame', {
    name: 'Fill',
    width: Math.max(fillW, 4),
    height,
    x: 0, y: 0,
    cornerRadius: params.size?.cornerRadius ?? t.progressCornerRadius,
    fills: [solidFill(params.fillColor || t.progressFillColor)],
  }, track.id)

  if (showLabel) {
    makeNode('text', {
      name: 'Label',
      characters: `${percent}%`,
      fontSize: 12,
      fontName: { family: 'Inter', style: 'Medium' },
      fills: [solidFill(t.textPrimary)],
      textAlignHorizontal: 'RIGHT',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: width - 40,
      y: height + 4,
    }, frame.id)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), track: serializeNode(track), fill: serializeNode(fill), percent }
}

export function renderDivider(params: any): any {
  const t = mergeTheme(params.theme)
  const isVertical = params.direction === 'vertical'
  const thickness = params.size?.height ?? t.dividerThickness
  const color = params.color || t.dividerColor
  const label = params.label || ''
  const length = isVertical ? (params.size?.height ?? 120) : (params.size?.width ?? 300)

  if (isVertical) {
    const line = makeNode('rectangle', {
      name: params.name || 'Divider',
      width: thickness,
      height: length,
      x: params.position?.x ?? 100,
      y: params.position?.y ?? 100,
      fills: [solidFill(color)],
    })
    mg.commitUndo()
    return { success: true, divider: serializeNode(line) }
  }

  const frame = makeNode('frame', {
    name: params.name || 'Divider',
    width: length,
    height: label ? 28 : thickness + 12,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  const cy = Math.round(frame.height / 2)
  makeNode('rectangle', {
    name: 'Line',
    width: length,
    height: thickness,
    x: 0,
    y: cy - Math.round(thickness / 2),
    fills: [solidFill(color)],
  }, frame.id)

  if (label) {
    const text = makeNode('text', {
      name: 'Label',
      characters: label,
      fontSize: 12,
      fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill(t.dividerLabelColor)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, frame.id)
    text.x = Math.round((length - text.width) / 2)
    text.y = Math.round((frame.height - text.height) / 2)

    const bgW = text.width + 20
    makeNode('rectangle', {
      name: 'LabelBg',
      width: bgW,
      height: frame.height - 6,
      x: Math.round((length - bgW) / 2),
      y: 3,
      cornerRadius: 2,
      fills: [solidFill(t.dividerLabelBg)],
    }, frame.id)
    // Reorder: bg behind text (text was created after bg but must be on top)
    // MasterGo auto-layers by creation order; bg created before text is behind. Fine.
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderTag(params: any): any {
  const t = mergeTheme(params.theme)
  const label = params.label || 'Tag'
  const variant = params.variant || 'default'
  const height = params.size?.height ?? t.tagHeight
  const fontSize = params.size?.fontSize ?? t.tagFontSize
  const paddingX = params.size?.paddingX ?? t.tagPaddingX

  const tagVariants: Record<string, { bg: string; text: string }> = {
    default: { bg: t.tagDefaultBg, text: t.tagDefaultText },
    primary: { bg: t.tagPrimaryBg, text: t.tagPrimaryText },
    success: { bg: t.tagSuccessBg, text: t.tagSuccessText },
    warning: { bg: t.tagWarningBg, text: t.tagWarningText },
    danger: { bg: t.tagDangerBg, text: t.tagDangerText },
  }
  const v = tagVariants[variant] || tagVariants.default
  const closable = params.closable !== false

  const text = makeNode('text', {
    name: 'Label',
    characters: label,
    fontSize,
    fontName: { family: 'Inter', style: 'Regular' },
    fills: [solidFill(v.text)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  })
  const tw = text.width
  const th = text.height
  const closeW = closable ? 14 : 0
  const totalW = tw + paddingX * 2 + closeW + (closable ? 4 : 0)

  const frame = makeNode('frame', {
    name: `Tag-${variant}`,
    width: totalW,
    height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.tagCornerRadius,
    fills: [solidFill(v.bg)],
    clipsContent: true,
  })
  frame.appendChild(text)
  text.x = paddingX
  text.y = Math.round((height - th) / 2)

  if (closable) {
    const cx = totalW - paddingX - 7
    const cy = Math.round(height / 2)
    makeNode('pen', {
      name: 'Close',
      svgPathData: 'M0 0L4 4M4 0L0 4',
      strokes: [solidFill(v.text, 1)],
      strokeWeight: 1.5,
      strokeCap: 'ROUND',
      width: 4, height: 4,
      x: cx - 2, y: cy - 2,
    }, frame.id)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), text: serializeNode(text) }
}

export function renderTooltip(params: any): any {
  const t = mergeTheme(params.theme)
  const label = params.label || '提示文字'
  const fontSize = params.size?.fontSize ?? t.tooltipFontSize
  const padding = params.size?.paddingX ?? t.tooltipPadding

  // Measure text
  const textNode = makeNode('text', {
    // R2 保留名 `Label`（`Measure` 是测量期的旧名，节点本身就是可见文案）
    name: 'Label',
    characters: label,
    fontSize,
    fontName: { family: 'Inter', style: 'Regular' },
    fills: [solidFill(t.tooltipTextColor)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  })
  const tw = textNode.width
  const th = textNode.height

  const frame = makeNode('frame', {
    name: params.name || 'Tooltip',
    width: tw + padding * 2,
    height: th + padding * 1.2,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.tooltipCornerRadius,
    fills: [solidFill(t.tooltipBg)],
    clipsContent: true,
  })
  frame.appendChild(textNode)
  textNode.x = Math.round((frame.width - tw) / 2)
  textNode.y = Math.round((frame.height - th) / 2)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), text: serializeNode(textNode) }
}

export async function renderSpinner(params: any): Promise<any> {
  const t = mergeTheme(params.theme)
  const size = params.size?.width ?? t.spinnerSize
  const color = params.color || t.spinnerColor
  const showTrack = params.showTrack !== false
  const showLabel = params.showLabel || ''

  const frame = makeNode('frame', {
    name: params.name || 'Spinner',
    width: size,
    height: size + (showLabel ? 20 : 0),
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  if (showTrack) {
    await renderSvgIcon(SPINNER_TRACK, size, t.spinnerTrackColor, frame.id, 0, 0, 'Track')
  }

  await renderSvgIcon(SPINNER_ARC, size, color, frame.id, 0, 0, 'Arc')

  if (showLabel) {
    const text = makeNode('text', {
      name: 'Label',
      characters: showLabel,
      fontSize: 11,
      fontName: { family: 'Inter', style: 'Medium' },
      fills: [solidFill(t.textPrimary)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: size,
    }, frame.id)
    text.x = Math.round((size - text.width) / 2)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderSkeleton(params: any): any {
  const variant = params.variant || 'text'
  const width = params.size?.width ?? 200
  const height = params.size?.height ?? 20
  const rows = params.rows ?? 1
  const rowGap = params.size?.rowGap ?? 8
  const cornerRadius = params.size?.cornerRadius ?? 4

  const totalH = rows * height + (rows - 1) * rowGap

  const frame = makeNode('frame', {
    name: params.name || 'Skeleton',
    width,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
    clipsContent: false,
  })

  for (let i = 0; i < rows; i++) {
    const y = i * (height + rowGap)
    const rowW = variant === 'circle' ? height : width
    const rowRadius = variant === 'circle' ? height / 2 : cornerRadius
    const rowH = variant === 'circle' ? height : height

    makeNode('frame', {
      name: `Row-${i}`,
      width: rowW,
      height: rowH,
      x: 0,
      y,
      cornerRadius: rowRadius,
      fills: [solidFill('#E8E8E8')],
      clipsContent: true,
    }, frame.id)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

