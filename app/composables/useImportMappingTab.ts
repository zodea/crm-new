import type { OpenWorkflowTabResult } from '~/composables/useWorkflowTab'
import { useWorkflowTab } from '~/composables/useWorkflowTab'

export interface OpenImportTabOptions {
  /** 目标实体键（实体触发、模板隐含，见 ADR 0005），须已在导入实体注册表登记。 */
  entity: string
}

/** 从目标实体列表页打开导入映射页签：/import/mapping/:entity。 */
export function useImportMappingTab() {
  const openWorkflowTab = useWorkflowTab()

  return async function openImportTab(
    options: OpenImportTabOptions,
  ): Promise<OpenWorkflowTabResult> {
    const entityKey = options.entity
    const { getImportEntity } = await import('~/lib/kit/import-entities')
    const entity = getImportEntity(entityKey)
    if (!entity)
      throw new Error(`未登记的导入实体：${entityKey}`)

    return await openWorkflowTab({
      fullPath: `/import/mapping/${entity.key}`,
      title: '导入映射',
    })
  }
}
