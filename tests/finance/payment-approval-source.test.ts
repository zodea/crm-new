import type { CoreMigrationServerEntityDTO } from '~/lib/migration/core-contract'
import { describe, expect, it } from 'vitest'
import { otherSettlementDocumentSource } from '~/lib/migration/other-settlement-source-documents'
import { migratedSettlementSource } from '../../server/utils/other-settlement-sources'

describe('付款源单迁移批复来源', () => {
  it.each([
    [null, 'user-entry', null, '未填写'],
    [0, 'user-entry', '0.00', '已填写'],
    [0, 'legacy', null, '历史批复待核验'],
    [80, 'legacy', '80.00', '已填写'],
  ] as const)('迁入源单后仍区分 %s / %s，申请金额保持原事实', (amount, origin, expected, label) => {
    const source = otherSettlementDocumentSource({ id: 'payment-439', apply_amount: 100, approved_amount: amount, approved_amount_origin: origin }, 'application')
    expect(source.attributes).toMatchObject({ approvedAmountOrigin: origin, approvedAmount: amount === null ? null : amount.toFixed(2) })
    const document = migratedSettlementSource({ ...source, id: 'central-439', entityType: 'other_settlement_sources', quantity: null, references: {}, deletedAt: null, attributes: source.attributes! } as CoreMigrationServerEntityDTO, [])
    expect(document.amount).toBe('100.00')
    expect(document.fields).toContainEqual({ label: '批复金额', value: expected })
    expect(document.fields).toContainEqual({ label: '批复金额说明', value: label })
  })

  it('已迁入但没有来源标记的旧零同样不能推断为明确零', () => {
    const document = migratedSettlementSource({ id: 'old-central', entityType: 'other_settlement_sources', legacyId: 'application:old', name: '旧源单', references: {}, quantity: null, amount: '100.00', deletedAt: null, attributes: { kind: 'application', approvedAmount: '0.00' } }, [])
    expect(document.fields).toContainEqual({ label: '批复金额', value: null })
    expect(document.fields).toContainEqual({ label: '批复金额说明', value: '历史批复待核验' })
  })
})
