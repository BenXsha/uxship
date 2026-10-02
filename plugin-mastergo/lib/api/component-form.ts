/**
 * 组件渲染处理器
 *
 * 高阶组件 API：将原子组件（checkbox/radio/button/input）的创建封装为一次调用。
 * 遵循 B1 方案（Token 参数注入），提供最佳实践默认值，支持 theme 覆盖。
 */

import { mergeTheme } from './design-theme'
import { solidFill, dropShadow, makeNode, serializeNode, getSize, SizeTier, StateConfig, buildCheckboxRadioStates } from './component-utils'

// ─── 表单组件 — 复选框组/单项、单选组/单项、输入框、选择器、滑块 ───

export function renderCheckboxGroup(params: any): any {
  const t = mergeTheme(params.theme)
  const states = params.states || buildCheckboxRadioStates(t)
  const rows: any[] = []

  // 容器
  const container = makeNode('frame', {
    name: params.name || 'CheckboxGroup',
    width: t.containerWidth,
    height: 320,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: t.containerCornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  // Title
  const titleLabel = params.title || 'Checkbox 复选框状态'
  const title = makeNode('text', {
    name: 'Title',
    characters: titleLabel,
    fontSize: t.titleSize,
    fontName: t.titleFont,
    fills: [solidFill(t.textTitle)],
    x: t.containerPadding,
    y: t.containerPadding,
  }, container.id)

  // 每行
  const startY = t.containerPadding + (t.titleSize * 1.5)
  const checkboxIds: string[] = []

  states.forEach((s: StateConfig, i: number) => {
    const y = startY + i * (t.componentSize + t.rowGap)
    const bg = s.bg
    const stroke = s.stroke
    const textColor = s.textColor

    const cb = makeNode('frame', {
      name: `Checkbox-${s.key}`,
      width: t.componentSize,
      height: t.componentSize,
      x: t.containerPadding,
      y,
      cornerRadius: t.componentCornerRadius,
      fills: [solidFill(bg)],
      strokes: s.checked || s.disabled ? [solidFill(stroke, 1)] : [solidFill(stroke, 1)],
      strokeWeight: t.strokeWeight,
      clipsContent: true,
    }, container.id)
    checkboxIds.push(cb.id)

    const label = makeNode('text', {
      name: `Label-${s.key}`,
      characters: s.label,
      fontSize: t.labelSize,
      fontName: t.labelFont,
      fills: [solidFill(textColor)],
      x: t.colLabelX,
      y,
    }, container.id)

    rows.push({ checkbox: cb.id, label: label.id, state: s.key })
  })

  // Pen 路径（checked 状态）— 挂载到对应 checkbox frame 下
  const penNodes: any[] = []
  states.forEach((s: StateConfig, i: number) => {
    if (!s.checked) return
    const fillColor = s.disabled ? t.checkMarkDisabled : t.checkMark
    const pen = makeNode('pen', {
      name: `Tick-${s.key}`,
      svgPathData: t.penPath,
      fills: [solidFill(fillColor)],
      strokes: [],
      width: 14,
      height: 10,
      x: 1,
      y: 3,
    }, rows[i].checkbox)
    penNodes.push({ id: pen.id, state: s.key })
  })

  mg.commitUndo()

  return {
    success: true,
    container: serializeNode(container),
    title: serializeNode(title),
    rows: rows.map((r, i) => ({ ...r, state: states[i].key })),
    pens: penNodes.map(p => ({ id: p.id, state: p.state })),
  }
}

export function renderRadioGroup(params: any): any {
  const t = mergeTheme(params.theme)
  const states = params.states || buildCheckboxRadioStates(t)
  const rows: any[] = []

  const container = makeNode('frame', {
    name: params.name || 'RadioGroup',
    width: t.containerWidth,
    height: 320,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: t.containerCornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  const titleLabel = params.title || 'Radio 单选框状态'
  const title = makeNode('text', {
    name: 'Title',
    characters: titleLabel,
    fontSize: t.titleSize,
    fontName: t.titleFont,
    fills: [solidFill(t.textTitle)],
    x: t.containerPadding,
    y: t.containerPadding,
  }, container.id)

  const startY = t.containerPadding + (t.titleSize * 1.5)

  states.forEach((s: StateConfig, i: number) => {
    const y = startY + i * (t.componentSize + t.rowGap)
    const bg = s.bg
    const stroke = s.stroke
    const textColor = s.textColor

    const radio = makeNode('frame', {
      name: `Radio-${s.key}`,
      width: t.componentSize,
      height: t.componentSize,
      x: t.containerPadding,
      y,
      cornerRadius: t.radioCornerRadius,
      fills: [solidFill(bg)],
      strokes: [solidFill(stroke, 1)],
      strokeWeight: t.strokeWeight,
      clipsContent: true,
    }, container.id)

    const label = makeNode('text', {
      name: `Label-${s.key}`,
      characters: s.label,
      fontSize: t.labelSize,
      fontName: t.labelFont,
      fills: [solidFill(textColor)],
      x: t.colLabelX,
      y,
    }, container.id)

    rows.push({ radio: radio.id, label: label.id, state: s.key })
  })

  // InnerDot ellipse（checked 状态）
  states.forEach((s: StateConfig, i: number) => {
    if (!s.checked) return
    const y = startY + i * (t.componentSize + t.rowGap)
    makeNode('ellipse', {
      name: 'InnerDot',
      width: t.ellipseSize,
      height: t.ellipseSize,
      x: t.containerPadding + t.ellipsePos.x,
      y: y + t.ellipsePos.y,
      fills: [solidFill(t.checkMark)],
    }, container.id)
  })

  mg.commitUndo()

  return {
    success: true,
    container: serializeNode(container),
    title: serializeNode(title),
    rows: rows.map(r => r),
  }
}

export function renderCheckbox(params: any): any {
  const t = mergeTheme(params.theme)
  const checked = params.checked !== false
  const disabled = params.disabled === true
  const label = params.label || '选项'
  const size = params.size?.width ?? t.componentSize

  const bg = disabled ? (checked ? t.bgDisabledChecked : t.bgDisabled) : (checked ? t.brand : t.bgWhite)
  const stroke = disabled ? t.borderDisabled : (checked ? t.brand : t.border)
  const textColor = disabled ? t.textDisabled : t.textPrimary
  const checkColor = disabled ? t.checkMarkDisabled : t.checkMark

  const frame = makeNode('frame', {
    name: `Checkbox${checked ? '-checked' : ''}${disabled ? '-disabled' : ''}`,
    width: size + 8 + label.length * 7,
    height: size,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  const box = makeNode('frame', {
    name: 'Box',
    width: size,
    height: size,
    x: 0, y: 0,
    cornerRadius: t.componentCornerRadius,
    fills: [solidFill(bg)],
    strokes: [solidFill(stroke, 1)],
    strokeWeight: t.strokeWeight,
    clipsContent: true,
  }, frame.id)

  if (checked) {
    makeNode('pen', {
      name: 'Tick',
      svgPathData: t.penPath,
      fills: [solidFill(checkColor)],
      strokes: [],
      width: Math.round(size * 0.85),
      height: Math.round(size * 0.6),
      x: Math.round((size - size * 0.85) / 2),
      y: Math.round((size - size * 0.6) / 2),
    }, box.id)
  }

  makeNode('text', {
    name: 'Label',
    characters: label,
    fontSize: t.labelSize,
    fontName: t.labelFont,
    fills: [solidFill(textColor)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: size + 8,
    y: Math.round((size - t.labelSize * 1.2) / 2),
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderRadio(params: any): any {
  const t = mergeTheme(params.theme)
  const checked = params.checked !== false
  const disabled = params.disabled === true
  const label = params.label || '选项'
  const size = params.size?.width ?? t.componentSize

  const bg = disabled ? (checked ? t.bgDisabledChecked : t.bgDisabled) : (checked ? t.brand : t.bgWhite)
  const stroke = disabled ? t.borderDisabled : (checked ? t.brand : t.border)
  const textColor = disabled ? t.textDisabled : t.textPrimary
  const dotColor = disabled ? t.checkMarkDisabled : t.checkMark

  const frame = makeNode('frame', {
    name: `Radio${checked ? '-checked' : ''}${disabled ? '-disabled' : ''}`,
    width: size + 8 + label.length * 7,
    height: size,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  const circle = makeNode('frame', {
    name: 'Circle',
    width: size,
    height: size,
    x: 0, y: 0,
    cornerRadius: size / 2,
    fills: [solidFill(bg)],
    strokes: [solidFill(stroke, 1)],
    strokeWeight: t.strokeWeight,
    clipsContent: true,
  }, frame.id)

  if (checked) {
    makeNode('ellipse', {
      name: 'Dot',
      width: t.ellipseSize,
      height: t.ellipseSize,
      x: t.ellipsePos.x,
      y: t.ellipsePos.y,
      fills: [solidFill(dotColor)],
    }, circle.id)
  }

  makeNode('text', {
    name: 'Label',
    characters: label,
    fontSize: t.labelSize,
    fontName: t.labelFont,
    fills: [solidFill(textColor)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: size + 8,
    y: Math.round((size - t.labelSize * 1.2) / 2),
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderTextInput(params: any): any {
  const t = mergeTheme(params.theme)
  const tier: SizeTier = params.size?.tier || 'md'

  const INPUT_SIZES: Record<string, Record<string, unknown>> = {
    sm: { height: t.inputHeightSm, fontSize: 13, paddingX: 10 },
    md: { height: t.inputHeightMd, fontSize: 14, paddingX: t.inputPaddingX },
    lg: { height: t.inputHeightLg, fontSize: 16, paddingX: 14 },
  }

  const size = getSize(tier, INPUT_SIZES, params.size)
  const height = size.height
  const width = params.size?.width ?? 248
  const placeholder = params.placeholder || '请输入内容...'

  const frame = makeNode('frame', {
    name: 'TextInput',
    width,
    height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.componentCornerRadius,
    fills: [solidFill(t.bgWhite)],
    strokes: [solidFill(t.border, 1)],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    clipsContent: true,
  })

  let paddingX = size.paddingX

  // Prefix icon
  if (params.icon) {
    makeNode('text', {
      name: 'Icon',
      characters: params.icon,
      fontSize: size.fontSize + 2,
      fills: [solidFill('#999999')],
      x: paddingX,
      y: Math.round((height - (size.fontSize + 2)) / 2),
    }, frame.id)
    paddingX += size.fontSize + 2 + 6
  }

  // Suffix icon / clear
  if (params.suffix) {
    const sfxW = size.fontSize + 2
    const sfxX = width - size.paddingX - sfxW
    makeNode('text', {
      name: 'Suffix',
      characters: params.suffix,
      fontSize: size.fontSize + 2,
      fills: [solidFill('#999999')],
      x: sfxX,
      y: Math.round((height - sfxW) / 2),
    }, frame.id)
  }

  const text = makeNode('text', {
    name: 'Placeholder',
    characters: placeholder,
    fontSize: size.fontSize,
    fontName: t.labelFont,
    fills: [solidFill('#64748B')],
    textAlignHorizontal: 'LEFT',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: paddingX,
    y: 0,
  }, frame.id)

  text.y = Math.round((height - text.height) / 2)

  mg.commitUndo()

  return {
    success: true,
    frame: serializeNode(frame),
    text: serializeNode(text),
  }
}

export function renderSelect(params: any): any {
  const t = mergeTheme(params.theme)
  const tier: SizeTier = params.size?.tier || 'md'

  const SELECT_SIZES: Record<string, Record<string, unknown>> = {
    sm: { height: t.inputHeightSm, fontSize: 13, paddingX: 10, arrowScale: 0.8 },
    md: { height: t.inputHeightMd, fontSize: 14, paddingX: t.inputPaddingX, arrowScale: 1 },
    lg: { height: t.inputHeightLg, fontSize: 16, paddingX: 14, arrowScale: 1.2 },
  }

  const size = getSize(tier, SELECT_SIZES, params.size)
  const height = size.height
  const width = params.size?.width ?? 200
  const placeholder = params.placeholder || '请选择'

  const frame = makeNode('frame', {
    name: 'Select',
    width,
    height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.componentCornerRadius,
    fills: [solidFill(t.bgWhite)],
    strokes: [solidFill(t.border, 1)],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    clipsContent: true,
  })

  const text = makeNode('text', {
    name: 'Placeholder',
    characters: placeholder,
    fontSize: size.fontSize,
    fontName: t.labelFont,
    fills: [solidFill('#64748B')],
    textAlignHorizontal: 'LEFT',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: size.paddingX, y: 0,
  }, frame.id)
  text.y = Math.round((height - text.height) / 2)

  // Arrow icon (pen path) at right side, scaled per tier
  const arrowScale = size.arrowScale
  const areaSize = 20 * arrowScale
  const penW = 10.73 * arrowScale
  const penH = 6.78 * arrowScale
  const areaX = width - areaSize - size.paddingX
  const areaY = Math.round((height - areaSize) / 2)
  const penX = areaX + Math.round((areaSize - penW) / 2)
  const penY = areaY + Math.round((areaSize - penH) / 2)
  const arrow = makeNode('pen', {
    name: 'Arrow',
    svgPathData: 'M1.41421 0L6.36391 4.94972L11.3137 0L12.7279 1.41421L6.36391 7.77822L0 1.41421L1.41421 0Z',
    fills: [solidFill('#A6A6A6')],
    strokes: [],
    width: penW,
    height: penH,
    x: penX,
    y: penY,
  }, frame.id)

  mg.commitUndo()
  return { success: true, frame: serializeNode(frame), text: serializeNode(text), arrow: serializeNode(arrow) }
}

export function renderSlider(params: any): any {
  const t = mergeTheme(params.theme)
  const width = params.size?.width ?? 260
  const trackH = params.size?.height ?? t.sliderTrackHeight
  const handleSize = params.handleSize ?? t.sliderHandleSize
  const percent = Math.max(0, Math.min(100, params.percent ?? 50))

  const frame = makeNode('frame', {
    name: params.name || 'Slider',
    width,
    height: Math.max(trackH, handleSize) + 4,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  const trackY = Math.round((frame.height - trackH) / 2)
  const track = makeNode('frame', {
    name: 'Track',
    width,
    height: trackH,
    x: 0,
    y: trackY,
    cornerRadius: trackH / 2,
    fills: [solidFill(t.sliderTrackColor)],
    clipsContent: true,
  }, frame.id)

  const fillW = Math.round(width * percent / 100)
  const fill = makeNode('frame', {
    name: 'Fill',
    width: fillW,
    height: trackH,
    x: 0, y: 0,
    cornerRadius: trackH / 2,
    fills: [solidFill(t.sliderFillColor)],
  }, track.id)

  const handleX = Math.round(width * percent / 100) - Math.round(handleSize / 2)
  const handleY = Math.round((frame.height - handleSize) / 2)
  const handle = makeNode('ellipse', {
    // 图层名走 R2 保留名 `Thumb`（与 toggle 同一语义；变量名/响应字段仍为 handle）
    name: 'Thumb',
    width: handleSize,
    height: handleSize,
    x: handleX,
    y: handleY,
    fills: [solidFill(t.sliderHandleColor)],
    strokes: [solidFill(t.sliderHandleBorder, 1)],
    strokeWeight: 2,
    effects: [dropShadow('#00000026', { x: 0, y: 2 }, 4)],
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), track: serializeNode(track), fill: serializeNode(fill), handle: serializeNode(handle), percent }
}

