/**
 * DSL 规范定义
 * 
 * 提供DSL数据结构的详细说明，用于告知调用MCP的agent和大模型如何生成对应的信息
 */

export interface DSLSpec {
  version: string
  description: string
  elements: ElementSpec[]
  commonProperties: CommonPropertySpec[]
  properties: PropertySpec[]
  examples: DSLExample[]
  colorFormat: string
  coordinateSystem: string
  unitSpecification: UnitSpec[]
  bestPractices: string[]
}

export interface ElementSpec {
  type: string
  description: string
  requiredProperties: string[]
  optionalProperties: PropertySpec[]
  example?: any
}

export interface PropertySpec {
  name: string
  type: string
  description: string
  required?: boolean
  defaultValue?: any
  enum?: string[]
}

export interface CommonPropertySpec {
  name: string
  type: string
  description: string
  required: boolean
  defaultValue?: any
  enum?: string[]
}

export interface DSLExample {
  name: string
  description: string
  dsl: any
}

export interface UnitSpec {
  propertyType: string
  unit: string
  description: string
}

export const DSL_SPEC: DSLSpec = {
  version: '2.0',
  description: 'uxship MCP DSL规范，定义了从MasterGo节点转换为DSL格式的数据结构。注意：钢笔路径元素在DSL中使用 type: "pen"（也接受 "path" 作为别名），而不是 "vector"。',
  commonProperties: [
    {
      name: 'type',
      type: 'string',
      description: '元素类型',
      required: true
    },
    {
      name: 'name',
      type: 'string',
      description: '元素名称',
      required: true
    },
    {
      name: 'id',
      type: 'string',
      description: '元素唯一标识符',
      required: false
    },
    {
      name: 'isVisible',
      type: 'boolean',
      description: '元素是否可见',
      required: false,
      defaultValue: true
    },
    {
      name: 'isLocked',
      type: 'boolean',
      description: '元素是否锁定',
      required: false,
      defaultValue: false
    },
    {
      name: 'position',
      type: '{ x: number, y: number }',
      description: '元素位置（单位：像素）',
      required: false,
      defaultValue: { x: 0, y: 0 }
    },
    {
      name: 'size',
      type: '{ width: number, height: number }',
      description: '元素尺寸（单位：像素）',
      required: false
    },
    {
      name: 'rotation',
      type: 'number',
      description: '旋转角度（度数）',
      required: false,
      defaultValue: 0
    },
    {
      name: 'fills',
      type: 'Fill[]',
      description: '填充样式数组',
      required: false
    },
    {
      name: 'strokes',
      type: 'Stroke[]',
      description: '描边样式数组',
      required: false
    },
    {
      name: 'strokeWidth',
      type: 'number',
      description: '描边宽度（像素）',
      required: false,
      defaultValue: 1
    },
    {
      name: 'effects',
      type: 'Effect[]',
      description: '效果数组（阴影、模糊等）',
      required: false
    },
    {
      name: 'opacity',
      type: 'number',
      description: '透明度（0-1）',
      required: false,
      defaultValue: 1
    },
    {
      name: 'constraints',
      type: 'Constraints',
      description: '布局约束',
      required: false
    },
    {
      name: 'blendMode',
      type: 'string',
      description: '混合模式',
      required: false,
      defaultValue: 'PASS_THROUGH',
      enum: ['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN', 'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']
    }
  ],
  elements: [
    {
      type: 'rectangle',
      description: '矩形元素',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'cornerRadius', type: 'number', description: '圆角半径（像素）', defaultValue: 0 },
        { name: 'cornerSmooth', type: 'number', description: '圆角平滑度', defaultValue: 0 },
        { name: 'topLeftRadius', type: 'number', description: '左上角圆角半径', defaultValue: 0 },
        { name: 'topRightRadius', type: 'number', description: '右上角圆角半径', defaultValue: 0 },
        { name: 'bottomLeftRadius', type: 'number', description: '左下角圆角半径', defaultValue: 0 },
        { name: 'bottomRightRadius', type: 'number', description: '右下角圆角半径', defaultValue: 0 }
      ],
      example: {
        type: 'rectangle',
        name: '卡片背景',
        position: { x: 100, y: 100 },
        size: { width: 300, height: 200 },
        fills: [
          {
            type: 'solid',
            color: '#FFFFFF',
            isVisible: true,
            alpha: 1,
            blendMode: 'NORMAL',
            name: '白色背景'
          }
        ],
        cornerRadius: 16,
        strokes: [
          {
            type: 'solid',
            color: '#E5E7EB',
            isVisible: true,
            alpha: 1,
            blendMode: 'NORMAL',
            name: '边框'
          }
        ],
        strokeWidth: 1,
        effects: [
          {
            type: 'DROP_SHADOW',
            radius: 20,
            offset: { x: 0, y: 8 },
            color: '#00000033',
            visible: true,
            blendMode: 'NORMAL',
            spread: 0,
            showShadowBehindNode: false,
            isEffectShow: true
          }
        ]
      }
    },
    {
      type: 'text',
      description: '文本元素',
      requiredProperties: ['type', 'name', 'content'],
      optionalProperties: [
        { name: 'fontSize', type: 'number', description: '字体大小（像素）', defaultValue: 16 },
        { name: 'fontWeight', type: 'number', description: '字体粗细（100-900）', defaultValue: 400 },
        { name: 'fontName', type: '{ family: string, style: string }', description: '字体名称' },
        { name: 'textAlignHorizontal', type: 'string', description: '水平对齐', defaultValue: 'LEFT', enum: ['LEFT', 'CENTER', 'RIGHT'] },
        { name: 'textAlignVertical', type: 'string', description: '垂直对齐', defaultValue: 'TOP', enum: ['TOP', 'CENTER', 'BOTTOM'] },
        { name: 'textAutoResize', type: 'string', description: '文本自动调整大小', defaultValue: 'NONE' },
        { name: 'lineHeight', type: '{ unit: string, value: number }', description: '行高' },
        { name: 'letterSpacing', type: 'number', description: '字间距（像素）', defaultValue: 0 },
        { name: 'paragraphSpacing', type: 'number', description: '段落间距', defaultValue: 0 },
        { name: 'textDecoration', type: 'string', description: '文本装饰' },
        { name: 'textCase', type: 'string', description: '文本大小写' },
        { name: 'textSegments', type: 'TextSegment[]', description: '分段文本着色：不同颜色片段，每段含 start/end 偏移和 fills' }
      ],
      example: {
        type: 'text',
        name: '标题文本',
        content: '欢迎使用 UXGen',
        position: { x: 120, y: 130 },
        fontSize: 24,
        fontWeight: 600,
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'CENTER',
        lineHeight: { unit: 'PIXELS', value: 32 },
        letterSpacing: 1.5,
        fills: [
          {
            type: 'solid',
            color: '#111827',
            isVisible: true,
            alpha: 1,
            blendMode: 'NORMAL',
            name: '文本颜色'
          }
        ]
      }
    },
    {
      type: 'frame',
      description: '框架元素，用于组织和布局其他元素',
      requiredProperties: ['type', 'name', 'children'],
      optionalProperties: [
        { name: 'cornerRadius', type: 'number', description: '圆角半径（像素）', defaultValue: 0 },
        { name: 'layoutMode', type: 'string', description: '布局模式', defaultValue: 'NONE', enum: ['NONE', 'VERTICAL', 'HORIZONTAL'] },
        { name: 'itemSpacing', type: 'number', description: '子元素间距（像素）', defaultValue: 0 },
        { name: 'paddingTop', type: 'number', description: '上内边距（像素）', defaultValue: 0 },
        { name: 'paddingBottom', type: 'number', description: '下内边距（像素）', defaultValue: 0 },
        { name: 'paddingLeft', type: 'number', description: '左内边距（像素）', defaultValue: 0 },
        { name: 'paddingRight', type: 'number', description: '右内边距（像素）', defaultValue: 0 },
        { name: 'clipsContent', type: 'boolean', description: '是否裁剪内容', defaultValue: false },
        { name: 'primaryAxisAlignItems', type: 'string', description: '主轴对齐', defaultValue: 'MIN', enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'] },
        { name: 'counterAxisAlignItems', type: 'string', description: '交叉轴对齐', defaultValue: 'MIN', enum: ['MIN', 'CENTER', 'MAX'] },
        { name: 'counterAxisAlignContent', type: 'string', description: '交叉轴内容对齐', defaultValue: 'AUTO', enum: ['AUTO', 'SPACE_BETWEEN'] },
        { name: 'crossAxisSpacing', type: 'number', description: '交叉轴间距（像素）', defaultValue: 0 },
        { name: 'primaryAxisSizingMode', type: 'string', description: '主轴尺寸模式', defaultValue: 'FIXED', enum: ['FIXED', 'AUTO'] },
        { name: 'counterAxisSizingMode', type: 'string', description: '交叉轴尺寸模式', defaultValue: 'FIXED', enum: ['FIXED', 'AUTO'] },
        { name: 'flexWrap', type: 'string', description: '是否折行', defaultValue: 'NO_WRAP', enum: ['NO_WRAP', 'WRAP'] }
      ],
      example: {
        type: 'frame',
        name: '卡片框架',
        position: { x: 150, y: 50 },
        size: { width: 300, height: 180 },
        fills: [
          {
            type: 'solid',
            color: '#FFFFFF',
            isVisible: true,
            alpha: 1,
            blendMode: 'NORMAL',
            name: '白色背景'
          }
        ],
        cornerRadius: 16,
        layoutMode: 'VERTICAL',
        itemSpacing: 12,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 20,
        paddingRight: 20,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        clipsContent: true,
        children: []
      }
    },
    {
      type: 'group',
      description: '组元素，用于组合多个元素',
      requiredProperties: ['type', 'name', 'children'],
      optionalProperties: []
    },
    {
      type: 'component',
      description: '组件元素，可复用的元素集合',
      requiredProperties: ['type', 'name', 'children'],
      optionalProperties: [
        { name: 'alias', type: 'string', description: '组件别名' },
        { name: 'description', type: 'string', description: '组件描述' }
      ]
    },
    {
      type: 'ellipse',
      description: '椭圆元素',
      requiredProperties: ['type', 'name'],
      optionalProperties: []
    },
    {
      type: 'polygon',
      description: '多边形元素',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'pointCount', type: 'number', description: '边数（≥3）', defaultValue: 3 },
        { name: 'cornerRadius', type: 'number', description: '圆角半径（像素）', defaultValue: 0 }
      ]
    },
    {
      type: 'star',
      description: '星形元素',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'pointCount', type: 'number', description: '星角数量（≥3）', defaultValue: 5 },
        { name: 'innerRadius', type: 'number', description: '内径比例（0-1）', defaultValue: 0.5 }
      ]
    },
    {
      type: 'line',
      description: '线条元素',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'strokeCap', type: 'string', description: '描边端点样式', defaultValue: 'NONE', enum: ['NONE', 'ROUND', 'SQUARE', 'LINE_ARROW', 'TRIANGLE_ARROW', 'ROUND_ARROW'] },
        { name: 'strokeJoin', type: 'string', description: '描边连接样式', defaultValue: 'MITER', enum: ['MITER', 'BEVEL', 'ROUND'] }
      ]
    },
    {
      type: 'pen',
      description: '钢笔路径元素（也接受 type: "path" 作为别名）。用于绘制任意形状的路径。如果需要绘制 SVG 路径，使用 svgPathData 属性；如果有点数据，使用 pathData 属性。',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'svgPathData', type: 'string', description: 'SVG路径数据（SVG path d 属性格式），例如 "M 0 0 L 100 100 C 150 100 200 150 200 200"' },
        { name: 'pathData', type: 'string | PathPoint[]', description: '路径数据，可以是 SVG path 命令字符串（如 "M6,84 L6,36..."）或路径点对象数组' },
        { name: 'isClosed', type: 'boolean', description: '是否闭合路径', defaultValue: false },
        { name: 'strokeCap', type: 'string', description: '描边端点样式', defaultValue: 'NONE', enum: ['NONE', 'ROUND', 'SQUARE', 'LINE_ARROW', 'TRIANGLE_ARROW', 'ROUND_ARROW'] },
        { name: 'strokeJoin', type: 'string', description: '描边连接样式', defaultValue: 'MITER', enum: ['MITER', 'BEVEL', 'ROUND'] }
      ]
    },
    {
      type: 'boolean_operation',
      description: '布尔运算元素',
      requiredProperties: ['type', 'name', 'booleanOperation', 'children'],
      optionalProperties: [
        { name: 'booleanOperation', type: 'string', description: '布尔运算类型', enum: ['UNION', 'INTERSECT', 'SUBTRACT', 'EXCLUDE'] }
      ]
    },
    {
      type: 'template-ref',
      description: '模板引用，用于引用已定义的模板（如 "table"、"grid" 等）',
      requiredProperties: ['type', 'name', 'ref'],
      optionalProperties: [
        { name: 'overrides', type: 'object', description: '覆盖配置' }
      ]
    },
    {
      type: 'template',
      description: '模板定义，用于生成结构化布局（表格、网格、列表、表单、分页、轮播）',
      requiredProperties: ['type', 'name', 'template', 'config'],
      optionalProperties: [
        { name: 'template', type: 'string', description: '模板类型', enum: ['grid', 'table', 'list', 'form', 'pagination', 'carousel'] },
        { name: 'data', type: 'array', description: '数据源，用于填充模板内容' },
        { name: 'config', type: 'object', description: '模板配置，不同类型有不同配置项' }
      ]
    },
    {
      type: 'tree',
      description: '树形结构组件，支持递归嵌套、展开/折叠图标、连接线和样式定制',
      requiredProperties: ['type', 'name', 'data', 'config'],
      optionalProperties: [
        { name: 'data', type: 'TreeData[]', description: '树形数据，每个节点包含 id, label, children, expanded, selected, disabled, icon' },
        { name: 'config', type: 'TreeConfig', description: '树形配置：itemHeight, indentSize, showIcon, showExpandIcon, expandIconPosition, nodeStyle, labelStyle, lineStyle 等' }
      ]
    },
    {
      type: 'generator',
      description: '生成器，用于批量生成元素',
      requiredProperties: ['type', 'name', 'generatorType', 'config'],
      optionalProperties: []
    },
    {
      type: 'instance',
      description: '组件实例。三种引用方式（优先级：componentUkey → componentId → componentName）：1) componentUkey 引用团队组件库（团队库）组件，由 mg.importComponentByKeyAsync 导入后实例化；2) componentId 引用当前文档已存在的 Component Master；3) componentName 按名称在当前文档全页搜索。均未命中时 fallback 为普通 frame。HTML 侧对应属性：data-library-ukey / data-component-id / data-component-name，不支持 fills/strokes 等样式覆盖——实例继承组件 Master 的样式，可用 overrides 覆写子节点。传入 swapNodeIds（HTML：data-swap-node-id）时切换为「换组件」模式：不新建节点——目标为 INSTANCE 时替换其主组件，非实例对象（frame/矩形/文本…）则被原位替换为组件实例。',
      requiredProperties: ['type', 'name'],
      optionalProperties: [
        { name: 'componentUkey', type: 'string', description: '团队组件库组件的 ukey（从 team_component_search 获取）。组件集会自动落到 componentVariant 指定的 variant 或第一个 variant' },
        { name: 'componentLibrary', type: 'string', description: '团队库名（可选，仅作为来源标注）' },
        { name: 'componentVariant', type: 'string', description: '组件集 variant 名称片段，如 "Selected"、"Hover"' },
        { name: 'variantProperties', type: 'object', description: '组件集变体属性覆写，如 {"State":"Hover"}，实例创建后调用 setVariantPropertyValues' },
        { name: 'componentId', type: 'string', description: '组件 Master 的 ID，精确引用' },
        { name: 'componentName', type: 'string', description: '组件 Master 的名称，用于按名称查找降级' },
        { name: 'overrides', type: 'object', description: '实例子节点覆写：{ "子节点名": { "text"?/"fill"?/"visible"? } }' },
        { name: 'isExpandedInstance', type: 'boolean', description: '是否展开实例；true 时忽略 children，仅创建实例本身', defaultValue: false },
        { name: 'swapNodeIds', type: 'string[]', description: '换组件模式：已有节点 ID 列表（HTML：data-swap-node-id="1:2,3:4"）。非空时不创建新实例：目标为 INSTANCE 则替换其主组件，目标为 frame/矩形/文本等非实例对象则原位替换为组件实例（保持父容器与图层顺序，继承位置/宽高，按图层名带过文字，删除原对象）' },
        { name: 'swapKeepSize', type: 'boolean', description: '换主组件后保持实例原有宽高（HTML：data-swap-keep-size）；非实例对象原位替换时默认保持', defaultValue: false },
        { name: 'swapResetOverrides', type: 'boolean', description: '换主组件后重置实例的直接覆写（HTML：data-swap-reset-overrides）', defaultValue: false },
        { name: 'swapKeepOriginal', type: 'boolean', description: '目标不是实例时是否保留原对象（HTML：data-swap-keep-original，默认 false 即删除原对象）', defaultValue: false }
      ]
    },
    {
      type: 'connector',
      description: '连接线元素，在两个节点或坐标之间绘制连线。支持弹性/直线/曲线三种类型，并可独立设置两端箭头。起点/终点支持节点绑定(移动节点时连线跟随)或自由坐标。',
      requiredProperties: ['type', 'name', 'connectorStart', 'connectorEnd'],
      optionalProperties: [
        { name: 'connectorStart', type: 'ConnectorEndpoint', description: '起点：{ endpointNodeId?, magnet?, x?, y? }。传 endpointNodeId 绑定节点，传 x/y 设置自由坐标' },
        { name: 'connectorEnd', type: 'ConnectorEndpoint', description: '终点：同起点格式' },
        { name: 'connectorLineType', type: 'string', description: '连线类型', defaultValue: 'STRAIGHT', enum: ['STRAIGHT', 'ELBOWED', 'CURVED'] },
        { name: 'connectorStartStrokeCap', type: 'string', description: '起点箭头样式', defaultValue: 'NONE', enum: ['NONE', 'ARROW_EQUILATERAL', 'LINE_ARROW', 'ROUND_ARROW', 'DIAMOND', 'RING'] },
        { name: 'connectorEndStrokeCap', type: 'string', description: '终点箭头样式', defaultValue: 'NONE', enum: ['NONE', 'ARROW_EQUILATERAL', 'LINE_ARROW', 'ROUND_ARROW', 'DIAMOND', 'RING'] }
      ]
    }
  ],
  properties: [
    {
      name: 'Fill',
      type: 'object',
      description: '填充样式',
      required: false,
      defaultValue: null
    },
    {
      name: 'Stroke',
      type: 'object',
      description: '描边样式',
      required: false,
      defaultValue: null
    },
    {
      name: 'Effect',
      type: 'object',
      description: '效果样式',
      required: false,
      defaultValue: null
    },
    {
      name: 'Constraints',
      type: 'object',
      description: '约束配置',
      required: false,
      defaultValue: null
    },
    {
      name: 'TextSegment',
      type: 'object',
      description: '分段文本，记录片段起止偏移和填充样式',
      required: false,
      defaultValue: null
    },
    {
      name: 'TextSegment.start',
      type: 'number',
      description: '片段起始字符偏移',
      required: true
    },
    {
      name: 'TextSegment.end',
      type: 'number',
      description: '片段结束字符偏移',
      required: true
    },
    {
      name: 'TextSegment.fills',
      type: 'Fill[]',
      description: '片段填充样式数组',
      required: true
    },
    {
      name: 'Fill.solid',
      type: 'object',
      description: '纯色填充',
      required: false
    },
    {
      name: 'Fill.gradient_linear',
      type: 'object',
      description: '线性渐变填充',
      required: false
    },
    {
      name: 'Fill.gradient_radial',
      type: 'object',
      description: '径向渐变填充',
      required: false
    },
    {
      name: 'Fill.image',
      type: 'object',
      description: '图片填充',
      required: false
    },
    {
      name: 'Effect.DROP_SHADOW',
      type: 'object',
      description: '投影效果',
      required: false
    },
    {
      name: 'Effect.INNER_SHADOW',
      type: 'object',
      description: '内阴影效果',
      required: false
    },
    {
      name: 'Effect.LAYER_BLUR',
      type: 'object',
      description: '图层模糊效果',
      required: false
    },
    {
      name: 'Effect.BACKGROUND_BLUR',
      type: 'object',
      description: '背景模糊效果',
      required: false
    }
  ],
  examples: [
    {
      name: '简单矩形',
      description: '一个带有蓝色填充和圆角的矩形',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'rectangle',
            name: '蓝色矩形',
            id: 'rect-1',
            position: { x: 100, y: 100 },
            size: { width: 200, height: 100 },
            cornerRadius: 8,
            fills: [
              {
                type: 'solid',
                color: '#3498db',
                isVisible: true,
                alpha: 1,
                blendMode: 'NORMAL',
                name: '蓝色填充'
              }
            ],
            opacity: 1
          }
        ]
      }
    },
    {
      name: '文本元素',
      description: '一个带有黑色文本的文本框',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'text',
            name: '标题文本',
            id: 'text-1',
            position: { x: 100, y: 100 },
            size: { width: 200, height: 30 },
            content: 'Hello, World!',
            fontSize: 16,
            fontWeight: 400,
            textAlignHorizontal: 'CENTER',
            textAlignVertical: 'CENTER',
            fills: [
              {
                type: 'solid',
                color: '#000000',
                isVisible: true,
                alpha: 1,
                blendMode: 'NORMAL',
                name: '文本颜色'
              }
            ]
          }
        ]
      }
    },
    {
      name: '框架布局',
      description: '一个包含多个子元素的垂直布局框架',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'frame',
            name: '垂直布局',
            id: 'frame-1',
            position: { x: 100, y: 100 },
            size: { width: 300, height: 200 },
            layoutMode: 'VERTICAL',
            itemSpacing: 10,
            paddingTop: 20,
            paddingBottom: 20,
            paddingLeft: 20,
            paddingRight: 20,
            children: [
              {
                type: 'rectangle',
                name: '子元素1',
                id: 'child-1',
                position: { x: 0, y: 0 },
                size: { width: 260, height: 50 },
                fills: [
                  {
                    type: 'solid',
                    color: '#e74c3c',
                    isVisible: true,
                    alpha: 1,
                    blendMode: 'NORMAL',
                    name: '红色填充'
                  }
                ]
              },
              {
                type: 'rectangle',
                name: '子元素2',
                id: 'child-2',
                position: { x: 0, y: 60 },
                size: { width: 260, height: 50 },
                fills: [
                  {
                    type: 'solid',
                    color: '#2ecc71',
                    isVisible: true,
                    alpha: 1,
                    blendMode: 'NORMAL',
                    name: '绿色填充'
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      name: '钢笔路径',
      description: '一个使用 SVG 路径数据绘制的星形路径，展示了 pen 元素的使用方式。注意 type 使用 "pen" 或 "path"',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'pen',
            name: '星形路径',
            position: { x: 100, y: 100 },
            size: { width: 200, height: 200 },
            svgPathData: 'M 100 0 L 130 70 L 200 70 L 145 115 L 165 190 L 100 145 L 35 190 L 55 115 L 0 70 L 70 70 Z',
            fills: [
              {
                type: 'solid',
                color: '#FFD700',
                isVisible: true,
                alpha: 1,
                blendMode: 'NORMAL'
              }
            ],
            strokes: [
              {
                type: 'solid',
                color: '#B8860B',
                isVisible: true,
                alpha: 1,
                blendMode: 'NORMAL'
              }
            ],
            strokeWidth: 2,
            strokeCap: 'ROUND',
            strokeJoin: 'ROUND',
            isClosed: true
          }
        ]
      }
    },
    {
      name: '表格模板',
      description: '使用 template 类型生成的用户表格，包含表头和数据行',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'template',
            name: '用户表格',
            template: 'table',
            config: {
              columns: [
                { key: 'name', label: '姓名', width: 120 },
                { key: 'email', label: '邮箱', width: 200 },
                { key: 'role', label: '角色', width: 100 },
                { key: 'status', label: '状态', width: 80 }
              ],
              headerStyle: {
                height: 40,
                fontSize: 13,
                fontWeight: 600,
                fills: [{ type: 'solid', color: '#f9fafb' }]
              },
              rowStyle: {
                height: 48,
                fontSize: 13,
                fills: [{ type: 'solid', color: '#ffffff' }],
                alternatingFills: [{ type: 'solid', color: '#f9fafb' }]
              },
              cornerRadius: 8
            },
            data: [
              { name: '张伟', email: 'zhangwei@example.com', role: '管理员', status: '启用' },
              { name: '李娜', email: 'lina@example.com', role: '编辑者', status: '启用' },
              { name: '王强', email: 'wangqiang@example.com', role: '管理员', status: '禁用' }
            ]
          }
        ]
      }
    },
    {
      name: '树形组件',
      description: '使用 tree 类型生成的组织架构树，带展开/折叠和连接线',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'tree',
            name: '组织架构',
            data: [
              {
                id: '1', label: 'CEO',
                expanded: true,
                children: [
                  { id: '1-1', label: 'CTO', expanded: true, children: [
                    { id: '1-1-1', label: '前端团队' },
                    { id: '1-1-2', label: '后端团队' }
                  ]},
                  { id: '1-2', label: 'COO', children: [
                    { id: '1-2-1', label: '市场部' },
                    { id: '1-2-2', label: '销售部' }
                  ]},
                  { id: '1-3', label: 'CFO' }
                ]
              }
            ],
            config: {
              itemHeight: 36,
              indentSize: 24,
              showExpandIcon: true,
              expandIconPosition: 'left',
              lineStyle: { show: true, color: '#e5e7eb', width: 1 },
              nodeStyle: { fills: [{ type: 'solid', color: '#ffffff' }], cornerRadius: 4 },
              labelStyle: { fontSize: 14, fills: [{ type: 'solid', color: '#1f2937' }] }
            }
          }
        ]
      }
    },
    {
      name: '登录页面',
      description: '完整的登录页面布局',
      dsl: {
        version: '2.0',
        elements: [
          {
            type: 'frame',
            name: '登录页面',
            position: { x: 0, y: 0 },
            size: { width: 375, height: 667 },
            fills: [
              {
                type: 'solid',
                color: '#F9FAFB',
                isVisible: true,
                alpha: 1,
                blendMode: 'NORMAL',
                name: '页面背景'
              }
            ],
            layoutMode: 'VERTICAL',
            paddingTop: 40,
            paddingBottom: 40,
            paddingLeft: 24,
            paddingRight: 24,
            children: [
              {
                type: 'text',
                name: '欢迎标题',
                content: '欢迎回来',
                fontSize: 32,
                fontWeight: 700,
                fills: [
                  {
                    type: 'solid',
                    color: '#111827',
                    isVisible: true,
                    alpha: 1,
                    blendMode: 'NORMAL',
                    name: '标题颜色'
                  }
                ]
              },
              {
                type: 'text',
                name: '欢迎描述',
                content: '请登录您的账户',
                fontSize: 16,
                fills: [
                  {
                    type: 'solid',
                    color: '#6B7280',
                    isVisible: true,
                    alpha: 1,
                    blendMode: 'NORMAL',
                    name: '描述颜色'
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  ],
  colorFormat: '所有颜色值必须使用十六进制格式，支持RGB格式（#RRGGBB）和RGBA格式（#RRGGBBAA）',
  coordinateSystem: '画布左上角为原点(0, 0)，X轴从左向右为正方向，Y轴从上向下为正方向，所有坐标和尺寸单位均为像素（px）',
  unitSpecification: [
    { propertyType: '位置', unit: 'px', description: '像素' },
    { propertyType: '尺寸', unit: 'px', description: '像素' },
    { propertyType: '旋转角度', unit: 'degrees', description: '度数' },
    { propertyType: '字体大小', unit: 'px', description: '像素' },
    { propertyType: '描边宽度', unit: 'px', description: '像素' },
    { propertyType: '字间距', unit: 'px', description: '像素' },
    { propertyType: '行高', unit: 'px / % / AUTO', description: '像素、百分比或自动' },
    { propertyType: '模糊半径', unit: 'px', description: '像素' },
    { propertyType: '透明度', unit: 'ratio', description: '比例（0-1）' }
  ],
  bestPractices: [
    '使用有意义的元素名称，便于调试和维护',
    '尽量使用偶数尺寸，避免半像素渲染问题',
    '使用统一的颜色变量或主题色板',
    '优先使用自动布局（frame/component），减少硬编码位置',
    '将常用设计模式抽象为组件（component）',
    '避免过多的渐变填充和阴影效果，注意性能优化',
    '合理使用透明度',
    '批量创建相似元素时使用循环或模板',
    '添加注释说明设计意图',
    '使用分组（group）组织相关元素',
    '保持DSL结构清晰',
    '钢笔路径元素使用 type: "pen"（或 "path"）并传入 svgPathData（SVG path d 属性格式）',
    '从 MasterGo 导出的路径数据会以 svgPathData 形式提供，可直接用于渲染'
  ]
}
