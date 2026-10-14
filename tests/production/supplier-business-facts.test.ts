import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import type { MaterialContractCommandRequestDTO } from '../../app/lib/material-contract/command-contract'
import type { OtherSettlementCommand } from '../../app/lib/other-settlement/contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { softDelete } from '../../app/lib/db/soft-delete'
import { FINANCE_CAPABILITIES, FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { decodeSupplierDetailRead, decodeSupplierListPage } from '../../app/lib/supplier/read-decoder'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { financeRecordSnapshot, validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { financeCommandFingerprint } from '../../server/utils/production-finance-request'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionMaterialContractService } from '../../server/utils/production-material-contract-service'
import { createProductionOtherSettlementService, listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'

const AS_OF = '2026-10-05T01:00:00.000Z'
async function fixture() {
  const base = resolve('.tmp/a03-supplier-read-facts')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'supplier-facts-workspace', ownerId: 'supplier-facts-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', 'material-contract:read', 'other-settlement:read', 'other-settlement:write', ...FINANCE_CAPABILITIES] }
  const session = () => structuredClone(actor)
  const owner = createProductionSupplierService(storage, { now: () => AS_OF })
  const baseCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const first = await owner.execute({ ...baseCommand, commandId: 'create-first', requiredCapability: 'supplier:write', draft: { name: '真实服务交易方甲', supplierCategory: '其他', contact: '合成人' } }, session)
  const second = await owner.execute({ ...baseCommand, commandId: 'create-second', requiredCapability: 'supplier:write', draft: { name: '真实垫付收款方乙', supplierCategory: '其他', contact: '合成人' } }, session)
  const customer = await createProductionCustomerService(storage).execute({ ...baseCommand, commandId: 'create-customer', requiredCapability: 'customer:write', draft: { name: '独立客户', contact: '合成人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...baseCommand, commandId: 'create-project', requiredCapability: 'project:write', draft: { name: '正式真实项目名称', customerId: customer.id, manager: '合成人' } }, session)
  const finance = createProductionFinanceService(storage, { references: (tx, current) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id), settlementCandidates: () => listProductionOtherSettlementReferences(tx, current) }) })
  const request = (kind: FinanceCommand['kind'], commandId: string, draft: FinanceCommand['draft'], action: FinanceCommand['action'] = 'submit'): FinanceCommand => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: `${FINANCE_FAMILIES[kind]}:write`, kind, commandId, draft, baseVersion: null, action, attachments: {} })
  async function application(id: string, supplierId = first.id, approvedAmount: number | null = null) {
    return finance.execute(request('payment_application', id, { name: id, bizType: '预付款', projectId: project.id, supplierId, applyAmount: 100, approvedAmount, applyDate: '2026-10-05', applicant: '真实财务', invoiceState: '无需发票' }), session)
  }
  async function payment(applicationId: string, supplierId = first.id, amount = 25) {
    return finance.execute(request('payment_record', `payment-${applicationId}`, { projectId: project.id, supplierId, payeeName: supplierId === first.id ? '真实服务交易方甲' : '真实垫付收款方乙', amount, paymentDate: '2026-10-05', voucherNo: `V-${applicationId}`, bankSerialNo: `B-${applicationId}`, applicationAllocations: [{ paymentApplicationId: applicationId, allocatedAmount: amount }] }), session)
  }
  async function confirm(record: { id: string, version: string }) {
    return finance.execute({ ...request('payment_record', `confirm-${record.id}`, { ...(await finance.form('payment_record', record.id, session)).draft, confirmedBy: '真实确认人' }, 'confirm'), id: record.id, baseVersion: record.version }, session)
  }
  async function engineering(prefix: string) {
    for (const capability of ['our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write']) {
      if (!actor.capabilities.includes(capability))
        actor.capabilities.push(capability)
    }
    const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: `${prefix}-own-party`, baseVersion: null, draft: { name: '真实签约主体', taxNo: `${prefix}-TAX`, registeredAddress: null, legalRepresentative: null, verificationNote: '真实工程身份核验', status: 'active' } }, session)
    const main = await createProductionConstructionContractService(storage).execute({ ...baseCommand, commandId: `${prefix}-upstream-main`, requiredCapability: 'construction-contract:write', draft: { name: '实际施工主合同', projectId: project.id, customerId: customer.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, content: '真实业务工程', signDate: '2026-10-05', amount: null } }, session)
    const fact = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
    return { signatory, constructionMain: { id: main.id, projectId: project.id, basis: fact.basis } }
  }
  return { storage, options, actor, session, owner, finance, first, second, project, request, application, payment, confirm, engineering }
}

it('实际SQLite付款确认前为真实零，确认后只按原收款方分摊；冷重启保原版本且所有GET只读', async () => {
  const f = await fixture()
  try {
    const before = decodeSupplierListPage(await f.owner.list({}, f.session))
    expect(before.items.map(row => row.paymentAmount)).toEqual(['0.00', '0.00'])
    expect(before.items.every(row => row.projectCount === null && row.contractAmount === null && row.settlementAmount === null)).toBe(true)
    const application = await f.application('application-first')
    const payment = await f.payment(application.id)
    expect(decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session)).payments[0]).toMatchObject({ actualPaidAmount: '0.00', approvedAmount: null, approvedAmountState: 'not-entered', project: { id: f.project.id, label: '正式真实项目名称', state: 'resolved' } })
    const pendingVersion = (await f.owner.list({}, f.session)).sourceVersion
    const confirmed = await f.confirm(payment)
    const page = decodeSupplierListPage(await f.owner.list({ sort: 'paymentAmount-desc' }, f.session))
    expect(page.items.map(row => [row.supplier.id, row.paymentAmount])).toEqual([[f.first.id, '25.00'], [f.second.id, '0.00']])
    expect(page.sourceVersion).not.toBe(pendingVersion)
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(detail.summary.paymentAmount).toMatchObject({ status: 'complete', value: '25.00', knownValue: '25.00', missingSources: [] })
    expect(detail.unavailableSources).toContain('projects')
    expect(detail.summary).toMatchObject({ projectCount: null, contractCount: null, settlementCount: null, payableAmount: { value: null, knownValue: null }, invoiceAmount: { value: null, knownValue: null } })
    const history = await f.storage.select('SELECT * FROM finance_history ORDER BY kind,id,version')
    const audit = await f.storage.select('SELECT * FROM operation_logs ORDER BY id')
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionSupplierService(reopened, { now: () => AS_OF })
      const transaction = vi.spyOn(reopened, 'withTransaction')
      expect(decodeSupplierDetailRead(await owner.detail(f.first.id, {}, f.session))).toEqual(detail)
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(decodeSupplierListPage(await owner.list({ columnFilters: { ranges: { paymentAmount: { min: 25, max: 25 } } } }, f.session)).items.map(row => row.supplier.id)).toEqual([f.first.id])
      expect(await reopened.select('SELECT * FROM finance_history ORDER BY kind,id,version')).toEqual(history)
      expect(await reopened.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(audit)
      const finance = createProductionFinanceService(reopened)
      await finance.execute({ ...f.request('payment_record', 'unconfirm-first', { id: payment.id }, 'unconfirm'), id: payment.id, baseVersion: confirmed.version }, f.session)
      expect(decodeSupplierDetailRead(await owner.detail(f.first.id, {}, f.session)).summary.paymentAmount).toMatchObject({ value: '0.00', status: 'complete' })
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
})

it.each(['finance-payment-application:read', 'finance-payment-record:read'])('撤销%s立即隐藏实付事实，保未知而不是零，恢复原授权后重读原来源', async (capability) => {
  const f = await fixture()
  try {
    const app = await f.application('permission-application')
    await f.confirm(await f.payment(app.id))
    const full = await f.owner.detail(f.first.id, {}, f.session)
    const restricted = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== capability) })
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, restricted))
    expect(detail.payments).toEqual([])
    expect(detail.summary).toMatchObject({ paymentCount: null, paymentAmount: { value: null, knownValue: null, participatingCount: null } })
    expect(detail.meta.sources).toContainEqual({ key: 'payments', state: 'forbidden', sourceVersion: null, asOf: null })
    expect(detail.sourceVersion).not.toBe(full.sourceVersion)
    expect(JSON.stringify(detail)).not.toContain(app.id)
    await expect(f.owner.list({ sort: 'paymentAmount-desc' }, restricted)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await f.owner.detail(f.first.id, {}, f.session)).summary.paymentAmount.value).toBe('25.00')
    await expect(f.owner.detail(f.first.id, {}, () => ({ ...f.actor, workspaceId: 'foreign-workspace' }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await f.storage.close() }
})

it('历史SQLite旧图的已删申请仍保已确认现金与原分摊，当前命令拒绝删除冻结申请', async () => {
  const f = await fixture()
  try {
    const app = await f.application('archived-application')
    const record = await f.payment(app.id)
    await f.confirm(record)
    const allocation = await f.storage.select('SELECT * FROM payment_record_application_allocations WHERE payment_record_id=?', [record.id])
    const originalHistory = await f.storage.select('SELECT * FROM finance_history WHERE kind=? AND id=? ORDER BY version', ['payment_application', app.id])
    const cash = await f.storage.select('SELECT * FROM payment_records WHERE id=?', [record.id])
    const remove = { ...f.request('payment_application', 'cannot-remove-frozen-application', { id: app.id }, 'delete'), id: app.id, baseVersion: app.version }
    await expect(f.finance.execute(remove, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT deleted_at FROM payment_applications WHERE id=?', [app.id])).toEqual([{ deleted_at: null }])
    // 真实合成 SQLite 直接附加旧实现允许的删除版本及原回执，不执行当前命令或改写既有冻结历史。
    await f.storage.withTransaction(async (tx) => {
      const legacy = { ...remove, commandId: 'legacy-removed-visible-application' }
      const logId = await softDelete(tx, 'payment_applications', app.id, f.actor.actorId)
      const updatedAt = new Date().toISOString()
      const version = Number(app.version) + 1
      const result = { id: app.id, commandId: legacy.commandId, version: String(version), updatedAt, attachmentIds: [], logId }
      await tx.execute('INSERT INTO finance_commands VALUES(?,?,?,?,?,?,?)', [legacy.commandId, f.actor.workspaceId, f.actor.actorId, legacy.kind, financeCommandFingerprint(legacy), JSON.stringify(legacy), JSON.stringify(result)])
      await tx.execute('UPDATE finance_versions SET version=?,updated_at=? WHERE kind=? AND id=?', [version, updatedAt, legacy.kind, app.id])
      await tx.execute('INSERT INTO finance_history VALUES(?,?,?,?,?,?,?)', [legacy.kind, app.id, version, legacy.commandId, f.actor.actorId, updatedAt, JSON.stringify(await financeRecordSnapshot(tx, legacy.kind, app.id))])
      await tx.execute('UPDATE finance_revision SET revision=revision+1 WHERE singleton=1')
    })
    await validateFinanceJournal(f.storage, f.actor)
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(detail.payments).toEqual([])
    expect(detail.summary.paymentAmount).toMatchObject({ status: 'complete', value: '25.00', knownValue: '25.00', participatingCount: 1 })
    expect(decodeSupplierListPage(await f.owner.list({ sort: 'paymentAmount-desc' }, f.session)).items.map(row => [row.supplier.id, row.paymentAmount])).toEqual([[f.first.id, '25.00'], [f.second.id, '0.00']])
    expect(await f.storage.select('SELECT * FROM payment_record_application_allocations WHERE payment_record_id=?', [record.id])).toEqual(allocation)
    expect(await f.storage.select('SELECT * FROM payment_records WHERE id=?', [record.id])).toEqual(cash)
    expect(await f.storage.select('SELECT * FROM finance_history WHERE kind=? AND id=? AND version<=? ORDER BY version', ['payment_application', app.id, Number(app.version)])).toEqual(originalHistory)
    await f.storage.close()
    expect((await f.owner.detail(f.first.id, {}, f.session)).summary.paymentAmount.value).toBe('25.00')
    await validateFinanceJournal(f.storage, f.actor)
    expect(await f.storage.select('SELECT * FROM payment_record_application_allocations WHERE payment_record_id=?', [record.id])).toEqual(allocation)
    expect(await f.storage.select('SELECT * FROM payment_records WHERE id=?', [record.id])).toEqual(cash)
  }
  finally { await f.storage.close() }
})

it('读到实际来源后会话变化拒绝整次响应，不公布旧事实且保冻结历史', async () => {
  const f = await fixture()
  try {
    const application = await f.application('late-access-application')
    await f.confirm(await f.payment(application.id))
    const before = await f.storage.select('SELECT * FROM finance_history ORDER BY kind,id,version')
    let calls = 0
    const changed = () => {
      calls += 1
      return { ...f.actor, capabilities: calls < 3 ? [...f.actor.capabilities] : f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read') }
    }
    await expect(f.owner.detail(f.first.id, {}, changed)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(calls).toBe(3)
    expect(await f.storage.select('SELECT * FROM finance_history ORDER BY kind,id,version')).toEqual(before)
    expect((await f.owner.detail(f.first.id, {}, f.session)).summary.paymentAmount.value).toBe('25.00')
  }
  finally { await f.storage.close() }
})

it('真实participant缺失为不可用，不能借现存表伪造可读；恢复participant并冷开保实付款', async () => {
  const f = await fixture()
  try {
    const app = await f.application('participant-application')
    await f.confirm(await f.payment(app.id))
    await f.storage.execute('DELETE FROM production_participants WHERE domain=\'finance\'')
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(detail.meta.sources).toContainEqual({ key: 'payments', state: 'unavailable', sourceVersion: null, asOf: null })
    expect(detail.summary.paymentAmount).toMatchObject({ value: null, knownValue: null })
    expect(detail.payments).toEqual([])
    await f.storage.execute('INSERT INTO production_participants VALUES(\'finance\',1)')
    await f.storage.close()
    expect(decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session)).summary.paymentAmount.value).toBe('25.00')
  }
  finally { await f.storage.close() }
})

it('明确批复零与未填写独立显示，未确认实付款和其他supplier申请不混入已付', async () => {
  const f = await fixture()
  try {
    await f.application('known-zero', f.first.id, 0)
    await f.application('not-entered', f.first.id)
    const other = await f.application('other-supplier', f.second.id)
    await f.confirm(await f.payment(other.id, f.second.id, 30))
    const own = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(own.payments.map(row => [row.application.label, row.approvedAmount, row.approvedAmountState, row.actualPaidAmount])).toEqual([['known-zero', '0.00', 'known', '0.00'], ['not-entered', null, 'not-entered', '0.00']])
    expect(own.summary.paymentAmount.value).toBe('0.00')
    expect((await f.owner.detail(f.second.id, {}, f.session)).summary.paymentAmount.value).toBe('30.00')
    expect(own.meta.sources.find(source => source.key === 'invoices')?.state).toBe('unavailable')
  }
  finally { await f.storage.close() }
})

it('材采主合同与有效协议只计一次可证小计；作废排除签约额且不抹掉独立实付款历史', async () => {
  const f = await fixture()
  try {
    f.actor.capabilities.push('material-contract:write', 'our-signatory:read', 'our-signatory:write')
    const { signatory, constructionMain } = await f.engineering('supplier-material')
    const owner = createProductionMaterialContractService(f.storage)
    const command: MaterialContractCommandRequestDTO = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'material-contract:write', commandId: 'create-material-main', baseVersion: null, action: 'submit', constructionMain, attachments: {}, draft: { name: '主合同80元', projectId: f.project.id, supplierId: f.first.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, signDate: '2026-10-05', content: '原签约依据', amount: 80, lineItems: [{ materialName: '实际材料', unit: '米', qty: 1, taxInclusiveUnitPrice: 100 }], deductions: [{ name: '约定减项', amount: 20, basis: '合同原依据' }] } }
    const main = await owner.execute(command, f.session)
    const protocol = await owner.execute({ ...command, commandId: 'create-material-protocol', draft: { ...command.draft, name: '协议20元', isSupplement: true, originalContractId: main.id, amount: 20, deductions: [], lineItems: [{ materialName: '增补材料', unit: '米', qty: 1, taxInclusiveUnitPrice: 20 }] } }, f.session)
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(detail.contracts.map(row => [row.contract.id, row.effectiveAmount])).toEqual([[main.id, '100.00']])
    expect(detail.summary.contractAmount).toMatchObject({ value: null, knownValue: '100.00', status: 'partial', participatingCount: 1, missingSources: ['other-contract-domains'] })
    expect(detail.summary.payableAmount).toMatchObject({ value: null, knownValue: null })
    const application = await f.application('independent-actual-payment')
    await f.confirm(await f.payment(application.id))
    const current = await owner.form(main.id, f.session)
    await owner.execute({ ...command, id: main.id, baseVersion: main.version, commandId: 'cancel-material-main', action: 'save', draft: { ...current.draft, status: '已作废' } }, f.session, main.id)
    const cancelled = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(cancelled.summary.contractAmount).toMatchObject({ value: null, knownValue: '0.00', status: 'partial' })
    expect(cancelled.summary.paymentAmount.value).toBe('25.00')
    expect(cancelled.contracts[0]?.status).toBe('已作废')
    await f.storage.close()
    expect(decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))).toEqual(cancelled)
    expect((await owner.form(protocol.id, f.session)).draft.amount).toBe(20)
    const denied = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'material-contract:read' && cap !== 'project:list:read') })
    const hidden = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, denied))
    expect(hidden.contracts).toEqual([])
    expect(hidden.summary.contractAmount.knownValue).toBeNull()
    expect(hidden.payments[0]?.project).toMatchObject({ state: 'unavailable', id: null, label: null })
    expect(hidden.meta.sources).toEqual(expect.arrayContaining([{ key: 'contracts', state: 'forbidden', sourceVersion: null, asOf: null }, { key: 'projects', state: 'forbidden', sourceVersion: null, asOf: null }]))
  }
  finally { await f.storage.close() }
})

it('other仅显示实际服务supplier的当前结算，可证小计保零和未知，原件与冻结历史不制造完整总额', async () => {
  const f = await fixture()
  try {
    const { constructionMain } = await f.engineering('supplier-other')
    await f.finance.execute(f.request('reimbursement', 'source-expense', { projectId: f.project.id, constructionMain, applicantSupplierId: f.second.id, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '服务方与垫付方不同', counterpartySupplierId: f.first.id, amount: 100 }] }, 'save'), f.session)
    const other = createProductionOtherSettlementService(f.storage)
    const source = (await other.expenses(f.session)).items[0]!
    const request: OtherSettlementCommand = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'actual-settlement', baseVersion: null, action: 'submit', attachments: { add: [{ fileName: '真实结算原件.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, draft: { name: '真实服务方原费用结算', projectId: f.project.id, contractId: null, totalAmount: 70, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: 70 }] } }
    const saved = await other.execute(request, f.session)
    const pending = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(pending.summary.settlementAmount).toMatchObject({ value: null, knownValue: '0.00', status: 'partial', missingSources: ['other-settlement-domains'] })
    await other.execute({ ...request, attachments: {}, commandId: 'confirm-settlement', id: saved.id, baseVersion: saved.version, action: 'confirm' }, f.session)
    const zero = { ...request, commandId: 'zero-settlement', attachments: {}, draft: { ...request.draft, totalAmount: 0, originalExpenses: [{ ...request.draft.originalExpenses![0]!, amount: 0 }] } }
    const zeroSaved = await other.execute(zero, f.session)
    await other.execute({ ...zero, commandId: 'confirm-zero-settlement', id: zeroSaved.id, baseVersion: zeroSaved.version, action: 'confirm' }, f.session)
    const unknown = { ...zero, commandId: 'unknown-settlement', action: 'draft' as const, draft: { ...zero.draft, totalAmount: null, originalExpenses: [{ ...zero.draft.originalExpenses[0]!, amount: null }] } }
    await other.execute(unknown, f.session)
    const detail = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))
    expect(detail.summary.settlementAmount).toMatchObject({ value: null, knownValue: '70.00', status: 'partial', participatingCount: 2, missingCount: null, missingSources: ['other-settlement-domains'] })
    expect(detail.settlements.map(row => row.totalAmount).sort()).toEqual(['0.00', '70.00', null].sort())
    expect(detail.settlements[0]).toMatchObject({ project: { state: 'resolved', id: f.project.id, label: '正式真实项目名称' }, navigation: { kind: 'entity-detail', variant: 'other_settlement', filters: { dataOrigin: 'real' } } })
    expect((await f.owner.detail(f.second.id, {}, f.session)).settlements).toEqual([])
    expect((await f.owner.list({}, f.session)).items.every(row => row.settlementAmount === null)).toBe(true)
    const audits = await f.storage.select('SELECT * FROM other_settlement_history ORDER BY settlement_id,version')
    await f.storage.close()
    expect(decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, f.session))).toEqual(detail)
    expect(await f.storage.select('SELECT * FROM other_settlement_history ORDER BY settlement_id,version')).toEqual(audits)
    expect(await other.original(saved.id, saved.attachmentIds[0]!, null, f.session)).toMatchObject({ payloadBase64: 'YWJj' })
    const denied = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'other-settlement:read') })
    const privateRead = decodeSupplierDetailRead(await f.owner.detail(f.first.id, {}, denied))
    expect(privateRead.settlements).toEqual([])
    expect(privateRead.summary.settlementAmount.knownValue).toBeNull()
    expect(privateRead.meta.sources.find(source => source.key === 'settlements')?.state).toBe('forbidden')
    const forged = structuredClone(detail)
    forged.meta.sources = forged.meta.sources.filter(source => source.key !== 'other-settlements')
    expect(() => decodeSupplierDetailRead(forged)).toThrow()
  }
  finally { await f.storage.close() }
})
