import type { SoftDb } from '~/lib/db/soft-delete'
import type { ProjectDetailQueryDTO, ProjectListItemDTO, ProjectListRepository } from '~/lib/project/repository'
import type { createScheduleRepository } from '~/lib/schedule/central-repository'
import type { ScheduleProjectView } from '~/lib/schedule/read-model'
import type { DataOriginDTO } from '~/types/read-model'
import { listAllProjects } from '~/lib/project/list-all'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import { loadScheduleProject } from '~/lib/schedule/read-model'

export interface HomeProjectReference {
  key: string
  id: string
  origin: DataOriginDTO
  name: string
  code: string
  status: string
}

export function homeProjectKey(id: string, origin: DataOriginDTO): string {
  return `${origin}:${id}`
}

export interface HomeProjectScheduleRead {
  project: HomeProjectReference
  availability: 'ready' | 'empty' | 'not-connected'
  reason: string
  snapshot: ScheduleProjectView | null
}

function reference(row: ProjectListItemDTO): HomeProjectReference {
  return { key: homeProjectKey(row.project.id, row.dataOrigin), id: row.project.id, origin: row.dataOrigin, name: row.project.label, code: row.code, status: row.status }
}

export function createHomeProjectSource(options: { projects: ProjectListRepository, localDb: Pick<SoftDb, 'select'>, schedule?: ReturnType<typeof createScheduleRepository> }) {
  return {
    async catalog(includeDemo: boolean): Promise<HomeProjectReference[]> {
      const rows = await listAllProjects(options.projects, {
        includeDemo,
        search: '',
        status: null,
        sort: 'name-asc',
        page: 1,
        pageSize: 100,
        filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] },
      })
      return rows.map(reference)
    },
    async read(query: ProjectDetailQueryDTO, today: string): Promise<HomeProjectScheduleRead> {
      if (query.origin === 'demo' && !query.includeDemo)
        throw new ProjectRepositoryProblem(projectProblem('forbidden', '测试项目未开启或当前环境不支持'))
      const project = reference((await options.projects.get(query)).item)
      if (!project)
        throw new ProjectRepositoryProblem(projectProblem('not-found', '项目不存在或已删除'))
      if (query.origin === 'real') {
        if (options.schedule) {
          const read = await options.schedule.read({ projectId: query.id, origin: query.origin, includeDemo: query.includeDemo, today })
          return { project, availability: read.snapshot.groups.length ? 'ready' : 'empty', snapshot: read.snapshot, reason: '' }
        }
        return { project, availability: 'not-connected', snapshot: null, reason: '该项目的中央排程来源尚未接入，计划与实际进度未知。当前不会读取旧本地项目或演示排程补齐。' }
      }
      if (query.origin === 'demo' && options.schedule) {
        const catalog = await options.schedule.catalog('demo', query.includeDemo)
        if (!catalog.projects.some(row => row.id === query.id))
          throw new ProjectRepositoryProblem(projectProblem('not-found', '当前演示项目不存在或已删除'))
      }
      const snapshot = await loadScheduleProject(options.localDb, query.id, today)
      if (!snapshot)
        return { project, availability: 'not-connected', snapshot: null, reason: '该项目的排程快照尚未提供，不能判断是否已有施工排程。' }
      return { project, availability: snapshot.groups.length ? 'ready' : 'empty', snapshot: { ...snapshot, name: project.name, code: project.code }, reason: '' }
    },
  }
}
