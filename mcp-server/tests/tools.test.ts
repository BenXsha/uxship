import { describe, it, expect } from 'vitest'
import { getToolList, getPluginMethod, resolvePluginMethod, arrayFormMethodMap, isTaskProgressTool, PLUGIN_REGISTERED_METHODS } from '../src/utils/tools.js'
import { resolvePartition } from '../src/utils/partition-router.js'

describe('getToolList', () => {
  it('returns 67 tools', () => {
    const tools = getToolList()
    expect(tools.length).toBe(67)
  })

  it('all tools have name, description, inputSchema', () => {
    const tools = getToolList()
    for (const t of tools) {
      expect(t.name).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.inputSchema).toBeTruthy()
    }
  })

  it('tool names are unique', () => {
    const tools = getToolList()
    const names = tools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('getPluginMethod', () => {
  it('maps node_create to node/create', () => {
    expect(getPluginMethod('node_create')).toBe('node/create')
  })

  it('maps node_batchUpdate to node/batchUpdate', () => {
    expect(getPluginMethod('node_batchUpdate')).toBe('node/batchUpdate')
  })

  it('maps dsl_exportNode to dsl/exportNode', () => {
    expect(getPluginMethod('dsl_exportNode')).toBe('dsl/exportNode')
  })

  it('maps icon_render to dsl/render (special mapping)', () => {
    expect(getPluginMethod('icon_render')).toBe('dsl/render')
  })

  it('returns undefined for design_suggest (local tool)', () => {
    expect(getPluginMethod('design_suggest')).toBeUndefined()
  })

  it('returns undefined for design_to_code (local tool)', () => {
    expect(getPluginMethod('design_to_code')).toBeUndefined()
  })

  it('returns undefined for code_to_design (local tool)', () => {
    expect(getPluginMethod('code_to_design')).toBeUndefined()
  })

  it('maps team_component_import to teamLibrary/importComponent', () => {
    expect(getPluginMethod('team_component_import')).toBe('teamLibrary/importComponent')
  })

  it('maps team_style_import to teamLibrary/importStyle', () => {
    expect(getPluginMethod('team_style_import')).toBe('teamLibrary/importStyle')
  })

  it('returns undefined for team library index tools (server-side)', () => {
    expect(getPluginMethod('team_library_list')).toBeUndefined()
    expect(getPluginMethod('team_component_search')).toBeUndefined()
    expect(getPluginMethod('team_style_list')).toBeUndefined()
    expect(getPluginMethod('team_library_sync')).toBeUndefined()
  })

  it('maps node_swap_component to node/swapComponent', () => {
    expect(getPluginMethod('node_swap_component')).toBe('node/swapComponent')
  })

  it('maps canvas_zoom_to_node to canvas/zoomToNode', () => {
    expect(getPluginMethod('canvas_zoom_to_node')).toBe('canvas/zoomToNode')
  })

  it('maps canvas_zoom_to_rect to canvas/zoomToRect', () => {
    expect(getPluginMethod('canvas_zoom_to_rect')).toBe('canvas/zoomToRect')
  })

  it('maps plugin_capabilities to plugin/capabilities', () => {
    expect(getPluginMethod('plugin_capabilities')).toBe('plugin/capabilities')
  })

  it('maps node_export_batch to node/exportBatch (双下划线段不拆成 node/export/batch)', () => {
    expect(getPluginMethod('node_export_batch')).toBe('node/exportBatch')
  })

  it('maps variable_* to variable/* and node_get_root to node/getRoot', () => {
    expect(getPluginMethod('variable_list')).toBe('variable/list')
    expect(getPluginMethod('variable_create')).toBe('variable/create')
    expect(getPluginMethod('variable_update')).toBe('variable/update')
    expect(getPluginMethod('variable_delete')).toBe('variable/delete')
    expect(getPluginMethod('node_get_root')).toBe('node/getRoot')
  })

  it('maps selection_set to selection/set', () => {
    expect(getPluginMethod('selection_set')).toBe('selection/set')
  })

  it('returns undefined for design_to_code_update (server-side)', () => {
    expect(getPluginMethod('design_to_code_update')).toBeUndefined()
  })

  it('returns undefined for node_convert_to_component (server-orchestrated)', () => {
    // 它在 LOCAL_TOOLS 里：按实参决定转发 1 次（纯建库）或 2 次（listOnly + variantGroups 合成）
    expect(getPluginMethod('node_convert_to_component')).toBeUndefined()
  })

  it('every tool either maps to a registered plugin method or runs server-side', () => {
    const orphaned: string[] = []
    for (const t of getToolList()) {
      const method = getPluginMethod(t.name)
      if (method === undefined) continue // 服务端本地执行
      if (!PLUGIN_REGISTERED_METHODS.has(method)) orphaned.push(`${t.name} → ${method}`)
    }
    expect(orphaned).toEqual([])
  })
})

describe('resolvePluginMethod（合并工具的数组形式选路）', () => {
  it('单体形式走单体插件方法', () => {
    expect(resolvePluginMethod('node_create', { type: 'rectangle' })).toBe('node/create')
    expect(resolvePluginMethod('node_update', { nodeId: '1:1' })).toBe('node/update')
    expect(resolvePluginMethod('node_delete', { nodeId: '1:1' })).toBe('node/delete')
  })

  it('数组形式走批量插件方法（且不落成 node/batch/create）', () => {
    expect(resolvePluginMethod('node_create', { nodes: [{ type: 'text' }] })).toBe('node/batchCreate')
    expect(resolvePluginMethod('node_update', { updates: [{ nodeId: '1:1', properties: {} }] })).toBe('node/batchUpdate')
    expect(resolvePluginMethod('node_delete', { nodeIds: ['1:1', '1:2'] })).toBe('node/batchDelete')
  })

  it('空数组不算批量形式（回退单体路径，避免误路由）', () => {
    expect(resolvePluginMethod('node_create', { nodes: [] })).toBe('node/create')
    expect(resolvePluginMethod('node_delete', { nodeIds: [] })).toBe('node/delete')
  })

  it('选路表里的批量方法都在插件端已注册（防静默转发）', () => {
    for (const entry of Object.values(arrayFormMethodMap())) {
      expect(PLUGIN_REGISTERED_METHODS.has(entry.method), `${entry.method} 未注册`).toBe(true)
    }
  })
})

describe('isTaskProgressTool', () => {
  it('identifies task_plan', () => {
    expect(isTaskProgressTool('task_plan')).toBe(true)
  })

  it('identifies task_step', () => {
    expect(isTaskProgressTool('task_step')).toBe(true)
  })

  it('identifies task_complete', () => {
    expect(isTaskProgressTool('task_complete')).toBe(true)
  })

  it('returns false for regular tools', () => {
    expect(isTaskProgressTool('node_create')).toBe(false)
    expect(isTaskProgressTool('code_to_design')).toBe(false)
  })
})

describe('resolvePartition', () => {
  it('resolves node_create to core', () => {
    expect(resolvePartition('node_create')).toBe('core')
  })

  it('resolves node_swap_component to core', () => {
    expect(resolvePartition('node_swap_component')).toBe('core')
  })

  it('resolves plugin_capabilities to infrastructure', () => {
    expect(resolvePartition('plugin_capabilities')).toBe('infrastructure')
  })

  it('resolves plugin_capabilities to infrastructure', () => {
    expect(resolvePartition('plugin_capabilities')).toBe('infrastructure')
  })

  it('resolves 变量系统到 resources、导出与顶层结构到 core', () => {
    expect(resolvePartition('variable_list')).toBe('resources')
    expect(resolvePartition('variable_create')).toBe('resources')
    expect(resolvePartition('variable_update')).toBe('resources')
    expect(resolvePartition('variable_delete')).toBe('resources')
    expect(resolvePartition('node_export_batch')).toBe('core')
    expect(resolvePartition('node_get_root')).toBe('core')
  })

  it('resolves canvas / selection tools to infrastructure', () => {
    expect(resolvePartition('canvas_zoom_to_node')).toBe('infrastructure')
    expect(resolvePartition('canvas_zoom_to_rect')).toBe('infrastructure')
    expect(resolvePartition('selection_set')).toBe('infrastructure')
  })

  it('resolves code_to_design to design-gen', () => {
    expect(resolvePartition('code_to_design')).toBe('design-gen')
  })

  it('resolves design_suggest to analysis', () => {
    expect(resolvePartition('design_suggest')).toBe('analysis')
  })

  it('resolves component_list to components', () => {
    expect(resolvePartition('component_list')).toBe('components')
  })

  it('resolves team library tools to components / resources', () => {
    expect(resolvePartition('team_library_list')).toBe('components')
    expect(resolvePartition('team_component_search')).toBe('components')
    expect(resolvePartition('team_component_import')).toBe('components')
    expect(resolvePartition('team_library_sync')).toBe('components')
    expect(resolvePartition('team_style_list')).toBe('resources')
    expect(resolvePartition('team_style_import')).toBe('resources')
  })

  it('resolves session_list to infrastructure or resources', () => {
    const partition = resolvePartition('session_list')
    expect(['infrastructure', 'resources']).toContain(partition)
  })

  it('resolves task_plan to infrastructure', () => {
    expect(resolvePartition('task_plan')).toBe('infrastructure')
  })

  it('resolves unknown tool to undefined', () => {
    expect(resolvePartition('unknown_tool')).toBeUndefined()
  })

  it('every tool in getToolList has a partition', () => {
    const tools = getToolList()
    for (const t of tools) {
      const partition = resolvePartition(t.name)
      expect(partition).toBeDefined()
    }
  })
})
