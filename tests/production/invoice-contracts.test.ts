import type { TransactionDb } from '../../app/lib/db/coordinator'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertInvoiceContractBuyer, verifyInvoiceCompanyArchiveReference, verifyInvoiceContractReference, verifyLegacyInvoiceCompanyReference } from '../../server/utils/production-invoice-contracts'

const { auxiliary, constructionReference, constructionState, materialState, subcontractState } = vi.hoisted(() => ({ auxiliary: vi.fn(), constructionReference: vi.fn(), constructionState: vi.fn(), materialState: vi.fn(), subcontractState: vi.fn() }))
vi.mock('../../server/utils/production-auxiliary-contract-record', () => ({ validateProductionAuxiliaryState: auxiliary }))
vi.mock('../../server/utils/production-construction-contract-sources', () => ({ readProductionConstructionContractReference: constructionReference }))
vi.mock('../../server/utils/production-construction-contract-record', () => ({ readProductionConstructionState: constructionState }))
vi.mock('../../server/utils/production-material-contract-record', () => ({ loadProductionMaterialContractState: materialState }))
vi.mock('../../server/utils/production-subcontract-contract-record', () => ({ validateProductionSubcontractState: subcontractState }))

const actor = { workspaceId: 'workspace-one', actorId: 'owner-one', capabilities: ['auxiliary-contract:read'] }
const reference = { domain: 'auxiliary' as const, id: 'contract-one', version: '2' }
const tx = { select: vi.fn(async (sql: string) => sql.includes('production_participants') ? [{ schema_version: 1 }] : [{ deleted_at: null }]) } as unknown as TransactionDb
const record = (kind: string, migrationBatchId: string | null = null) => ({ draft: { id: reference.id, kind, projectId: 'project-one', supplierId: 'supplier-one' }, version: 2, migrationBatchId })

describe('发票合同的其他支出来源核验', () => {
  beforeEach(() => auxiliary.mockReset())

  it('接受当前其他支出合同，仍校验版本与双方关联', async () => {
    auxiliary.mockResolvedValue({ state: { contracts: [record('other_expense')] }, restores: [] })
    await expect(verifyInvoiceContractReference(tx, actor, reference, 'project-one', 'supplier-one')).resolves.toMatchObject({ id: reference.id, version: '2' })
    await expect(verifyInvoiceContractReference(tx, actor, { ...reference, version: '1' }, 'project-one', 'supplier-one')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(verifyInvoiceContractReference(tx, actor, reference, 'wrong-project', 'supplier-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('拒绝公司合同和已恢复迁入批次，即使其编号、版本和关联看似有效', async () => {
    auxiliary.mockResolvedValueOnce({ state: { contracts: [record('company_expense')] }, restores: [] })
    await expect(verifyInvoiceContractReference(tx, actor, reference, 'project-one', 'supplier-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    auxiliary.mockResolvedValueOnce({ state: { contracts: [record('other_expense', 'batch-one')] }, restores: [{ import_id: 'batch-one' }] })
    await expect(verifyInvoiceContractReference(tx, actor, reference, 'project-one', 'supplier-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('公司域只接受具有匹配稳定分供方的公司合同，历史缺关联不能猜测', async () => {
    const company = { domain: 'company' as const, id: reference.id, version: '2' }
    const companyRecord = { ...record('company_expense'), draft: { ...record('company_expense').draft, projectId: null } }
    auxiliary.mockResolvedValue({ state: { contracts: [companyRecord] }, restores: [] })
    await expect(verifyInvoiceContractReference(tx, actor, company, null, 'supplier-one')).resolves.toMatchObject({ id: reference.id, supplierId: 'supplier-one' })
    await expect(verifyInvoiceContractReference(tx, actor, company, null, 'supplier-other')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(verifyInvoiceContractReference(tx, actor, company, 'project-one', 'supplier-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    auxiliary.mockResolvedValue({ state: { contracts: [{ ...companyRecord, draft: { ...companyRecord.draft, supplierId: null } }] }, restores: [] })
    await expect(verifyInvoiceContractReference(tx, actor, company, null, 'supplier-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('公司归档核对签约主体稳定身份；缺证据、失权和合同版本变化时阻止', async () => {
    const company = { domain: 'company' as const, id: reference.id, version: '2' }
    const allowed = { ...actor, capabilities: [...actor.capabilities, 'our-signatory:read'] }
    const draft = { ...record('company_expense').draft, projectId: null, ourSignatoryId: 'buyer-one', ourSignatorySnapshot: { id: 'buyer-one', version: '1' } }
    auxiliary.mockResolvedValue({ state: { contracts: [{ draft, version: 2, migrationBatchId: null }] }, restores: [] })
    await expect(verifyInvoiceCompanyArchiveReference(tx, allowed, company, 'supplier-one', 'buyer-one')).resolves.toMatchObject({ ourSignatoryId: 'buyer-one' })
    await expect(verifyInvoiceCompanyArchiveReference(tx, allowed, company, 'supplier-one', 'buyer-other')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(verifyInvoiceCompanyArchiveReference(tx, actor, company, 'supplier-one', 'buyer-one')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(verifyInvoiceCompanyArchiveReference(tx, allowed, { ...company, version: '1' }, 'supplier-one', 'buyer-one')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    auxiliary.mockResolvedValue({ state: { contracts: [{ draft: { ...draft, ourSignatorySnapshot: null }, version: 2, migrationBatchId: null }] }, restores: [] })
    await expect(verifyInvoiceCompanyArchiveReference(tx, allowed, company, 'supplier-one', 'buyer-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it.each(['construction', 'subcontract', 'material', 'auxiliary'] as const)('%s 合同必须保有同一我方签约主体，缺快照不猜测', async (domain) => {
    const permitted = { ...actor, capabilities: ['construction-contract:read', 'subcontract-contract:read', 'material-contract:read', 'auxiliary-contract:read', 'our-signatory:read'] }
    const draft = { id: 'contract-one', kind: 'other_expense', projectId: 'project-one', supplierId: 'supplier-one', ourSignatoryId: 'buyer-one', ourSignatorySnapshot: { id: 'buyer-one', version: '1' } }
    const setSnapshot = (snapshot: typeof draft.ourSignatorySnapshot | null) => {
      const next = { ...draft, ourSignatorySnapshot: snapshot }
      constructionReference.mockResolvedValue({ id: 'contract-one', version: '2', projectId: 'project-one' })
      constructionState.mockResolvedValue({ contracts: [{ id: 'contract-one', draft: next }] })
      materialState.mockResolvedValue({ contracts: [{ id: 'contract-one', version: 2, draft: next }] })
      subcontractState.mockResolvedValue({ state: { contracts: [{ version: 2, draft: next }] } })
      auxiliary.mockResolvedValue({ state: { contracts: [{ version: 2, draft: next }] }, restores: [] })
    }
    const reference = { domain, id: 'contract-one', version: '2' }
    setSnapshot(draft.ourSignatorySnapshot)
    const actual = await verifyInvoiceContractReference(tx, permitted, reference, 'project-one', 'supplier-one')
    expect(actual.ourSignatoryId).toBe('buyer-one')
    expect(() => assertInvoiceContractBuyer(permitted, actual, 'buyer-one')).not.toThrow()
    expect(() => assertInvoiceContractBuyer(permitted, actual, 'buyer-other')).toThrow(/不一致/)
    expect(() => assertInvoiceContractBuyer({ ...permitted, capabilities: [] }, actual, 'buyer-one')).toThrow(/无我方主体读取权限/)
    setSnapshot(null)
    const unknown = await verifyInvoiceContractReference(tx, permitted, reference, 'project-one', 'supplier-one')
    try {
      assertInvoiceContractBuyer(permitted, unknown, 'buyer-one')
      throw new Error('缺主体快照未阻止')
    }
    catch (error) {
      expect(error).toMatchObject({ problem: { code: 'unavailable' } })
    }
  })

  it('旧公司合同采用必须匹配同一快照、公司表和原身份', async () => {
    const company = { domain: 'company' as const, id: reference.id, version: '2' }
    const allowed = { ...actor, capabilities: [...actor.capabilities, 'our-signatory:read'] }
    const hash = 'a'.repeat(64)
    const draft = { ...record('company_expense').draft, projectId: null, ourSignatoryId: 'buyer-one', ourSignatorySnapshot: { id: 'buyer-one', version: '1' } }
    auxiliary.mockResolvedValue({ state: { contracts: [{ draft, version: 2, migrationBatchId: 'batch-one' }] }, restores: [] })
    const evidence = { sourceSha256: hash, identityMappings: [{ legacyId: 'company_expense:old-one', id: company.id }, { legacyId: 'other_expense:same-id', id: 'other-contract' }] }
    const oldTx = { select: async (sql: string) => sql.includes('production_participants') ? [{ schema_version: 1 }] : sql.includes('auxiliary_contract_imports') ? [{ source_sha256: hash, evidence_json: JSON.stringify(evidence) }] : [{ deleted_at: null }] } as unknown as TransactionDb
    await expect(verifyLegacyInvoiceCompanyReference(oldTx, allowed, company, 'supplier-one', 'buyer-one', hash, 'old-one')).resolves.toMatchObject({ id: company.id })
    await expect(verifyLegacyInvoiceCompanyReference(oldTx, allowed, company, 'supplier-one', 'buyer-one', 'b'.repeat(64), 'old-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(verifyLegacyInvoiceCompanyReference(oldTx, allowed, company, 'supplier-one', 'buyer-one', hash, 'same-id')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    auxiliary.mockResolvedValue({ state: { contracts: [{ draft, version: 2, migrationBatchId: 'batch-one' }] }, restores: [{ import_id: 'batch-one' }] })
    await expect(verifyLegacyInvoiceCompanyReference(oldTx, allowed, company, 'supplier-one', 'buyer-one', hash, 'old-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
})
