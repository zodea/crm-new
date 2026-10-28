import type { ProjectListSourceRow } from '~/lib/project/repository'
import { describe, expect, it, vi } from 'vitest'
import { createHomeProjectSource } from '~/lib/home/project-source'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { createScheduleRepository } from '~/lib/schedule/central-repository'
import { createProjectReadTestInstance, PROJECT_READ_FIXTURE } from '../../server/utils/project-read-test-instance'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { fixtureProjectCustomerReferences } from '../helpers/project-read-meta'

function central() {
  const rows: ProjectListSourceRow[] = [{ ...PROJECT_READ_FIXTURE[0]!, dataOrigin: 'real', id: 'new-central-project', name: '新建中央项目' }]
  const instance = createProjectReadTestInstance(() => ['project:list:read', 'demo:read'], () => rows, () => `v${rows[0]?.name}`, undefined, async () => 0, async () => [], fixtureProjectCustomerReferences)
  const repository = createHttpProjectListRepository({
    fetcher: async (url, options) => url === '/api/read/projects'
      ? instance.list(options?.query)
      : instance.detail(decodeURIComponent(url.split('/').at(-1)!), options?.query),
  })
  return { rows, instance, repository }
}

describe('首页项目中央来源', () => {
  it('首页与独立排程消费同一中央快照及用户运行日，读取失败不退本地', async () => {
    const { repository } = central()
    const id = 'new-central-project'
    const wire = { workspaceId: 'workspace', actorId: 'actor', origin: 'real', capabilities: ['schedule:read'], sourceVersion: 'wbs:1', snapshot: { id, name: '新建中央项目', code: '', groups: [], dependencies: [], disabledDependencies: [], plannedStart: null, plannedFinish: null, actualProgress: 0, plannedProgress: 0, deviationDays: 0 }, history: { logs: [], removedTasks: [], migrationEvidence: [] }, contracts: [], buildings: [], buildingCoverage: [] }
    const fetcher = vi.fn(async () => wire)
    const local = vi.fn(async () => [])
    const source = createHomeProjectSource({ projects: repository, schedule: createScheduleRepository(fetcher), localDb: { select: local } })
    expect(await source.read({ id, origin: 'real', includeDemo: false }, '2026-09-12')).toMatchObject({ availability: 'empty', snapshot: { id } })
    expect(fetcher).toHaveBeenCalledWith('/api/read/schedule/workspace', { query: { projectId: id, origin: 'real', includeDemo: false, today: '2026-09-12', contractId: '' } })
    fetcher.mockRejectedValueOnce(new Error('connection lost'))
    await expect(source.read({ id, origin: 'real', includeDemo: false }, '2026-09-12')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(local).not.toHaveBeenCalled()
  })
  it('本地项目为空时仍读取中央新建项目，改名后从中央回读', async () => {
    const { rows, repository } = central()
    const source = createHomeProjectSource({ projects: repository, localDb: { select: async () => [] } })
    expect(await source.catalog(false)).toMatchObject([{ id: 'new-central-project', origin: 'real', name: '新建中央项目' }])
    rows[0]!.name = '中央已更名'
    expect(await source.catalog(false)).toMatchObject([{ name: '中央已更名' }])
  })

  it('正式身份缺中央排程时明确未接入，不触碰本地项目或借用演示进度', async () => {
    const { repository } = central()
    const select = vi.fn(async () => {
      throw new Error('不得读取旧正式项目')
    })
    const source = createHomeProjectSource({ projects: repository, localDb: { select } })
    const result = await source.read({ id: 'new-central-project', origin: 'real', includeDemo: true }, '2026-09-10')
    expect(result).toMatchObject({ availability: 'not-connected', snapshot: null, project: { id: 'new-central-project', origin: 'real' } })
    expect(result.reason).toContain('尚未接入')
    expect(select).not.toHaveBeenCalled()
  })

  it('读取完整中央目录，同一 ID 的正式和测试来源保持独立身份', async () => {
    const { rows, repository } = central()
    const first = rows[0]!
    rows.splice(0, 1, ...Array.from({ length: 105 }, (_, index) => ({ ...first, id: `p-${index}` })))
    rows.push({ ...first, id: PROJECT_READ_FIXTURE[0]!.id })
    const source = createHomeProjectSource({ projects: repository, localDb: { select: async () => [] } })
    expect(await source.catalog(false)).toHaveLength(106)
    const both = (await source.catalog(true)).filter(row => row.id === PROJECT_READ_FIXTURE[0]!.id)
    expect(both.map(row => row.key).sort()).toEqual([`demo:${PROJECT_READ_FIXTURE[0]!.id}`, `real:${PROJECT_READ_FIXTURE[0]!.id}`])
  })

  it('测试开关和中央权限均通过后才能读取演示快照，已读取空分组与未接入分开', async () => {
    const { repository, instance } = central()
    const db = await createMigratedMemoryDb()
    try {
      const id = PROJECT_READ_FIXTURE[0]!.id
      await db.execute('INSERT INTO projects (id, name, code) VALUES (?, ?, ?)', [id, '旧演示名称', 'demo'])
      const source = createHomeProjectSource({ projects: repository, localDb: db })
      await expect(source.read({ id, origin: 'demo', includeDemo: false }, '2026-09-10')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      const result = await source.read({ id, origin: 'demo', includeDemo: true }, '2026-09-10')
      expect(result).toMatchObject({ availability: 'empty', snapshot: { id, name: PROJECT_READ_FIXTURE[0]!.name, groups: [] } })
      instance.reset('forbidden')
      await expect(source.read({ id, origin: 'demo', includeDemo: true }, '2026-09-10')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    }
    finally { db.close() }
  })

  it('已删除、中央拒绝及服务中断保持问题语义，不降为目录空或本地事实', async () => {
    const { repository, instance } = central()
    const select = vi.fn(async () => [])
    const source = createHomeProjectSource({ projects: repository, localDb: { select } })
    await expect(source.read({ id: 'deleted', origin: 'real', includeDemo: false }, '2026-09-10')).rejects.toMatchObject({ problem: { code: 'not-found' } })
    instance.reset('forbidden')
    await expect(source.catalog(false)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    instance.reset('unavailable')
    await expect(source.catalog(false)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(select).not.toHaveBeenCalled()
  })
})
