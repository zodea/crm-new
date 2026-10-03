import { beforeEach, describe, expect, it } from 'vitest'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { buildProjectDetailRead } from '~/lib/project/repository'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import {
  createProjectReadTestInstance,
  PROJECT_READ_FIXTURE,
} from '../../server/utils/project-read-test-instance'
import { createProjectSupplierReadTestInstance } from '../../server/utils/project-supplier-read-test-instance'

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
    const detail = await repository.get({
      id: 'proj_demo_001',
      origin: 'demo',
      includeDemo: true,
    })
    expect(detail).toMatchObject({
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
    expect(detail.projectSuppliers.empty).toBeNull()
    expect(detail.projectSuppliers.items.find(row => row.relationId === 'ps_demo_001')).toMatchObject({
      supplier: { id: 'sup_demo_001', label: '广州市大板东建材有限公司' },
      navigation: {
        kind: 'entity-subview',
        variant: 'supplier-workbench',
        filters: { dataOrigin: 'demo', supplierId: 'sup_demo_001' },
      },
    })
  })

  describe('真实零合同仍返回可达列表；未知或禁止不伪装为零', () => {
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
    it.each([
      { case: '0', input: 0, argument2: undefined, expected: {
        count: { value: 0, status: 'complete', drilldown: { entity: 'contract' } },
        navigation: { kind: 'entity-list' },
      } },
      { case: 'null', input: null, argument2: undefined, expected: {
        count: { value: null, status: 'pending', drilldown: null },
        navigation: { kind: 'unavailable', reason: 'not-connected' },
      } },
      { case: 'null / \'forbidden\'', input: null, argument2: 'forbidden', expected: {
        count: { value: null, status: 'pending', drilldown: null },
        navigation: { kind: 'unavailable', reason: 'forbidden' },
      } },
    ])('read：$case', ({ input, argument2, expected }) => {
      expect(read(structuredClone(input), structuredClone(argument2)).materialContracts).toMatchObject(expected)
    })

    it.each([
      { case: 'null / \'missing\'', input: null, argument2: 'missing', expected: { kind: 'unavailable', reason: 'missing-id' } },
      { case: 'null / \'error\'', input: null, argument2: 'error', expected: { kind: 'unavailable', reason: 'error' } },
    ])('read：$case', ({ input, argument2, expected }) => {
      expect(read(structuredClone(input), structuredClone(argument2)).materialContracts.navigation).toEqual(expected)
    })
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

  it('只有项目读取权限时不泄露项目分供方反向身份', async () => {
    const projectOnlyCapabilities = ['project:list:read']
    const projectSupplierReads = createProjectSupplierReadTestInstance(() => projectOnlyCapabilities)
    const row = {
      ...PROJECT_READ_FIXTURE[0]!,
      dataOrigin: 'real' as const,
      id: 'project-only',
      name: '仅项目可见',
    }
    const instance = createProjectReadTestInstance(
      () => projectOnlyCapabilities,
      () => [row],
      () => 'project-only-v1',
      undefined,
      async () => 0,
      async (projectId, origin, sessionId) => projectSupplierReads.references(projectId, origin, sessionId),
    )

    const detail = await instance.detail(row.id, { origin: 'real', includeDemo: 'false' })

    expect(detail.projectSuppliers).toMatchObject({ access: 'forbidden', items: [] })
    expect(JSON.stringify(detail.projectSuppliers)).not.toContain('sup_demo_')
  })

  describe('同一 ID 的正式与演示项目按复合身份分别读取', () => {
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
    it.each([
      { case: '\'real\'', input: 'real', expected: {
        dataOrigin: 'real',
        project: { id: demo.id, label: '正式同 ID 项目' },
      } },
      { case: '\'demo\'', input: 'demo', expected: {
        dataOrigin: 'demo',
        project: { id: demo.id, label: demo.name },
      } },
    ])('read：$case', ({ input, expected }) => {
      expect(read(structuredClone(input)).item).toMatchObject(expected)
    })
  })
})
