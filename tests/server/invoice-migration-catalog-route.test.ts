import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), session: vi.fn(), catalog: vi.fn() }))
vi.mock('../../server/utils/production-runtime', () => ({ productionRuntime: mocks.runtime }))
vi.mock('../../server/utils/production-invoice-migration-catalog', () => ({ readInvoiceMigrationCatalog: mocks.catalog }))
vi.mock('../../server/utils/production-invoice-runtime', () => ({
  productionInvoiceSession: mocks.session,
  throwProductionInvoiceError: (error: unknown) => { throw error },
}))

const actor = { workspaceId: 'workspace-one', actorId: 'owner-one', capabilities: ['finance-invoice:read', 'finance-invoice:import'] }
const storage = { identity: { workspaceId: actor.workspaceId, actorId: actor.actorId } }
const session = () => actor
vi.stubGlobal('defineEventHandler', (handler: (event: unknown) => unknown) => handler)
vi.stubGlobal('readBody', async (event: { body: unknown }) => event.body)
const route = (await import('../../server/api/read/invoices/migration-catalog.post')).default as unknown as (event: { body: unknown }) => Promise<unknown>
afterAll(() => vi.unstubAllGlobals())

describe('发票迁入目录接口', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.runtime.mockReturnValue({ storage })
    mocks.session.mockReturnValue(session)
    mocks.catalog.mockResolvedValue({ sources: [] })
  })

  it('有效请求交给同事务目录核验', async () => {
    await expect(route({ body: { requested: ['projects', 'material'] } })).resolves.toEqual({ sources: [] })
    expect(mocks.catalog).toHaveBeenCalledWith(storage, session, ['projects', 'material'])
  })

  it('缺少权限、身份不一致或目录请求不合规时拒绝且不读取目录', async () => {
    for (const body of [{}, { requested: ['projects', 'projects'] }, { requested: ['unknown'] }, { requested: [], extra: true }])
      await expect(route({ body })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    mocks.session.mockReturnValue(() => ({ ...actor, capabilities: ['finance-invoice:read'] }))
    await expect(route({ body: { requested: [] } })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    mocks.session.mockReturnValue(() => ({ ...actor, actorId: 'other-owner' }))
    await expect(route({ body: { requested: [] } })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(mocks.catalog).not.toHaveBeenCalled()
  })
})
