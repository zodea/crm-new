import { beforeEach, describe, expect, it } from 'vitest'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { buildProjectDetailRead } from '~/lib/project/repository'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import {
  createProjectReadTestInstance,
  PROJECT_READ_FIXTURE,
} from '../../server/utils/project-read-test-instance'

describe('project detail data-origin boundary', () => {
  const instance = createProjectReadTestInstance()
  const repository = createHttpProjectListRepository({
    fetcher: async (url, options) => {
      const id = decodeURIComponent(url.split('/').at(-1) ?? '')
      return instance.detail(id, options?.query)
    },
  })

  beforeEach(() => instance.reset('ready'))

  it('returns server-verified demo origin only when the preference and capability allow it', async () => {
    await expect(repository.get({
      id: 'proj_demo_001',
      origin: 'demo',
      includeDemo: true,
    })).resolves.toMatchObject({
      item: {
        dataOrigin: 'demo',
        project: { id: 'proj_demo_001', label: '合和新城' },
      },
      materialContracts: {
        count: { value: 3, status: 'complete', unit: 'count' },
        navigation: {
          kind: 'entity-list',
          entity: 'contract',
          variant: 'material',
          filters: { projectId: 'proj_demo_001', dataOrigin: 'demo' },
        },
      },
    })
  })

  it('真实零合同仍返回可达列表；未知或禁止不伪装为零', () => {
    const demo = PROJECT_READ_FIXTURE[0]!
    const read = (
      materialContractCount: number | null,
      materialContractAccess: 'allowed' | 'forbidden' | 'unknown' | 'missing' | 'error' = 'allowed',
    ) => buildProjectDetailRead({
      rows: [demo],
      query: { id: demo.id, origin: 'demo', includeDemo: true },
      asOf: '2026-08-15T00:00:00.000Z',
      sourceVersion: 'journey-fixture-v1',
      materialContractCount,
      materialContractAccess,
    })

    expect(read(0).materialContracts).toMatchObject({
      count: { value: 0, status: 'complete', drilldown: { entity: 'contract' } },
      navigation: { kind: 'entity-list' },
    })
    expect(read(null).materialContracts).toMatchObject({
      count: { value: null, status: 'pending', drilldown: null },
      navigation: { kind: 'unavailable', reason: 'not-connected' },
    })
    expect(read(null, 'forbidden').materialContracts).toMatchObject({
      count: { value: null, status: 'pending', drilldown: null },
      navigation: { kind: 'unavailable', reason: 'forbidden' },
    })
    expect(read(null, 'missing').materialContracts.navigation).toEqual({ kind: 'unavailable', reason: 'missing-id' })
    expect(read(null, 'error').materialContracts.navigation).toEqual({ kind: 'unavailable', reason: 'error' })
  })

  it('does not let a missing or forged origin relabel a demo record as production', async () => {
    await expect(repository.get({
      id: 'proj_demo_001',
      origin: 'real',
      includeDemo: true,
    })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(repository.get({
      id: 'proj_demo_001',
      origin: 'demo',
      includeDemo: false,
    })).rejects.toMatchObject({ problem: { code: 'not-found' } })
  })

  it('checks demo capability at the detail endpoint as well as the list endpoint', async () => {
    const demoWorkspace = createDemoWorkspaceTestInstance()
    demoWorkspace.reset('forbidden', 'detail-no-demo')
    const capabilityInstance = createProjectReadTestInstance(
      sessionId => demoWorkspace.capabilities(sessionId),
    )
    const isolated = createHttpProjectListRepository({
      fetcher: async (url, options) => {
        const id = decodeURIComponent(url.split('/').at(-1) ?? '')
        return capabilityInstance.detail(id, options?.query, 'detail-no-demo')
      },
    })

    await expect(isolated.get({
      id: 'proj_demo_001',
      origin: 'demo',
      includeDemo: true,
    })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('同一 ID 的正式与演示项目按复合身份分别读取', () => {
    const demo = PROJECT_READ_FIXTURE[0]!
    const rows = [
      demo,
      { ...demo, dataOrigin: 'real' as const, name: '正式同 ID 项目' },
    ]
    const read = (origin: 'real' | 'demo') => buildProjectDetailRead({
      rows,
      query: { id: demo.id, origin, includeDemo: true },
      asOf: '2026-08-15T00:00:00.000Z',
      sourceVersion: 'same-id-fixture-v1',
    })

    expect(read('real').item).toMatchObject({
      dataOrigin: 'real',
      project: { id: demo.id, label: '正式同 ID 项目' },
    })
    expect(read('demo').item).toMatchObject({
      dataOrigin: 'demo',
      project: { id: demo.id, label: demo.name },
    })
  })
})
