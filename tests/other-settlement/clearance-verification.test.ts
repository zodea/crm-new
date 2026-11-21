import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { isExpenseClearanceSourceDTO } from '../../app/lib/finance/clearance-verification'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementService, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { adoptHistoricalExpenseFixture } from '../helpers/other-settlement-pay08-source'

async function fixture(existingAmount?: number, missingRecord = false) {
  const root = resolve('.tmp/a02-clearance-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(`${root}/clearance-chain-`)
  const storage = createProductionStorage({ directory, workspaceId: 'clearance-synthetic-workspace', ownerId: 'clearance-synthetic-owner', purpose: 'verification' })
  const actor = { workspaceId: storage.identity.workspaceId, actorId: storage.identity.actorId, capabilities: ['supplier:list:read', 'supplier:write', 'other-settlement:read', 'other-settlement:write', 'finance-reimbursement:read', 'finance-reimbursement:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write'] }
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const session = () => structuredClone(actor)
  const supplier = createProductionSupplierService(storage)
  const service = await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'clearance-service-party', baseVersion: null, action: 'save', attachments: {}, draft: { name: '实际服务方', supplierCategory: '其他', contact: '合成服务方' } }, session)
  const payee = await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'clearance-advance-party', baseVersion: null, action: 'save', attachments: {}, draft: { name: '实际垫付收款方', supplierCategory: '其他', contact: '合成收款方' } }, session)
  const finance = createProductionFinanceService(storage, { references: (tx, current) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id) }) })
  const expense = await adoptHistoricalExpenseFixture(storage, actor, { directory, serviceId: service.id, payeeId: payee.id, serviceName: '实际服务方', payeeName: '实际垫付收款方', prefix: 'clearance-historical-original' })
  const original = (await finance.form('reimbursement', expense.id, session)).draft.lines[0]!.id!
  const owner = createProductionOtherSettlementService(storage)
  let existing: { id: string, version: string } | null = null
  if (existingAmount !== undefined) {
    const source = (await owner.expenses(session)).items[0]!
    const request = { ...identity, requiredCapability: 'other-settlement:write', commandId: 'clearance-existing-before-history', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '真实已确认历史采用', projectId: null, contractId: null, totalAmount: existingAmount, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: original, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: existingAmount }] } }
    const saved = await owner.execute(request, session)
    existing = await owner.execute({ ...request, id: saved.id, baseVersion: saved.version, action: 'confirm', commandId: 'clearance-existing-confirm' }, session)
  }
  const clearance = missingRecord ? null : await finance.execute({ ...identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', commandId: 'clearance-original-handled', baseVersion: null, action: 'save', attachments: {}, draft: { applicantSupplierId: payee.id, status: 'confirmed', reimbursementDate: '2026-10-05', lines: [{ expenseItem: '旧清偿份额30', amount: 30, originalExpenseLineId: original }] } }, session)
  const paperMissingLine = clearance ? (await finance.form('reimbursement', clearance.id, session)).draft.lines[0]!.id! : null
  const added = await finance.execute({ ...identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', commandId: 'clearance-add-alternative', id: expense.id, baseVersion: expense.version, action: 'save', draft: { id: expense.id, clearanceAttachmentsOnly: true }, attachments: { add: [{ fileName: '交叉核对签收原账.txt', fileSize: 4, payloadBase64: 'AAqA/w==', mimeType: 'application/octet-stream' }] } }, session)
  const verify = async (existingBindings: Array<{ expenseAllocationId: string, itemIndex: number, amount: number }> = []) => {
    const source = (await owner.expenses(session)).items.find(item => item.id === original)!
    const form = await finance.form('reimbursement', expense.id, session)
    return finance.execute({ ...identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', commandId: `clearance-verify-${existingBindings.length}`, id: expense.id, baseVersion: form.version, action: 'save', attachments: {}, draft: { id: expense.id, clearanceVerificationEdit: { originalExpenseLineId: original, sourceVersion: source.version, sourceHash: source.clearanceSourceHash, basis: '签收与原账逐行交叉核对，同原费用稳定编号及实际垫付人；原纸单缺失保留', fileIds: added.attachmentIds, items: [{ sourceClearanceLineId: paperMissingLine, amount: 30, matchBasis: `明确采用原费用 ${original} 的旧清偿行 ${paperMissingLine}` }], existingBindings } } }, session)
  }
  return { storage, actor, identity, session, finance, owner, expense, clearance, original, paperMissingLine, payee, service, added, verify, existing }
}

it('原费用100/缺原纸清偿30替代核实，新70及旧30显式同结算续付，成本和银行各一次并冷恢复原键', async () => {
  const f = await fixture()
  try {
    expect((await f.owner.expenses(f.session)).items[0]!.qualification.state).toBe('missing')
    const verified = await f.verify()
    let source = (await f.owner.expenses(f.session)).items[0]!
    expect(source.qualification).toMatchObject({ state: 'verified', verifiedHandledAmount: 30, newAdoptableAmount: 70, legacyObligationAmount: 30, legacyPaidAmount: 0, legacyUnpaidAmount: 30 })
    expect(source.clearances).toEqual([expect.objectContaining({ id: f.paperMissingLine, missingOriginalDocument: true, originalDocumentState: 'not-digitized' })])
    const proof = source.clearanceProofs.at(-1)!
    const request = { ...f.identity, requiredCapability: 'other-settlement:write', commandId: 'clearance-new-and-old-one-settlement', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '新70及旧30明确承接', projectId: null, contractId: null, settlementDate: '2026-10-05', totalAmount: 100, originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, consumptionVersion: source.consumptionVersion, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: proof.items[0]!.id, amount: 30 }] }] } }
    const saved = await f.owner.execute(request, f.session)
    const pending = (await f.owner.expenses(f.session)).items[0]!
    expect(pending.consumptionVersion).not.toBe(source.consumptionVersion)
    expect(pending.clearanceItemAvailability).toEqual([{ verificationId: proof.id, itemId: proof.items[0]!.id, amountRemaining: 0 }])
    await f.owner.execute({ ...request, id: saved.id, commandId: 'clearance-confirm-all', baseVersion: saved.version, action: 'confirm' }, f.session)
    source = (await f.owner.expenses(f.session)).items[0]!
    expect(source.qualification).toMatchObject({ newAdoptableAmount: 0, confirmedOtherAdoptedAmount: 100, verifiedOverlapAmount: 30, legacyObligationAmount: 30 })
    const application = await f.finance.execute({ ...f.identity, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', commandId: 'clearance-application-100', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '真实原费用全额申请', bizType: '公司付款', supplierId: f.payee.id, applyAmount: 100, applyDate: '2026-10-05', applicant: '可信核验人', invoiceState: '无需发票', settlementAllocations: [{ settlementId: saved.id, allocatedAmount: 100 }] } }, f.session)
    const paymentRequest = { ...f.identity, kind: 'payment_record' as const, requiredCapability: 'finance-payment-record:write', commandId: 'clearance-bank-100', baseVersion: null, action: 'confirm' as const, attachments: {}, draft: { supplierId: f.payee.id, payeeName: '实际垫付收款方', amount: 100, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-CLEARANCE-VOUCHER', bankSerialNo: 'SYNTHETIC-CLEARANCE-BANK', confirmedBy: '合成核验人', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 100 }] } }
    const payment = await f.finance.execute(paymentRequest, f.session)
    expect((await f.owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ total: '100.00', paid: '100.00', unpaid: '0.00' })
    expect((await f.owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ legacyPaidAmount: 30, legacyUnpaidAmount: 0 })
    expect(await f.storage.select('SELECT SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ amount: 100 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 100 }])
    await f.storage.close()
    expect(await f.finance.execute(paymentRequest, f.session)).toEqual(payment)
    expect((await f.finance.resolve('reimbursement', verified.commandId, f.session)).outcome).toBe('applied')
    expect((await f.owner.expenses(f.session)).items[0]!.qualification.newAdoptableAmount).toBe(0)
  }
  finally { await f.storage.close() }
})

it('待确认结算保留自己的旧份额，同时拒绝其他结算消耗后的旧来源', async () => {
  const f = await fixture()
  try {
    await f.verify()
    const source = (await f.owner.expenses(f.session)).items[0]!
    const proof = source.clearanceProofs.at(-1)!
    const input = { originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, consumptionVersion: source.consumptionVersion }
    const command = { ...f.identity, requiredCapability: 'other-settlement:write', action: 'submit', baseVersion: null, attachments: {} }
    const details = { name: '采用真实原费用', settlementDate: '2026-10-05' }
    const reservedDraft = { ...details, totalAmount: 100, originalExpenses: [{ ...input, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: proof.items[0]!.id, amount: 30 }] }] }
    const reserved = await f.owner.execute({ ...command, commandId: 'clearance-pending-reservation', draft: reservedDraft }, f.session)
    const afterReservation = (await f.owner.expenses(f.session)).items[0]!
    const separateDraft = { ...details, totalAmount: 10, originalExpenses: [{ ...input, consumptionVersion: afterReservation.consumptionVersion, amount: 10 }] }
    const separate = await f.owner.execute({ ...command, commandId: 'clearance-separate-submission', draft: separateDraft }, f.session)
    await f.owner.execute({ ...command, commandId: 'clearance-separate-confirmation', action: 'confirm', id: separate.id, baseVersion: separate.version, draft: separateDraft }, f.session)

    await expect(f.owner.execute({ ...command, commandId: 'clearance-reservation-conflict', action: 'confirm', id: reserved.id, baseVersion: reserved.version, draft: reservedDraft }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const unchanged = (await f.owner.detail(reserved.id, { origin: 'real' }, f.session)).settlement
    expect(unchanged).toMatchObject({ version: reserved.version, draft: { status: 'pending' } })
    expect(unchanged.clearanceLinks).toEqual([expect.objectContaining({ settlementId: reserved.id, amount: 30 })])
  }
  finally { await f.storage.close() }
})

it.each([{ existing: 30, bind: true, expected: 70 }, { existing: 70, bind: false, expected: 0 }, { existing: 70, bind: true, expected: 30 }])('已确认采用$existing/人工重叠$bind，原100/旧30按并集保新额度$expected而不生成现金', async ({ existing, bind, expected }) => {
  const f = await fixture(existing)
  try {
    const before = (await f.owner.detail(f.existing!.id, { origin: 'real' }, f.session)).settlement
    const allocation = before.expenseAllocations![0]!
    const proof = await f.verify(bind ? [{ expenseAllocationId: allocation.id, itemIndex: 0, amount: 30 }] : [])
    expect((await f.owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ newAdoptableAmount: expected, legacyObligationAmount: 30, confirmedOtherAdoptedAmount: existing, verifiedOverlapAmount: bind ? 30 : 0, legacyPaidAmount: 0, legacyUnpaidAmount: 30 })
    const after = (await f.owner.detail(f.existing!.id, { origin: 'real' }, f.session)).settlement
    expect(after.draft).toEqual(before.draft)
    expect(after.version).toBe(before.version)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 0 }])
    await expect(f.storage.execute('UPDATE finance_expense_clearance_verifications SET proof_json=? WHERE id=?', ['{}', proof.clearanceVerificationId])).rejects.toThrow('immutable')
    await expect(f.storage.execute('DELETE FROM finance_expense_clearance_verifications WHERE id=?', [proof.clearanceVerificationId])).rejects.toThrow('immutable')
    if (bind) {
      const link = after.clearanceLinks![0]!
      await expect(f.storage.execute('UPDATE expenditure_settlement_clearance_links SET amount=0 WHERE id=?', [link.id])).rejects.toThrow('immutable')
      await expect(f.storage.execute('DELETE FROM expenditure_settlement_clearance_links WHERE id=?', [link.id])).rejects.toThrow('immutable')
    }
    await f.storage.close()
    expect((await f.owner.expenses(f.session)).items[0]!.qualification.newAdoptableAmount).toBe(expected)
  }
  finally { await f.storage.close() }
})

it('原清偿记录缺失但替代原件明确采用到原费，可形成独立核定身份；不伪造清偿行或银行事实', async () => {
  const f = await fixture(undefined, true)
  try {
    expect((await f.owner.expenses(f.session)).items[0]!.qualification.newAdoptableAmount).toBe(100)
    await f.verify()
    const source = (await f.owner.expenses(f.session)).items[0]!
    expect(source.qualification).toMatchObject({ recordedHandledAmount: 0, verifiedHandledAmount: 30, newAdoptableAmount: 70, legacyObligationAmount: 30, legacyPaidAmount: 0, legacyUnpaidAmount: 30 })
    expect(source.clearanceProofs[0]!.items[0]).toMatchObject({ sourceClearanceLineId: null, amount: 30, missingOriginalDocument: true })
    expect(source.clearanceProofs[0]!.items[0]!.id).toBeTruthy()
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM expense_reimbursement_lines WHERE original_expense_line_id IS NOT NULL')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 0 }])
  }
  finally { await f.storage.close() }
})

it('已确认Other以独立原键补绑旧份额，原头和版本不变，冷核对仍有真实不可变关系', async () => {
  const f = await fixture(30)
  try {
    await f.verify()
    const before = await f.owner.detail(f.existing!.id, { origin: 'real' }, f.session)
    const source = (await f.owner.expenses(f.session)).items[0]!
    expect(source.qualification.newAdoptableAmount).toBe(40)
    const proof = source.clearanceProofs.at(-1)!
    const request = { ...f.identity, requiredCapability: 'other-settlement:write', id: f.existing!.id, baseVersion: f.existing!.version, commandId: 'clearance-append-stable-old-relation', action: 'save' as const, attachments: {}, draft: { id: f.existing!.id, clearanceLinkEdit: { verificationId: proof.id, bindings: [{ expenseAllocationId: before.settlement.expenseAllocations![0]!.id, itemId: proof.items[0]!.id, amount: 30 }] } } }
    const result = await f.owner.execute(request, f.session)
    expect(result.version).toBe(before.settlement.version)
    expect(result.clearanceLinkIds).toHaveLength(1)
    expect(await f.owner.execute(request, f.session)).toEqual(result)
    const after = await f.owner.detail(result.id, { origin: 'real' }, f.session)
    expect(after.settlement.draft).toEqual(before.settlement.draft)
    expect(after.history).toEqual(before.history)
    expect((await f.owner.expenses(f.session)).items[0]!.qualification.newAdoptableAmount).toBe(70)
    await f.storage.close()
    expect(await f.owner.resolve(request.commandId, f.session)).toEqual({ outcome: 'applied', result })
  }
  finally { await f.storage.close() }
})

it('真实费用读权不能泄漏Other核定关系或现金，撤权后派生资格未知且核定无写', async () => {
  const f = await fixture(30)
  try {
    await f.verify()
    const feeOnly = () => ({ ...f.actor, capabilities: ['finance-reimbursement:read', 'finance-reimbursement:write'] })
    const form = await f.finance.form('reimbursement', f.expense.id, feeOnly)
    expect(form.draft.clearanceVerification).toMatchObject({ status: 'unavailable', proofs: [], sources: [expect.objectContaining({ clearanceProofs: [], clearanceLinks: [], clearanceItemAvailability: [], qualification: expect.objectContaining({ newAdoptableAmount: null, confirmedOtherAdoptedAmount: null, legacyPaidAmount: null, legacyUnpaidAmount: null }) })] })
    const source = (await f.owner.expenses(f.session)).items[0]!
    const denied = { ...f.identity, kind: 'reimbursement' as const, requiredCapability: 'finance-reimbursement:write', id: f.expense.id, baseVersion: form.version, commandId: 'clearance-assert-no-private-write', action: 'save' as const, attachments: {}, draft: { id: f.expense.id, clearanceVerificationEdit: { originalExpenseLineId: source.id, sourceVersion: source.version, sourceHash: source.clearanceSourceHash, basis: '缺读取占用权限不得核定', fileIds: f.added.attachmentIds, items: [{ sourceClearanceLineId: f.paperMissingLine, amount: 30, matchBasis: '明确原来源' }], existingBindings: [] } } }
    await expect(f.finance.execute(denied, feeOnly)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_commands WHERE command_id=?', [denied.commandId])).toEqual([{ n: 0 }])
  }
  finally { await f.storage.close() }
})

it('真实普通原费用有限正数历史精度保持，不因新资格DTO强制两位读取或伪造零', async () => {
  const f = await fixture(undefined, true)
  try {
    const before = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: f.expense.id, baseVersion: before.version, commandId: 'clearance-ordinary-precision-source', action: 'save', attachments: {}, draft: { ...before.draft, lines: before.draft.lines.map(line => ({ ...line, amount: 0.125 })) } }, f.session)
    const source = (await f.owner.expenses(f.session)).items[0]!
    expect(source.amount).toBe(0.125)
    expect(source.qualification.newAdoptableAmount).toBe(0.125)
    expect(isExpenseClearanceSourceDTO(source)).toBe(true)
  }
  finally { await f.storage.close() }
})

it('同核定稳定item重核不能删除原义务或释放旧链接，相关C版本或原件变化使当前核定stale', async () => {
  const f = await fixture(30)
  try {
    const allocation = (await f.owner.detail(f.existing!.id, { origin: 'real' }, f.session)).settlement.expenseAllocations![0]!
    await f.verify([{ expenseAllocationId: allocation.id, itemIndex: 0, amount: 30 }])
    const first = (await f.owner.expenses(f.session)).items[0]!
    const oldItem = first.clearanceProofs.at(-1)!.items[0]!.id
    const c = await f.finance.form('reimbursement', f.clearance!.id, f.session)
    await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: c.draft.id, baseVersion: c.version, commandId: 'clearance-related-C-document-later', action: 'save', attachments: { add: [{ fileName: '真实后来清偿原件.bin', fileSize: 4, payloadBase64: 'AAqA/w==', mimeType: 'application/octet-stream' }] }, draft: { id: c.draft.id, clearanceAttachmentsOnly: true } }, f.session)
    expect((await f.owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ state: 'stale', newAdoptableAmount: null })
    const source = (await f.owner.expenses(f.session)).items[0]!
    const head = await f.finance.form('reimbursement', f.expense.id, f.session)
    const request = { ...f.identity, kind: 'reimbursement' as const, requiredCapability: 'finance-reimbursement:write', id: f.expense.id, baseVersion: head.version, commandId: 'clearance-related-reverified', action: 'save' as const, attachments: {}, draft: { id: f.expense.id, clearanceVerificationEdit: { originalExpenseLineId: source.id, sourceVersion: source.version, sourceHash: source.clearanceSourceHash, basis: '真实后来原件对同一旧份额重新核实，保旧ID与义务', fileIds: f.added.attachmentIds, items: [{ id: oldItem, sourceClearanceLineId: f.paperMissingLine, amount: 30, matchBasis: '保持原30稳定份额而非再次认领' }], existingBindings: [] } } }
    await f.finance.execute(request, f.session)
    const latest = (await f.owner.expenses(f.session)).items[0]!
    expect(latest.clearanceProofs.at(-1)!.items[0]!.id).toBe(oldItem)
    expect(latest.qualification).toMatchObject({ state: 'verified', verifiedHandledAmount: 30, verifiedOverlapAmount: 30, newAdoptableAmount: 70 })
    expect(latest.clearanceLinks).toHaveLength(1)
  }
  finally { await f.storage.close() }
})

it('同结算100含旧30及新70，实际部分付40不能猜先付旧30，源资格与原义务保持', async () => {
  const f = await fixture()
  try {
    await f.verify()
    const source = (await f.owner.expenses(f.session)).items[0]!
    const proof = source.clearanceProofs.at(-1)!
    const request = { ...f.identity, requiredCapability: 'other-settlement:write', commandId: 'clearance-partial-mixed-submit', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '部分现金不可分摊猜旧份额', settlementDate: '2026-10-05', totalAmount: 100, originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: proof.items[0]!.id, amount: 30 }] }] } }
    const saved = await f.owner.execute(request, f.session)
    await f.owner.execute({ ...request, id: saved.id, baseVersion: saved.version, action: 'confirm', commandId: 'clearance-partial-mixed-confirm' }, f.session)
    const application = await f.finance.execute({ ...f.identity, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', commandId: 'clearance-partial-application', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '真实合并份额申请', bizType: '公司付款', supplierId: f.payee.id, applyAmount: 100, applyDate: '2026-10-05', applicant: '合成核验人', invoiceState: '无需发票', settlementAllocations: [{ settlementId: saved.id, allocatedAmount: 100 }] } }, f.session)
    await f.finance.execute({ ...f.identity, kind: 'payment_record', requiredCapability: 'finance-payment-record:write', commandId: 'clearance-real-partial-40', baseVersion: null, action: 'confirm', attachments: {}, draft: { supplierId: f.payee.id, payeeName: '实际垫付收款方', amount: 40, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-PARTIAL-40', bankSerialNo: 'SYNTHETIC-PARTIAL-BANK-40', confirmedBy: '合成核验人', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 40 }] } }, f.session)
    expect((await f.owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ paid: '40.00', unpaid: '60.00' })
    expect((await f.owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ state: 'verified', newAdoptableAmount: 0, legacyObligationAmount: 30, legacyPaidAmount: null, legacyUnpaidAmount: null })
  }
  finally { await f.storage.close() }
})

it('成功核定回执不能在实际proof被删除后仍健康，原不可变保护与反向journal均独立验真', async () => {
  const f = await fixture()
  try {
    const result = await f.verify()
    await f.storage.withTransaction(tx => validateFinanceJournal(tx, f.actor))
    await expect(f.storage.execute('DELETE FROM finance_expense_clearance_verifications WHERE id=?', [result.clearanceVerificationId])).rejects.toThrow('immutable')
    // An isolated damaged clone can lose a table's guard; the journal must still detect the missing fact from its intact success receipt.
    await f.storage.execute('DROP TRIGGER finance_expense_clearance_verifications_no_delete')
    await f.storage.execute('DELETE FROM finance_expense_clearance_verifications WHERE id=?', [result.clearanceVerificationId])
    await f.storage.execute('CREATE TRIGGER finance_expense_clearance_verifications_no_delete BEFORE DELETE ON finance_expense_clearance_verifications BEGIN SELECT RAISE(ABORT,\'clearance verification evidence is immutable\'); END')
    await expect(f.storage.withTransaction(tx => validateFinanceJournal(tx, f.actor))).rejects.toThrow('成功回执缺少')
  }
  finally { await f.storage.close() }
})
