import type { ProjectListItemDTO, ProjectListPageDTO, ProjectListQueryDTO, ProjectListRepository } from './repository'
import { collectReadPages } from '../read-model/collection'
import { projectProblem, ProjectRepositoryProblem } from './repository'

/** 候选目录与导出均读取同一版本的完整项目集合。 */
export async function listAllProjects(repository: ProjectListRepository, query: ProjectListQueryDTO, isCurrent?: () => boolean): Promise<ProjectListItemDTO[]> {
  try {
    const result = await collectReadPages<ProjectListPageDTO>({ load: page => repository.list({ ...query, page, pageSize: 100 }), identity: (item: ProjectListItemDTO) => `${item.dataOrigin}:${item.project.id}`, isCurrent })
    return result.items
  }
  catch (cause) {
    if (cause instanceof ProjectRepositoryProblem)
      throw cause
    throw new ProjectRepositoryProblem(projectProblem('stale-source', cause instanceof Error ? cause.message : '项目目录在读取期间发生变化，请重试', true))
  }
}
