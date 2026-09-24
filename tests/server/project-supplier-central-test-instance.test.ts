import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import type { ProjectSupplierRepositoryProblem } from '~/lib/project-supplier/repository'
import { describe, expect, it } from 'vitest'
import { createProjectSupplierReadTestInstance } from '../../server/utils/project-supplier-read-test-instance'

const capabilities = ['project-supplier:read', 'demo:read']

describe('项目×分供方中央读取测试实例', () => {
  it('演示关系返回六类真实事实与中央汇总', async () => {
    const instance = createProjectSupplierReadTestInstance(() => capabilities)

    const detail = await instance.detail(
      'proj_demo_002',
      'sup_demo_004',
      { origin: 'demo', includeDemo: 'true' },
    )

    expect(detail.relation.id).toBe('ps_demo_005')
    expect(detail.counts).toEqual({ contracts: 1, claims: 1, invoices: 1, payments: 1, settlements: 1, files: 2 })
    expect(detail.summary).toMatchObject({
      contractTotal: '230000.00',
      claimedTotal: '100000.00',
      invoiceTotal: '12380.00',
      taxTotal: '1423.89',
      paidTotal: '80000.00',
      settlementTotal: '80000.00',
      balance: '150000.00',
    })
  })

  it('已确认迁移的正式关系保持真实零事实，不回退演示或本地源', async () => {
    const snapshot: CoreMigrationSnapshotDTO = {
      authority: 'central',
      activeBatchId: 'batch-317',
      entities: [
        { entityType: 'projects', id: 'project-real', legacyId: 'project-old', name: '正式项目', references: {}, quantity: null, amount: null, deletedAt: null, batchId: 'batch-317' },
        { entityType: 'suppliers', id: 'supplier-real', legacyId: 'supplier-old', name: '正式分供方', references: {}, quantity: null, amount: null, deletedAt: null, batchId: 'batch-317' },
        { entityType: 'project_suppliers', id: 'relation-real', legacyId: 'relation-old', name: '正式合作关系', references: { projectId: 'project-real', supplierId: 'supplier-real' }, quantity: null, amount: null, deletedAt: null, batchId: 'batch-317' },
      ],
    }
    const instance = createProjectSupplierReadTestInstance(() => capabilities, () => snapshot)

    const detail = await instance.detail('project-real', 'supplier-real', { origin: 'real' })

    expect(detail.dataOrigin).toBe('real')
    expect(detail.relation.id).toBe('relation-real')
    expect(detail.counts).toEqual({ contracts: 0, claims: 0, invoices: 0, payments: 0, settlements: 0, files: 0 })
    expect(detail.summary.balance).toBe('0.00')
  })

  it('显式中央正式夹具返回六类非零事实且来源不回落本地编辑页', async () => {
    const instance = createProjectSupplierReadTestInstance(() => capabilities)
    instance.reset('formal-ready')

    const detail = await instance.detail('project-real-317', 'supplier-real-317', { origin: 'real' })

    expect(detail.dataOrigin).toBe('real')
    expect(detail.counts).toEqual({ contracts: 1, claims: 1, invoices: 1, payments: 1, settlements: 1, files: 1 })
    expect(detail.summary).toMatchObject({
      contractTotal: '120000.00',
      claimedTotal: '50000.00',
      invoiceTotal: '31800.00',
      paidTotal: '30000.00',
      settlementTotal: '45000.00',
      balance: '90000.00',
    })
    expect(detail.contracts[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
    expect(detail.settlements[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
  })

  it('区分关系错配、无权限和服务暂不可用', async () => {
    const instance = createProjectSupplierReadTestInstance(() => capabilities)

    await expect(instance.detail('proj_demo_001', 'sup_demo_004', { origin: 'demo', includeDemo: 'true' }))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem: { code: 'relationship-mismatch' } })

    instance.reset('forbidden')
    await expect(instance.detail('proj_demo_002', 'sup_demo_004', { origin: 'demo', includeDemo: 'true' }))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem: { code: 'forbidden' } })

    instance.reset('unavailable')
    await expect(instance.detail('proj_demo_002', 'sup_demo_004', { origin: 'demo', includeDemo: 'true' }))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem: { code: 'unavailable', retryable: true } })
  })

  it('项目反向引用要求项目分供方读权限，命令关系读取失败时不降级为空集合', () => {
    const projectOnly = createProjectSupplierReadTestInstance(() => ['project:list:read'])

    expect(() => projectOnly.references('proj_demo_002', 'demo'))
      .toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'forbidden' }) }))

    const unavailable = createProjectSupplierReadTestInstance(() => capabilities)
    unavailable.reset('unavailable')
    expect(() => unavailable.commandRelationships('project-real-320', 'real'))
      .toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'unavailable', retryable: true }) }))
  })
})
