import type { DataOriginDTO } from '../../types/read-model'
import type { ProjectListItemDTO, ProjectListQueryDTO } from '../project/read-contract'
import type { QuantityCatalogProject } from './read-model'
import { quantityProblem } from './central-contract'

export interface QuantityProjectChoice extends Omit<QuantityCatalogProject, 'hasQuantityData'> {
  dataOrigin: DataOriginDTO
  hasQuantityData: boolean | null
}

interface CatalogPage {
  items: { dataOrigin: DataOriginDTO, project: Pick<ProjectListItemDTO['project'], 'id' | 'label'>, code: string }[]
  pagination: { page: number, pageSize: number, total: number }
  sourceVersion: string | null
}

/** 正式项目来自当前中央目录；演示由获授权的只读适配器另行提供。 */
export async function loadQuantityBrowserCatalog(dependencies: {
  list: (query: ProjectListQueryDTO) => Promise<CatalogPage>
  demo: () => Promise<QuantityCatalogProject[]>
}, visibility: { includeDemo: boolean, capabilities: readonly string[] }): Promise<QuantityProjectChoice[]> {
  const projects: QuantityProjectChoice[] = []
  const ids = new Set<string>()
  let version: string | null | undefined
  let total: number | undefined
  for (let page = 1; ; page++) {
    const response = await dependencies.list({ includeDemo: false, search: '', status: null, filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] }, sort: 'name-asc', page, pageSize: 100 })
    if (response.pagination.page !== page || response.pagination.pageSize !== 100
      || (total !== undefined && response.pagination.total !== total)
      || (version !== undefined && response.sourceVersion !== version)) {
      throw quantityProblem('conflict', '项目目录在分页读取期间发生变化，请重新读取')
    }
    version = response.sourceVersion
    total = response.pagination.total
    const expectedCount = Math.min(100, Math.max(0, total - (page - 1) * 100))
    if (!Number.isSafeInteger(total) || total < 0 || response.items.length !== expectedCount)
      throw quantityProblem('unavailable', '项目目录分页未完整返回，请重新读取')
    for (const item of response.items) {
      if (item.dataOrigin !== 'real' || ids.has(item.project.id))
        throw quantityProblem('relationship-mismatch', '正式项目目录返回了重复项目或错误来源，请重新读取')
      ids.add(item.project.id)
      projects.push({ id: item.project.id, code: item.code, name: item.project.label, dataOrigin: 'real', hasQuantityData: null })
    }
    if (page * response.pagination.pageSize >= response.pagination.total)
      break
  }
  if (visibility.includeDemo && visibility.capabilities.includes('demo:read')) {
    const demo = await dependencies.demo()
    projects.push(...demo.map(project => ({ ...project, dataOrigin: 'demo' as const })))
  }
  return projects
}
