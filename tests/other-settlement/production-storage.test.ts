import type { OtherSettlementCommand } from '~/lib/other-settlement/contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateOtherSettlementJournal } from '~/lib/other-settlement/storage'
import { formDefaults } from '../../app/lib/master-data/page'
import { readWorkerReference } from '../../server/utils/production-crew-worker-references'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementService, listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { installConstructionEngineeringFixture } from '../helpers/production-construction-scope-fixture'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'

async function fixture(workerPayee = false) {
  const root = resolve('.tmp/a02-material-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(`${root}/other-settlement-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'other-workspace', ownerId: 'other-owner', purpose: 'verification' })
  const actor = { workspaceId: 'other-workspace', actorId: 'other-owner', capabilities: ['other-settlement:read', 'other-settlement:write', 'supplier:list:read', 'supplier:write', 'finance-reimbursement:read', 'finance-reimbursement:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write'] }
  const session = () => structuredClone(actor)
  const engineering = await installConstructionEngineeringFixture(storage, actor, 'other-engineering')
  const supplierService = createProductionSupplierService(storage)
  const supplier = await supplierService.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'create-service-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '实际服务交易方', supplierCategory: '其他', contact: '合成人' } }, session)
  const payee = await supplierService.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'create-payee-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '实际垫付人', supplierCategory: '其他', contact: '合成人' } }, session)
  if (workerPayee)
    actor.capabilities.push('crew:list:read', 'worker:list:read', 'worker:write')
  const worker = workerPayee ? await createProductionCrewWorkerService(storage).executeWorker({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'worker:write', commandId: 'create-worker-payee', baseVersion: null, action: 'save', attachments: {}, draft: { ...formDefaults('worker'), name: '实际垫付工人', phone: '13800000011', trade: '泥工', bankName: '合成测试银行', bankAccount: 'synthetic-bank-account', dailyWage: 0 } }, session) : null
  const finance = createProductionFinanceService(storage, { references: (tx, current) => ({ workers: async (id) => {
    const person = await readWorkerReference(tx, current, id)
    return person ? { id: person.id, name: person.name, deleted_at: null, status: 'active' } : null
  }, expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id), settlementCandidates: () => listProductionOtherSettlementReferences(tx, current) }) })
  const expense = await finance.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'finance-reimbursement:write', commandId: 'source-original-expense', kind: 'reimbursement', baseVersion: null, action: 'save', attachments: {}, draft: { projectId: engineering.project.id, constructionMain: engineering.constructionMain, applicantSupplierId: worker ? null : payee.id, applicantWorkerId: worker?.id ?? null, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '实际项目无合同费用', counterpartySupplierId: supplier.id, amount: 100 }] } }, session)
  const owner = createProductionOtherSettlementService(storage)
  const source = (await owner.expenses(session)).items[0]!
  const request: OtherSettlementCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'other-original-command', baseVersion: null, action: 'submit', attachments: { add: [{ fileName: '原结算.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, draft: { name: '实际无合同费用结算', projectId: engineering.project.id, contractId: null, totalAmount: 70, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: 70 }] } }
  return { storage, actor, session, owner, finance, supplier, payee, worker, source, expense, request, project: engineering.project }
}
describe('同一真实持久存储无合同费用结算', () => {
  it.each([false, true])('原费用→结算→实际%s收款人申请→确认支付，同owner冷开只记一次成本与现金', { timeout: 15000 }, async (workerPayee) => {
    const f = await fixture(workerPayee)
    try {
      const saved = await f.owner.execute({ ...f.request, attachments: {} }, f.session)
      const confirmed = await f.owner.execute({ ...f.request, attachments: {}, id: saved.id, baseVersion: '1', commandId: 'actual-chain-confirm', action: 'confirm' }, f.session)
      const supplierId = f.worker ? null : f.payee.id
      const workerId = f.worker?.id ?? null
      const actualName = f.worker ? '实际垫付工人' : '实际垫付人'
      const applicationRequest = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-application:write', commandId: 'actual-chain-application', kind: 'payment_application' as const, baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '真实原费用付款申请', projectId: f.project.id, bizType: '项目费用', supplierId, workerId, applyAmount: 70, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票' as const, settlementAllocations: [{ settlementId: saved.id, allocatedAmount: 70 }] } }
      const application = await f.finance.execute(applicationRequest, f.session)
      expect(await f.finance.execute(applicationRequest, f.session)).toEqual(application)
      const paymentRequest = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-record:write', commandId: 'actual-chain-payment', kind: 'payment_record' as const, baseVersion: null, action: 'confirm' as const, attachments: {}, draft: { projectId: f.project.id, supplierId, workerId, payeeName: actualName, amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-CHAIN-VOUCHER', bankSerialNo: 'SYNTHETIC-CHAIN-BANK', confirmedBy: '合成财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] } }
      const payment = await f.finance.execute(paymentRequest, f.session)
      await f.storage.close()
      expect(await f.finance.execute(paymentRequest, f.session)).toEqual(payment)
      const detail = await f.owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(detail.settlement.version).toBe(confirmed.version)
      expect(detail.settlement.draft).toMatchObject({ supplierId: f.supplier.id, payeeSupplierId: supplierId, payeeWorkerId: workerId, payeeNameSnapshot: actualName })
      expect(detail.settlement.amounts).toMatchObject({ total: '70.00', net: '70.00', applied: '70.00', applicable: '0.00', paid: '30.00', unpaid: '40.00' })
      expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, amount: 100 }])
      expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 30 }])
      const applicationFact = detail.facts!.find(fact => fact.kind === 'application' && fact.sourceId === application.id)!
      const paymentFact = detail.facts!.find(fact => fact.kind === 'payment' && fact.sourceId === payment.id)!
      expect(await f.owner.source(saved.id, applicationFact.id, f.session)).toMatchObject({ kind: 'application', id: application.id, amount: '70.00' })
      expect(await f.owner.source(saved.id, paymentFact.id, f.session)).toMatchObject({ kind: 'payment', id: payment.id, amount: '30.00' })
      const unreadable = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read') })
      expect((await f.owner.detail(saved.id, { origin: 'real' }, unreadable)).settlement.amounts.paid).toBeNull()
      await expect(f.owner.source(saved.id, paymentFact.id, unreadable)).rejects.toThrow('不可读取')
      // A leftover revision table cannot claim a readable owner when the actual participant is absent.
      await f.storage.execute('DELETE FROM production_participants WHERE domain=\'finance\'')
      const disconnected = await f.owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(disconnected.settlement.amounts.paid).toBeNull()
      expect(disconnected.meta.sources.find(source => source.key === 'finance')).toMatchObject({ state: 'unavailable', sourceVersion: null, asOf: null })
      await f.storage.execute('INSERT INTO production_participants VALUES(\'finance\',1)')
      // A damaged historical deletion remains evidence: it must never erase real cash or release another claim.
      await f.storage.execute('UPDATE payment_applications SET deleted_at=? WHERE id=?', ['2026-10-05T03:00:00.000Z', application.id])
      const historical = await f.owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(historical.settlement.amounts).toMatchObject({ total: '70.00', net: '70.00', applied: null, applicable: null, paid: '30.00', unpaid: '40.00' })
      expect(historical.facts!.find(fact => fact.kind === 'application')).toMatchObject({ sourceId: application.id, amount: null, unavailableReason: expect.stringContaining('已确认现金') })
      expect(await f.owner.source(saved.id, paymentFact.id, f.session)).toMatchObject({ kind: 'payment', id: payment.id, amount: '30.00' })
      for (const amount of [10, 70]) {
        await expect(f.finance.execute({ ...applicationRequest, commandId: `old-deleted-reclaim-${amount}`, draft: { ...applicationRequest.draft, applyAmount: amount, settlementAllocations: [{ settlementId: saved.id, allocatedAmount: amount }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('余款资格') } })
      }
      expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, amount: 100 }])
      expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 30 }])
      expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_applications')).toEqual([{ n: 1 }])
    }
    finally {
      await f.storage.close()
    }
  })
  it('采用原费冻结两种身份；冷重启原键恢复、原件与真实净额不制造付款或第二成本', async () => {
    const f = await fixture()
    try {
      const saved = await f.owner.execute(f.request, f.session)
      expect(await f.owner.execute(f.request, f.session)).toEqual(saved)
      const detail = await f.owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(detail.settlement.draft).toMatchObject({ projectId: f.project.id, contractId: null, supplierId: f.supplier.id, payeeSupplierId: f.payee.id, payeeWorkerId: null, payeeNameSnapshot: '实际垫付人', totalAmount: 70, taxRate: null, status: 'pending' })
      expect(detail.settlement.amounts).toMatchObject({ total: '70.00', deductions: '0.00', net: '70.00', applied: '0.00', paid: '0.00', taxExclusive: null, tax: null })
      const confirm = await f.owner.execute({ ...f.request, id: saved.id, baseVersion: '1', commandId: 'other-confirm', action: 'confirm', attachments: {} }, f.session)
      await f.storage.close()
      expect(await f.owner.resolve(f.request.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
      expect(await f.owner.original(saved.id, saved.attachmentIds[0]!, null, f.session)).toMatchObject({ payloadBase64: 'YWJj', ownerId: saved.id })
      expect((await f.owner.detail(saved.id, { origin: 'real' }, f.session)).history.map(row => row.version)).toEqual(['1', '2'])
      expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 0 }])
      expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM expense_reimbursement_lines')).toEqual([{ n: 1, amount: 100 }])
      const reference = await f.storage.withTransaction(tx => readProductionOtherSettlementReference(tx, f.actor, saved.id))
      expect(reference).toMatchObject({ supplier_id: f.payee.id, worker_id: null, total_amount: 70, status: 'confirmed', original_expense_line_ids: [f.source.id], service_supplier_id: f.supplier.id })
      await expect(f.owner.execute({ ...f.request, id: saved.id, baseVersion: confirm.version, commandId: 'edit-frozen', action: 'save', attachments: {} }, f.session)).rejects.toThrow('已确认')
      await expect(f.storage.execute('UPDATE expenditure_settlements SET total_amount=0 WHERE id=?', [saved.id])).rejects.toThrow('immutable')
      await expect(f.storage.execute('INSERT INTO expenditure_settlement_expense_allocations VALUES(?,?,?,?,?,?,?,?,?,NULL)', ['injected', saved.id, 'another', '1', 'finance-1', 0, '{}', '2026-10-05T01:00:00.000Z', 'other-owner'])).rejects.toThrow('immutable')
    }
    finally {
      await f.storage.close()
    }
  })
  it('提交结果未知原编号封存阻止迟到写；版本冲突与错误来源版本都保原图', async () => {
    const f = await fixture()
    try {
      expect(await f.owner.resolve('never-written', f.session)).toEqual({ outcome: 'not-applied', commandId: 'never-written' })
      await expect(f.owner.execute({ ...f.request, commandId: 'never-written' }, f.session)).rejects.toThrow('封存')
      const saved = await f.owner.execute({ ...f.request, action: 'draft' }, f.session)
      await expect(f.owner.execute({ ...f.request, id: saved.id, baseVersion: '0', commandId: 'stale', attachments: {} }, f.session)).rejects.toThrow('已有更新')
      await expect(f.owner.execute({ ...f.request, id: saved.id, baseVersion: '1', commandId: 'bad-source', attachments: {}, draft: { ...f.request.draft, originalExpenses: [{ ...f.request.draft.originalExpenses![0]!, sourceVersion: 'not-current' }] } }, f.session)).rejects.toThrow('来源版本')
      expect((await f.owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.version).toBe('1')
      await expect(f.owner.execute({ ...f.request, commandId: 'bad-bytes', attachments: { add: [{ fileName: 'no-body', fileSize: 3 }] } }, f.session)).rejects.toThrow('正文')
      expect(await f.storage.select('SELECT COUNT(*) AS n FROM expenditure_settlements')).toEqual([{ n: 1 }])
      await validateOtherSettlementJournal(f.storage, f.actor)
    }
    finally {
      await f.storage.close()
    }
  })
  it('明确零采用可确认，未知只能草稿；累计确认采用不能超原费用，不能换收款人', async () => {
    const f = await fixture()
    try {
      const zero = { ...f.request, commandId: 'zero', attachments: {}, draft: { ...f.request.draft, totalAmount: 0, originalExpenses: [{ ...f.request.draft.originalExpenses![0]!, amount: 0 }] } }
      const saved = await f.owner.execute(zero, f.session)
      await f.owner.execute({ ...zero, id: saved.id, baseVersion: '1', commandId: 'confirm-zero', action: 'confirm' }, f.session)
      expect((await f.owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.amounts.net).toBe('0.00')
      const unknown = { ...zero, commandId: 'unknown-draft', action: 'draft' as const, draft: { ...zero.draft, totalAmount: null, originalExpenses: [{ ...zero.draft.originalExpenses[0]!, amount: null }] } }
      const nullSaved = await f.owner.execute(unknown, f.session)
      expect((await f.owner.detail(nullSaved.id, { origin: 'real' }, f.session)).settlement.amounts.total).toBeNull()
      await expect(f.owner.execute({ ...unknown, id: nullSaved.id, baseVersion: '1', commandId: 'unknown-submit', action: 'submit' }, f.session)).rejects.toThrow('补全')
      await expect(f.owner.execute({ ...f.request, commandId: 'wrong-payee', draft: { ...f.request.draft, payeeSupplierId: f.supplier.id } }, f.session)).rejects.toThrow('实际收款身份')
      const first = await f.owner.execute({ ...f.request, commandId: 'adopt-70', attachments: {} }, f.session)
      await f.owner.execute({ ...f.request, id: first.id, baseVersion: '1', commandId: 'confirm-70', action: 'confirm', attachments: {} }, f.session)
      await expect(f.owner.execute({ ...f.request, commandId: 'adopt-extra-70', attachments: {} }, f.session)).rejects.toThrow('额度')
    }
    finally {
      await f.storage.close()
    }
  })
})
