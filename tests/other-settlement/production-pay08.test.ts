import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementMigration } from '../../server/utils/production-other-settlement-migration'
import { createProductionOtherSettlementService, listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createOtherSettlementPay08Source } from '../helpers/other-settlement-pay08-source'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const root = testTempRoot('a02-material-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'other-pay08-'))
  const native = await createOtherSettlementPay08Source(join(directory, 'native-source'))
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'other-pay08-workspace', ownerId: 'other-pay08-owner', purpose: 'verification' })
  const actor = { workspaceId: 'other-pay08-workspace', actorId: 'other-pay08-owner', capabilities: ['other-settlement:read', 'other-settlement:write', 'supplier:list:read', 'supplier:write', 'core:migration:write', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const session = () => structuredClone(actor)
  const supplierOwner = createProductionSupplierService(storage)
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const suppliers = []
  for (const [legacyId, name] of [[native.ids.service, '原实际服务交易方'], [native.ids.payee, '原实际垫付收款人']]) {
    const saved = await supplierOwner.execute({ ...identity, requiredCapability: 'supplier:write', commandId: `pay08-create-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成核验人' } }, session)
    suppliers.push({ legacyId: legacyId!, id: saved.id })
  }
  const finance = createProductionFinanceService(storage, { references: (tx, current) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id), settlementCandidates: () => listProductionOtherSettlementReferences(tx, current) }) })
  const preview = await finance.preflightSnapshot({ ...identity, source: native.source }, session)
  const mappings = suppliers.map((row) => {
    const current = preview.candidates.find(candidate => candidate.entityType === 'suppliers' && candidate.serverId === row.id)!
    return { entityType: 'suppliers' as const, legacyId: row.legacyId, targetId: row.id, version: current.version, sourceVersion: current.sourceVersion, reason: '原费用与原件逐条确认实际身份' }
  })
  await finance.importSnapshot({ ...identity, source: native.source, mappings, commandId: 'pay08-full-finance-import' }, session)
  await createProductionOtherSettlementMigration(storage).importSnapshot({ ...identity, source: native.source, mappings, commandId: 'pay08-full-other-import' }, session)
  const owner = createProductionOtherSettlementService(storage)
  const payeeId = suppliers.find(row => row.legacyId === native.ids.payee)!.id
  const paymentRequest = (commandId: string, amount = 30): FinanceCommand => ({ ...identity, kind: 'payment_record', requiredCapability: 'finance-payment-record:write', baseVersion: null, commandId, action: 'confirm', attachments: {}, draft: { supplierId: payeeId, payeeName: '原实际垫付收款人', amount, paymentDate: '2026-10-05', voucherNo: `SYNTHETIC-${commandId}`, bankSerialNo: `SYNTHETIC-BANK-${commandId}`, confirmedBy: actor.actorId, applicationAllocations: [{ paymentApplicationId: native.ids.application, allocatedAmount: amount }] } })
  const verifyRequest = async (commandId: string, overrides: object = {}): Promise<FinanceCommand> => ({ ...identity, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', id: native.ids.application, baseVersion: (await finance.form('payment_application', native.ids.application, session)).version, action: 'save', commandId, attachments: {}, draft: { id: native.ids.application, verificationEdit: { actualDueAmount: 70, cumulativePayableAmount: 70, basis: '原费用100、结算实际采用70、旧实付20与原件逐条核验', fileIds: [native.ids.applicationFile], ...overrides } } })
  return { storage, native, actor, session, finance, owner, payeeId, paymentRequest, verifyRequest }
}

it('真实Native原费与已确认结算核验后才新增现金，原批复未知/旧现金/原件及核验原键冷开保真', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const application = await f.finance.form('payment_application', f.native.ids.application, f.session)
    expect(application.draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 20, paymentVerification: { required: true, status: 'missing', proof: null } })
    expect((await f.owner.detail(f.native.ids.settlement, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ total: '70.00', net: '70.00', paid: '20.00', unpaid: '50.00' })
    await expect(f.finance.execute(f.paymentRequest('pay08-without-proof'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const request = await f.verifyRequest('pay08-real-source-verification')
    const verified = await f.finance.execute(request, f.session)
    const state = (await f.finance.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification!
    expect(state).toMatchObject({ required: true, status: 'verified', proof: { schemaVersion: 'payment-verification-v1', applicationId: f.native.ids.application, applicationVersion: verified.version, commandId: request.commandId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, actualDueAmount: 70, cumulativePayableAmount: 70, fileIds: [f.native.ids.applicationFile] } })
    expect(state.proof!.sources.map(row => [row.owner, row.id, row.version])).toEqual([['other-settlements', f.native.ids.settlement, '0'], ['finance-expense', f.native.ids.expenseLine, '1']])
    expect(state.proof!.originals).toEqual([{ id: f.native.ids.applicationFile, ownerType: 'payment_application', ownerId: f.native.ids.application, fileName: '原申请核验依据.bin', fileSize: 4, sha256: f.native.originalSha256 }])
    const payment = await f.finance.execute(f.paymentRequest('pay08-new-actual-30'), f.session)
    await f.storage.close()
    expect(await f.finance.execute(request, f.session)).toEqual(verified)
    expect(await f.finance.execute(f.paymentRequest('pay08-new-actual-30'), f.session)).toEqual(payment)
    const detail = await f.finance.paymentDetail(f.native.ids.application, f.session)
    expect(detail.detail).toMatchObject({ approvedAmount: null, approvedAmountState: 'legacy-unknown', unpaidAmount: null, paidAmount: '50' })
    expect((await f.owner.detail(f.native.ids.settlement, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ net: '70.00', paid: '50.00', unpaid: '20.00' })
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 2, amount: 50 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, amount: 100 }])
    await expect(f.finance.execute(f.paymentRequest('pay08-over-cumulative-cap', 21), f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const original = await f.owner.original(f.native.ids.settlement, f.native.ids.settlementFile, null, f.session)
    expect(Buffer.from(original.payloadBase64, 'base64')).toEqual(f.native.original)
    expect(await f.storage.select('SELECT amount,confirmed_by,bank_serial_no FROM payment_records WHERE id=?', [f.native.ids.payment])).toEqual([{ amount: 20, confirmed_by: '原确认人', bank_serial_no: 'PAY08-OLD-BANK' }])
  }
  finally { await f.storage.close() }
})

it.each([null, 0, 70])('真实历史未知批复明确改为%s仍不能跳过原业务核验，旧现金及源历史保留', { timeout: 15000 }, async (amount) => {
  const f = await fixture()
  try {
    const current = await f.finance.form('payment_application', f.native.ids.application, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', id: f.native.ids.application, baseVersion: current.version, action: 'save', commandId: `pay08-edited-approval-${amount}`, attachments: {}, draft: { ...current.draft, approvedAmount: amount, approvedAmountEdit: { value: amount } } }, f.session)
    expect((await f.finance.form('payment_application', f.native.ids.application, f.session)).draft).toMatchObject({ approvedAmount: amount, approvedAmountOrigin: 'user-entry', paymentVerification: { required: true, status: 'missing', proof: null } })
    await expect(f.finance.execute(f.paymentRequest(`pay08-cannot-bypass-${amount}`, 10), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 20 }])
    const source = (await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM finance_imports'))[0]!
    expect(JSON.parse(source.evidence_json).sourceTables.payment_applications[0]).toMatchObject({ approved_amount: 0, approved_amount_origin: 'legacy' })
  }
  finally { await f.storage.close() }
})

it('核验权限与依据原件归属严格校验，实际原費版本改变不复用旧结论或抹去已付', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const before = await f.storage.select('SELECT * FROM finance_payment_verifications')
    await expect(f.finance.execute(await f.verifyRequest('pay08-foreign-original', { fileIds: [f.native.ids.settlementFile] }), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const revoked = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'other-settlement:read') })
    await expect(f.finance.execute(await f.verifyRequest('pay08-source-forbidden'), revoked)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT * FROM finance_payment_verifications')).toEqual(before)
    await f.finance.execute(await f.verifyRequest('pay08-before-source-change'), f.session)
    // Independent records move both owner revisions without changing the frozen source records.
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, kind: 'current', requiredCapability: 'finance-current:write', baseVersion: null, commandId: 'pay08-unrelated-finance-record', action: 'draft', attachments: {}, draft: { direction: 'payment', supplierId: f.payeeId, transactionDate: '2026-10-05', status: 'draft', amount: 0, purpose: '另一条未确认往来' } }, f.session)
    const original = (await f.owner.expenses(f.session)).items.find(row => row.id === f.native.ids.expenseLine)!
    await f.owner.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'other-settlement:write', baseVersion: null, commandId: 'pay08-unrelated-settlement-record', action: 'draft', attachments: {}, draft: { name: '另一条未确认结算', projectId: null, contractId: null, totalAmount: 0, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: original.id, sourceVersion: original.version, sourceRevision: original.sourceRevision, amount: 0 }] } }, f.session)
    expect((await f.finance.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toMatchObject({ required: true, status: 'verified', proof: { actualDueAmount: 70, cumulativePayableAmount: 70 } })
    const current = await f.finance.form('reimbursement', f.native.ids.expense, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: f.native.ids.expense, baseVersion: current.version, commandId: 'pay08-actual-source-version-change', action: 'save', attachments: {}, draft: { ...current.draft, note: '原費实际来源复核补注' } }, f.session)
    expect((await f.finance.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toMatchObject({ required: true, status: 'stale', proof: null })
    await expect(f.finance.execute(f.paymentRequest('pay08-stale-source-cash'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_payment_verifications')).toEqual([{ n: 1 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 20 }])
  }
  finally { await f.storage.close() }
})
