import type {
  ConfiguredExportSource,
  NamingRuleCfg,
  TwoLevelFolderCfg,
} from '~/lib/kit/export'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export interface ExportWorkflowOptions {
  readonly source: ConfiguredExportSource
  readonly structure?: TwoLevelFolderCfg
  readonly naming?: NamingRuleCfg
}

export interface ExportWorkflow extends ExportWorkflowOptions {
  readonly id: string
}

export const useExportWorkflowsStore = defineStore('export-workflows', () => {
  const workflows = shallowRef<Readonly<Record<string, ExportWorkflow>>>({})

  function register(id: string, options: ExportWorkflowOptions): ExportWorkflow {
    const workflow: ExportWorkflow = { id, ...options }
    workflows.value = { ...workflows.value, [id]: workflow }
    return workflow
  }

  function get(id: string): ExportWorkflow | undefined {
    return workflows.value[id]
  }

  function remove(id: string) {
    if (!(id in workflows.value))
      return

    const next = { ...workflows.value }
    delete next[id]
    workflows.value = next
  }

  return {
    workflows,
    register,
    get,
    remove,
  }
})
