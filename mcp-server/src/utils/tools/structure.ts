import type { MCPTool } from '../../types/mcp-types.js'

/**
 * 顶层结构查询工具定义
 *
 * 插件方法映射：`node_get_root` → `node/getRoot`（默认下划线→斜杠规则，无需额外登记）。
 *
 * 环境说明（私有化企业版 MasterGoPrivate 1.10.3 实测）：
 * - ✅ `getRootNodeById` / `getRootParentLayerId` 可用
 * - ❌ `getTopContainerInfoListByPageID` 不可用，因此不提供整页顶层容器列表工具
 */
const nodeGetRootTool: MCPTool = {
  name: 'node_get_root',
  description:
    '查一个节点的「根」信息：所属根节点、根父层 id、祖先链（自下而上到所在页面）、页面归属（也可直接传页面 ID 查询）。大文档里定位「这个图层属于哪一层 / 哪一页」时用它。includeSubtree=true 可带子树快照（maxDepth 限深，默认 3）。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要查询的目标节点 ID（必填）' },
      includeSubtree: {
        type: 'boolean',
        description: '是否附带该节点的子树序列化快照（默认 false，只返回根/祖先/页面信息）',
      },
      maxDepth: {
        type: 'number',
        description: '子树递归层数，默认 3（0=仅自身）',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: '只返回这些字段（省上下文）；id 始终返回；见 07-mcp-tools.md',
      },
    },
    required: ['nodeId'],
  },
}

export function getStructureTools(): MCPTool[] {
  return [nodeGetRootTool]
}
