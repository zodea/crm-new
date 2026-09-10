import type { ProjectListItemDTO, ProjectListQueryDTO, ProjectListRepository } from './repository'
import { projectProblem, ProjectRepositoryProblem } from './repository'

/** 候选目录与导出均读取同一版本的完整项目集合。 */
export async function listAllProjects(repository: ProjectListRepository, query: ProjectListQueryDTO): Promise<ProjectListItemDTO[]> {
  const first = await repository.list({ ...query, page: 1, pageSize: 100 })
  const items = [...first.items]
  const pageCount = Math.ceil(first.pagination.total / 100)
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await repository.list({ ...query, page, pageSize: 100 })
    if (next.sourceVersion !== first.sourceVersion) {
      throw new ProjectRepositoryProblem(projectProblem('stale-source', '项目目录在读取期间发生变化，请重试', true))
    }
    items.push(...next.items)
  }
  return items
}
