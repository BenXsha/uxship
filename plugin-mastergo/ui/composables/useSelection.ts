import { ref } from 'vue'

export interface SelectionElement {
  id: string
  type: string
  name: string
}

export interface SelectionState {
  count: number
  layerIds: string[]
  details: SelectionElement[]
}

export function useSelection() {
  const selectedElements = ref<SelectionState>({
    count: 0,
    layerIds: [],
    details: [],
  })

  function updateSelection(data: Partial<SelectionState>) {
    selectedElements.value = {
      count: data.count || 0,
      layerIds: data.layerIds || [],
      details: data.details || [],
    }
  }

  function clearSelection() {
    selectedElements.value = {
      count: 0,
      layerIds: [],
      details: [],
    }
  }

  function hasSelection(): boolean {
    return selectedElements.value.count > 0
  }

  return {
    selectedElements,
    updateSelection,
    clearSelection,
    hasSelection,
  }
}
