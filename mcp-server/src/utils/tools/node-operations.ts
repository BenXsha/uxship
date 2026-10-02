import type { MCPTool } from '../../types/mcp-types.js'

const NODE_TYPE_ENUM = ['rectangle', 'text', 'frame', 'ellipse', 'component', 'line', 'polygon', 'star', 'pen', 'instance']

const createNodeTool: MCPTool = {
  name: 'node_create',
  description: '创建节点（单体或批量）。单体：传 type + properties；批量：传 nodes 数组（一次提交撤销，比逐个调用更高效）。创建实例时 type="instance" 且 properties 需含 componentId。',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: NODE_TYPE_ENUM,
        description: '节点类型；instance = 从组件创建实例',
      },
      properties: {
        type: 'object',
        description: '初始属性（x/y/宽高/填充/文字…）',
      },
      nodes: {
        type: 'array',
        description: '批量：节点列表（与单体同构，一次提交撤销）',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: NODE_TYPE_ENUM, description: '节点类型；"instance" 需在 properties 里传 componentId' },
            properties: { type: 'object', description: '初始属性（x/y/宽高/填充/文字…）' },
            parentId: { type: 'string', description: '父节点 ID（可选，默认当前页面）' },
          },
          required: ['type'],
        },
      },
    },
    // 合并「单体 / 批量」后顶层 required 丢失，补回二选一约束（透传见 json-schema-to-zod.ts）
    anyOf: [{ required: ['type'] }, { required: ['nodes'] }],
  },
}

const updateNodeTool: MCPTool = {
  name: 'node_update',
  description: '更新节点属性（单体或批量）。单体：nodeId + properties；批量：updates 数组（一次提交撤销，逐项回报：failed:[{index,nodeId,error}]，单项失败不中断）。支持位置、尺寸、填充、描边、效果、文字、圆角等。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '单体更新的节点 ID' },
      properties: { type: 'object', description: '要更新的属性（位置/尺寸/填充/描边/效果…）' },
      updates: {
        type: 'array',
        description: '批量：[{ nodeId, properties }]（给出即走批量路径）',
        items: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: '要更新的节点 ID' },
            properties: { type: 'object', description: '要更新的属性' },
          },
          required: ['nodeId', 'properties'],
        },
      },
    },
    // 单体要 nodeId + properties；批量只需 updates。缺此约束时模型会发空 {} 被拒。
    anyOf: [{ required: ['nodeId', 'properties'] }, { required: ['updates'] }],
  },
}

const deleteNodeTool: MCPTool = {
  name: 'node_delete',
  description: '删除节点（单体或批量）。单体：nodeId；批量：nodeIds 数组（一次提交撤销，并会有通知提示）。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '单体删除的节点 ID' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '批量删除的节点 ID 列表' },
    },
    // 单体 nodeId / 批量 nodeIds 二选一
    anyOf: [{ required: ['nodeId'] }, { required: ['nodeIds'] }],
  },
}

const convertToComponentTool: MCPTool = {
  name: 'node_convert_to_component',
  description: '把已有节点原位转成可复用组件 Master（样式与子层完整保留；keepOriginal:true 则保留原节点）。四种形态择一：nodeId 单个、nodeIds 批量、namePrefix 按名前缀、containerId 按容器直接子层（推荐配 combineVariants）。转换后母版是新 id：响应 componentId 即它。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '形态 A：要转换的单个节点 ID' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '形态 B：批量转换（各自保留名字）' },
      namePrefix: { type: 'string', description: '形态 C：按名前缀建库（只取最外层）' },
      containerId: { type: 'string', description: '形态 D：容器直接子层作用域（变体合成推荐）' },
      name: { type: 'string', description: '仅形态 A：母版名（默认沿用原节点名）' },
      keepOriginal: { type: 'boolean', description: '保留原节点（默认 false：转换后删除）', default: false },
      listOnly: { type: 'boolean', description: '仅列举不转换（配 containerId）' },
      combineVariants: { type: 'boolean', description: '把作用域成员按 <类型>_<轴值> 合成变体集' },
      variantPropertyName: { type: 'string', description: '变体轴名（默认 State）' },
    },
    // 四种形态互斥（择一）：单个 / 批量 / 按名前缀建库 / 按容器子树建库
    anyOf: [{ required: ['nodeId'] }, { required: ['nodeIds'] }, { required: ['namePrefix'] }, { required: ['containerId'] }],
  },
}

const cloneNodeTool: MCPTool = {
  name: 'node_clone',
  description: '克隆节点（含样式、子层与自动布局）。可传 parentId 与 x/y；不传 parentId 则克隆到当前页。响应形如 {success, id, node}——**取 id 请用顶层 id（或 res.node?.id）**，只读 res.id 之外的写法容易取到 undefined。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要克隆的源节点 ID' },
      parentId: { type: 'string', description: '目标父节点 ID（默认当前页面）' },
      x: { type: 'number', description: '克隆后 X 坐标（可选）' },
      y: { type: 'number', description: '克隆后 Y 坐标（可选）' },
      name: { type: 'string', description: '克隆后名称（可选）' },
    },
    required: ['nodeId'],
  },
}

const moveNodeTool: MCPTool = {
  name: 'node_move',
  description: '把节点移到指定父层下（从原父层摘除后插入）。目标父层须支持子元素（frame/component/group）。传 index 时按序号插入（宿主不支持则回退追加到末尾并在 warnings 里说明）；不传则追加到末尾。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要移动的节点 ID' },
      parentId: { type: 'string', description: '目标父节点 ID' },
      index: { type: 'number', description: '插入位置索引（0 起；不传则追加到末尾）' },
    },
    required: ['nodeId', 'parentId'],
  },
}

const swapComponentTool: MCPTool = {
  name: 'node_swap_component',
  description:
    '把对象换成组件。实例 → 换主组件；普通对象 → 原位替换为实例（保父容器与图层顺序、继承位置宽高、按图层名带过文字）。目标组件用 componentId / ukey(团队库自动导入) / component 名指定；不支持替换 COMPONENT(COMPONENT_SET)。不传 nodeId 时对当前选区生效。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要替换的对象节点 ID' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '批量替换的节点 ID 列表' },
      useSelection: { type: 'boolean', description: '不传 ID 时回退当前选区，默认 true', default: true },
      componentId: { type: 'string', description: '文档内组件 ID（最精确）' },
      ukey: { type: 'string', description: '团队库组件 ukey（自动导入）' },
      component: { type: 'string', description: '组件名（本地优先，其次团队库）' },
      library: { type: 'string', description: '配合 component 限定团队库' },
      type: { type: 'string', enum: ['COMPONENT', 'COMPONENT_SET'], description: '目标类型提示：COMPONENT / COMPONENT_SET' },
      variant: { type: 'string', description: '组件集变体名片段（如 Hover）' },
      variantProperties: { type: 'object', description: '变体属性，如 { "State": "Hover" }' },
      properties: { type: 'object', description: '组件属性覆写 { 属性id: 值 }（换 INSTANCE_SWAP 插槽）' },
      resetOverrides: { type: 'boolean', description: '替换后重置实例覆写，默认 false', default: false },
      keepSize: { type: 'boolean', description: '保持替换前宽高（非实例原位替换默认 true）', default: false },
      keepOriginal: { type: 'boolean', description: '非实例替换时保留原对象，默认 false', default: false },
      carryOverOverrides: { type: 'boolean', description: '按图层名继承文字/可见性，默认 true', default: true },
      name: { type: 'string', description: '替换出的实例名（默认沿用原名）' },
      overrides: { type: 'object', description: '子层名覆写{"Label":{"text":"确定"}}；fill限#RGB' },
    },
  },
}

const exportNodeImageTool: MCPTool = {
  name: 'node_export_image',
  description: '将指定节点导出为图片（PNG/JPG/WEBP/SVG/PDF），返回 base64 编码的图片数据（栅格格式）或纯文本（SVG）。支持设置缩放比例或固定宽高导出。传入 saveToPath 时会自动将图片写入文件，并返回文件路径',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要导出的节点 ID' },
      format: { type: 'string', enum: ['PNG', 'JPG', 'WEBP', 'SVG', 'PDF'], description: '导出格式（默认 PNG）' },
      constraint: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['SCALE', 'WIDTH', 'HEIGHT'], description: '约束类型：SCALE=按倍率, WIDTH=固定宽度, HEIGHT=固定高度' },
          value: { type: 'number', description: '约束值（SCALE 默认 1 表示 1x，WIDTH/HEIGHT 为像素值）' },
        },
        description: '导出尺寸约束（可选，默认 1x 缩放）',
      },
      useAbsoluteBounds: { type: 'boolean', description: '是否使用绝对边界（默认 true）' },
      useRenderBounds: { type: 'boolean', description: '是否使用渲染边界（默认 true）' },
      saveToPath: { type: 'string', description: '写入该绝对路径（需在项目目录内）' },
    },
    required: ['nodeId'],
  },
}

const groupNodesTool: MCPTool = {
  name: 'node_group',
  description:
    '把 2 个以上节点打成一个 group（组合）：新组的父容器与图层顺序由宿主决定，组名可用 groupName 指定，不改节点几何。需要 auto-layout 容器时改用 node_create 的 frame；打组后子层仍是原节点，可继续用其它 node_* 工具操作。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: '要打组的节点 ID（至少 2 个）' },
      groupName: { type: 'string', description: '组名称（默认沿用宿主命名）' },
    },
    required: ['nodeIds'],
  },
}

const booleanOperationTool: MCPTool = {
  name: 'node_boolean',
  description:
    '对 2 个以上节点做布尔运算并原地生成结果节点：union（并集）/ subtract（差集：首节点减其余）/ intersect（交集）/ exclude（排除）。运算会消耗原节点、结果不可逆（可撤销），传节点顺序会影响 subtract 结果。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: '参与运算的节点 ID（至少 2 个）' },
      operation: {
        type: 'string',
        enum: ['union', 'subtract', 'intersect', 'exclude'],
        description: '运算类型：并集 / 差集 / 交集 / 排除',
      },
    },
    required: ['nodeIds', 'operation'],
  },
}

const detachInstanceTool: MCPTool = {
  name: 'node_detach_instance',
  description:
    'detach 实例：断开与主组件的关联，实例变成普通 frame 副本，子层可自由改几何 / 增删。**改实例子层几何或结构前必须先 detach**（未 detach 的实例子层只读）。detach 后不再随主组件更新、丢失覆写对应关系（可撤销）。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要 detach 的实例节点 ID' },
    },
    required: ['nodeId'],
  },
}

export function getTools(): MCPTool[] {
  return [
    createNodeTool, updateNodeTool, deleteNodeTool,
    convertToComponentTool, cloneNodeTool, moveNodeTool, swapComponentTool, exportNodeImageTool,
    groupNodesTool, booleanOperationTool,
    detachInstanceTool,
  ]
}
