import { describe, expect, it } from 'vitest'
import { createOtherSettlementRepository } from '../../app/lib/other-settlement/repository'
import { createOtherSettlementInstance } from '../../server/utils/other-settlement-instance'

describe('aX05 HTTP Repository 边界', () => {
  it('通过同一读写接缝回读稳定身份，并拒绝被串改的金额、事实、导航、附件', async () => {
    const session = { workspaceId: 'w', actorId: 'a', capabilities: ['other-settlement:read', 'other-settlement:write'] }
    const server = createOtherSettlementInstance({ createId: () => 'http-331', identities: () => ({ projects: [], suppliers: [], contracts: [] }) })
    const repository = createOtherSettlementRepository(async (url, options) => options?.method === 'POST' ? server.execute(options.body, session) : url.endsWith('context') ? server.context(session) : server.detail('http-331', options?.query ?? {}, session))
    const context = await repository.context()
    const saved = await repository.execute({ ...context, requiredCapability: 'other-settlement:write', commandId: 'create', action: 'draft', baseVersion: null, draft: { name: '未完成草稿' }, attachments: {} })
    const detail = await repository.detail(saved.id, { origin: 'real' })
    expect(detail.settlement.amounts.total).toBeNull()
    for (const changed of [
      { ...detail, settlement: { ...detail.settlement, amounts: {} } },
      { ...detail, settlement: { ...detail.settlement, navigation: { ...detail.settlement.navigation, subject: { id: 'foreign' } } } },
      { ...detail, facts: [{ id: 'wrong', settlementId: 'foreign', amount: '1.00' }] },
      { ...detail, attachments: [{ id: 'file', ownerId: 'foreign' }] },
    ])
      await expect(createOtherSettlementRepository(async () => changed).detail(saved.id, {})).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    await expect(createOtherSettlementRepository(async () => {
      throw new Error('offline')
    }).list({})).rejects.toMatchObject({ problem: { code: 'unavailable', retryable: true } })
  })
})
