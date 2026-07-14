import type { ExportWorkflowOptions } from '~/stores/export-workflows'
import { isNavigationFailure } from 'vue-router'
import { MAX_TABS } from '~/lib/tabs/tab-machine'
import { generateId } from '~/lib/util/id'

export type OpenExportWorkflowTabResult
  = | { status: 'blocked' }
    | { status: 'opened', id: string, fullPath: string }

export function useExportWorkflowTab() {
  const router = useRouter()
  const tabsStore = useTabsStore()
  const workflowsStore = useExportWorkflowsStore()
  const toast = useToast()

  return async function openExportTab(
    options: ExportWorkflowOptions,
  ): Promise<OpenExportWorkflowTabResult> {
    const id = generateId('exp')
    const fullPath = `/export/config/${id}`
    const blocked = tabsStore.open({ fullPath, title: '导出配置' })

    if (blocked) {
      toast.warning(
        `页签已达上限 ${MAX_TABS} 个`,
        '请先关闭不需要的页签',
      )
      return { status: 'blocked' }
    }

    workflowsStore.register(id, options)
    try {
      const failure = await router.push(fullPath)
      if (isNavigationFailure(failure))
        throw failure
    }
    catch (error) {
      workflowsStore.remove(id)
      tabsStore.close(fullPath)
      throw error
    }

    return { status: 'opened', id, fullPath }
  }
}
