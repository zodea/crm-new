import { expect, it, vi } from 'vitest'
import { createInvoiceMigrationFromSession } from '../../app/lib/invoice/central-migration-bootstrap'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../app/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: mocks.list }) }))

it('迁入主体目录只返回完整可读且身份权限未变化的真实版本', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import', 'our-signatory:read'] }
  let current = actor
  const read = { records: [{ id: 'buyer-one', version: '2', draft: { name: '合成主体', status: 'active' } }, { id: 'buyer-old', version: '1', draft: { name: '停用主体', status: 'inactive' } }], meta: { ...actor, authorizedScope: { coverage: 'complete' }, sources: [{ key: 'our-signatories', state: 'readable', sourceVersion: 'our-signatories-2' }] } }
  mocks.list.mockResolvedValue(read)
  const services = await createInvoiceMigrationFromSession({ fetcher: async () => current })
  expect(await services.loadBuyers()).toEqual([{ id: 'buyer-one', label: '合成主体', version: '2' }])
  mocks.list.mockResolvedValueOnce({ ...read, meta: { ...read.meta, authorizedScope: { coverage: 'partial' } } })
  await expect(services.loadBuyers()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  mocks.list.mockImplementationOnce(async () => {
    current = { ...actor, capabilities: actor.capabilities.filter(capability => capability !== 'our-signatory:read') }
    return read
  })
  await expect(services.loadBuyers()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
})
