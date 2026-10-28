import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementService, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { installConstructionEngineeringFixture } from '../helpers/production-construction-scope-fixture'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const root = testTempRoot('a02-clearance-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(`${root}/stable-payee-synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'stable-payee-workspace', ownerId: 'stable-payee-owner', purpose: 'verification' })
  const actor = { workspaceId: storage.identity.workspaceId, actorId: storage.identity.actorId, capabilities: ['supplier:list:read', 'supplier:write', 'other-settlement:read', 'other-settlement:write', 'finance-reimbursement:read', 'finance-reimbursement:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write'] }
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const session = () => structuredClone(actor)
  const engineering = await installConstructionEngineeringFixture(storage, actor, 'stable-engineering')
  const suppliers = createProductionSupplierService(storage)
  const payee = await suppliers.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'stable-payee-master', baseVersion: null, action: 'save', attachments: {}, draft: { name: '原实际垫付收款人', supplierCategory: '其他', contact: '合成联系人' } }, session)
  const service = await suppliers.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'stable-service-master', baseVersion: null, action: 'save', attachments: {}, draft: { name: '真实服务交易方', supplierCategory: '其他', contact: '合成服务人' } }, session)
  const finance = createProductionFinanceService(storage, { references: (tx, current) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id) }) })
  const owner = createProductionOtherSettlementService(storage)
  const expense = await finance.execute({ ...identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', commandId: 'stable-original-cost', baseVersion: null, action: 'save', attachments: { add: [{ fileName: '原費真实证据.bin', fileSize: 4, payloadBase64: 'AAqA/w==', mimeType: 'application/octet-stream' }] }, draft: { projectId: engineering.project.id, constructionMain: engineering.constructionMain, status: 'confirmed', applicantSupplierId: payee.id, reimbursementDate: '2026-10-05', lines: [{ expenseItem: '真实原费用100', amount: 100, counterpartySupplierId: service.id }] } }, session)
  const original = (await finance.form('reimbursement', expense.id, session)).draft.lines[0]!.id!
  const rename = async (name: string, commandId: string) => {
    const form = await suppliers.form(payee.id, session)
    return suppliers.execute({ ...identity, requiredCapability: 'supplier:write', id: payee.id, baseVersion: form.version, commandId, action: 'save', attachments: {}, draft: { ...form.draft, name } }, session, payee.id)
  }
  const settle = async () => {
    const source = (await owner.expenses(session)).items[0]!
    const request = { ...identity, requiredCapability: 'other-settlement:write', commandId: 'stable-original-settlement', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '同一原費采用100', projectId: engineering.project.id, totalAmount: 100, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: 100 }] } }
    const saved = await owner.execute(request, session)
    return owner.execute({ ...request, id: saved.id, baseVersion: saved.version, commandId: 'stable-original-settlement-confirm', action: 'confirm' }, session)
  }
  const apply = (settlementId: string, supplierId = payee.id, commandId = `stable-apply-${supplierId}`) => finance.execute({ ...identity, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', commandId, baseVersion: null, action: 'submit', attachments: {}, draft: { name: '真实同ID申请', projectId: engineering.project.id, bizType: '项目费用', supplierId, applyAmount: 100, applyDate: '2026-10-05', applicant: '合成申请人', invoiceState: '无需发票', settlementAllocations: [{ settlementId, allocatedAmount: 100 }] } }, session)
  const pay = (applicationId: string) => finance.execute({ ...identity, kind: 'payment_record', requiredCapability: 'finance-payment-record:write', commandId: 'stable-real-bank-100', baseVersion: null, action: 'confirm', attachments: {}, draft: { projectId: engineering.project.id, supplierId: payee.id, payeeName: '当前实付收款人', amount: 100, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-STABLE-VOUCHER', bankSerialNo: 'SYNTHETIC-STABLE-BANK', confirmedBy: '合成确认人', applicationAllocations: [{ paymentApplicationId: applicationId, allocatedAmount: 100 }] } }, session)
  return { storage, actor, identity, session, suppliers, payee, service, finance, owner, expense, original, rename, settle, apply, pay, project: engineering.project }
}

it('同一真实收款稳定ID先后更名，原费/结算/申请/银行各冻当时姓名，采用和实付100仍可核且冷开保旧快照', async () => {
  const f = await fixture()
  try {
    const settlement = await f.settle()
    await f.rename('实际垫付收款人', 'stable-rename-before-application')
    const application = await f.apply(settlement.id)
    await f.rename('当前实付收款人', 'stable-rename-before-bank')
    const payment = await f.pay(application.id)
    const detail = await f.owner.detail(settlement.id, { origin: 'real' }, f.session)
    expect(detail.settlement.amounts).toMatchObject({ total: '100.00', net: '100.00', applied: '100.00', paid: '100.00', unpaid: '0.00' })
    expect(detail.settlement.draft.payeeNameSnapshot).toBe('原实际垫付收款人')
    expect((await f.finance.form('reimbursement', f.expense.id, f.session)).draft.applicantNameSnapshot).toBe('原实际垫付收款人')
    expect((await f.finance.form('payment_application', application.id, f.session)).draft.payeeNameSnapshot).toBe('实际垫付收款人')
    expect((await f.finance.form('payment_record', payment.id, f.session)).draft.payeeNameSnapshot).toBe('当前实付收款人')
    await f.storage.close()
    expect((await f.owner.detail(settlement.id, { origin: 'real' }, f.session)).settlement.amounts.paid).toBe('100.00')
    // Simulate a retained historical deletion: cash must stay visible and new claim capacity must not be released.
    await f.storage.execute('UPDATE payment_applications SET deleted_at=? WHERE id=?', ['2026-10-05T06:00:00.000Z', application.id])
    expect((await f.owner.detail(settlement.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ applied: null, paid: '100.00', unpaid: '0.00' })
    await expect(f.apply(settlement.id, f.payee.id, 'stable-reclaim-after-historical-delete')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await f.storage.close() }
})

it('不同stableID即使同名不能采用原结算，不因撤下文本关联校验而混作同一收款人', async () => {
  const f = await fixture()
  try {
    const settlement = await f.settle()
    const another = await f.suppliers.execute({ ...f.identity, requiredCapability: 'supplier:write', commandId: 'stable-same-name-another-id', baseVersion: null, action: 'save', attachments: {}, draft: { name: '原实际垫付收款人', supplierCategory: '其他', contact: '另一个同名主体' } }, f.session)
    expect(another.id).not.toBe(f.payee.id)
    await expect(f.apply(settlement.id, another.id)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_applications')).toEqual([{ n: 0 }])
    expect((await f.owner.detail(settlement.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ applied: '0.00', paid: '0.00' })
  }
  finally { await f.storage.close() }
})

it('原费与后来清偿同stableID不同历史姓名可以明确核定，不改任一旧快照', async () => {
  const f = await fixture()
  try {
    await f.rename('实际垫付收款人', 'stable-rename-before-clearance')
    const clearance = await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', commandId: 'stable-later-clearance', baseVersion: null, action: 'save', attachments: {}, draft: { projectId: f.project.id, status: 'confirmed', applicantSupplierId: f.payee.id, reimbursementDate: '2026-10-05', lines: [{ expenseItem: '同真实人后来清偿30', amount: 30, originalExpenseLineId: f.original }] } }, f.session)
    const clearanceLine = (await f.finance.form('reimbursement', clearance.id, f.session)).draft.lines[0]!.id!
    const source = (await f.owner.expenses(f.session)).items[0]!
    const form = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: f.expense.id, baseVersion: form.version, commandId: 'stable-name-history-verification', action: 'save', attachments: {}, draft: { id: f.expense.id, clearanceVerificationEdit: { originalExpenseLineId: source.id, sourceVersion: source.version, sourceHash: source.clearanceSourceHash, basis: '同稳定ID的原费与后来清偿，各自原名真实保留；真实原件交叉核对', fileIds: f.expense.attachmentIds, items: [{ sourceClearanceLineId: clearanceLine, amount: 30, matchBasis: '明确采用真实原费用与清偿稳定行ID' }], existingBindings: [] } } }, f.session)
    expect((await f.owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ state: 'verified', newAdoptableAmount: 70 })
    expect((await f.finance.form('reimbursement', f.expense.id, f.session)).draft.applicantNameSnapshot).toBe('原实际垫付收款人')
    expect((await f.finance.form('reimbursement', clearance.id, f.session)).draft.applicantNameSnapshot).toBe('实际垫付收款人')
  }
  finally { await f.storage.close() }
})
