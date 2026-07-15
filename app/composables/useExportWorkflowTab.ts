import type { ExportWorkflowOptions } from '~/stores/export-workflows'
import { useWorkflowTab } from '~/composables/useWorkflowTab'
import { generateId } from '~/lib/util/id'

export type OpenExportWorkflowTabResult
  = | { status: 'blocked' }
    | { status: 'opened', id: string, fullPath: string }

export function useExportWorkflowTab() {
  const workflowsStore = useExportWorkflowsStore()
  const openWorkflowTab = useWorkflowTab()

  return async function openExportTab(
    options: ExportWorkflowOptions,
  ): Promise<OpenExportWorkflowTabResult> {
    const id = generateId('exp')
    const fullPath = `/export/config/${id}`

    const result = await openWorkflowTab(
      { fullPath, title: '导出配置' },
      {
        onClaimed: () => workflowsStore.register(id, options),
        onRollback: () => workflowsStore.remove(id),
      },
    )

    return result.status === 'opened'
      ? { status: 'opened', id, fullPath }
      : { status: 'blocked' }
  }
}
