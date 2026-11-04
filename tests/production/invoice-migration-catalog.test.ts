import type { ProductionStorage } from '../../server/utils/production-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { readInvoiceMigrationCatalog, readInvoiceWorkspaceCatalog } from '../../server/utils/production-invoice-migration-catalog'

const mocks = vi.hoisted(() => ({ masters: vi.fn(), material: vi.fn(), verify: vi.fn() }))
vi.mock('../../server/utils/production-migration-references', () => ({ listMigrationReferences: mocks.masters }))
vi.mock('../../server/utils/production-material-contract-record', () => ({ loadProductionMaterialContractState: mocks.material }))
vi.mock('../../server/utils/production-invoice-contracts', () => ({ invoiceContractCapability: (domain: string) => `${domain}-contract:read`, verifyInvoiceContractReference: mocks.verify }))

const actor = { workspaceId: 'workspace-one', actorId: 'owner-one', capabilities: ['finance-invoice:read', 'finance-invoice:import', 'project:list:read', 'material-contract:read'] }
const storage = {
  identity: { workspaceId: 'workspace-one', actorId: 'owner-one' },
  withTransaction: async (work: (tx: unknown) => unknown) => work({ select: async (sql: string) => sql.includes('production_participants') ? [{ schema_version: 1 }] : [{ revision: 3 }] }),
} as unknown as ProductionStorage

describe('发票迁入目标目录', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.masters.mockResolvedValue([{ serverId: 'project-one', label: '项目一', version: '2', sourceVersion: 'projects:3' }])
    mocks.material.mockResolvedValue({ contracts: [
      { id: 'contract-one', version: 4, draft: { name: '采购一', no: 'M-1', projectId: 'project-one', supplierId: 'supplier-one', isSupplement: false } },
      { id: 'supplement-one', version: 1, draft: { isSupplement: true } },
      { id: 'retired-one', version: 1, migrationRetired: true, draft: { isSupplement: false } },
    ] })
    mocks.verify.mockResolvedValue({})
  })

  it('返回真实目录身份、版本、关联与来源；未授权来源单独标记', async () => {
    const result = await readInvoiceMigrationCatalog(storage, () => actor, ['projects', 'suppliers', 'material'])
    expect(result.projects).toEqual([{ id: 'project-one', label: '项目一', version: '2', sourceVersion: 'projects:3' }])
    expect(result.suppliers).toEqual([])
    expect(result.contracts).toEqual([{ id: 'contract-one', label: '采购一 / M-1', domain: 'material', version: '4', projectId: 'project-one', supplierId: 'supplier-one' }])
    expect(result.sources).toMatchObject([{ key: 'projects', state: 'readable', sourceVersion: 'projects:3' }, { key: 'suppliers', state: 'forbidden', sourceVersion: null }, { key: 'material', state: 'readable' }])
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), actor, { domain: 'material', id: 'contract-one', version: '4' }, 'project-one', 'supplier-one')
  })

  it('来源不可用时不伪造空目录，权限变化时整次拒绝', async () => {
    mocks.material.mockRejectedValue(new CentralInvoiceProblem('unavailable', '来源缺失'))
    const result = await readInvoiceMigrationCatalog(storage, () => actor, ['material'])
    expect(result.sources).toEqual([{ key: 'material', state: 'unavailable', sourceVersion: null }])
    expect(result.contracts).toEqual([])
    let calls = 0
    await expect(readInvoiceMigrationCatalog(storage, () => ++calls < 3 ? actor : { ...actor, capabilities: [] }, ['projects'])).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('来源版本不一致时拒绝候选，并拒绝无效目录请求', async () => {
    mocks.masters.mockResolvedValue([{ serverId: 'project-one', label: '项目一', version: '2', sourceVersion: 'projects:2' }])
    const result = await readInvoiceMigrationCatalog(storage, () => actor, ['projects'])
    expect(result.sources).toEqual([{ key: 'projects', state: 'unavailable', sourceVersion: null }])
    expect(result.projects).toEqual([])
    await expect(readInvoiceMigrationCatalog(storage, () => actor, ['projects', 'projects'])).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('普通发票读取权限可使用工作台目录，但不能取得迁入目录', async () => {
    const reader = { ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:import') }
    expect((await readInvoiceWorkspaceCatalog(storage, () => reader, ['projects'])).projects).toMatchObject([{ id: 'project-one', version: '2' }])
    await expect(readInvoiceMigrationCatalog(storage, () => reader, ['projects'])).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    let calls = 0
    await expect(readInvoiceWorkspaceCatalog(storage, () => ++calls < 3 ? reader : { ...reader, capabilities: [] }, ['projects'])).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
})
