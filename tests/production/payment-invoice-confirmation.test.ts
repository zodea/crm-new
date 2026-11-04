import type { SQLInputValue } from 'node:sqlite'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { createLocalBackup, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { validatePaymentInvoiceEvidence } from '../../server/utils/production-finance-invoice-adoption'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { productionFinanceOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createProductionMaterialContractService } from '../../server/utils/production-material-contract-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES } from '../../server/utils/production-storage-schema'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { expectFinanceCoverageMissingRejected, expectFinanceEvidenceDamageRejected } from '../helpers/finance-evidence-corruption'
import { testTempRoot } from '../helpers/test-temp-root'

it('有合同需票付款在确认前核对真实发票并冻结证据，草稿及原命令恢复不丢失', { timeout: 120_000 }, async () => {
  const base = testTempRoot('payment-invoice-confirmation')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const original = new DatabaseSync(join(directory, 'ruihang.sqlite'), { enableForeignKeyConstraints: true })
  original.exec('BEGIN')
  original.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 31)) original.exec(upgrade.sql)
  original.prepare('INSERT INTO production_metadata VALUES(1,31,?,?,?,?)').run('payment-invoice-workspace', 'synthetic-owner', 'verification', '2026-01-01T00:00:00.000Z')
  original.exec('COMMIT')
  const coordinator = createDbCoordinator(async () => ({
    async execute(sql, params) {
      if (params)
        original.prepare(sql).run(...params as SQLInputValue[])
      else
        original.exec(sql)
    },
    async select<T>(sql: string, params: unknown[] = []) { return original.prepare(sql).all(...params as SQLInputValue[]) as T[] },
    async close() { original.close() },
  }))
  let storage = { ...coordinator, identity: { workspaceId: 'payment-invoice-workspace', actorId: 'synthetic-owner' }, assertBusinessWrite() {} } as ProductionStorage
  const actor = { ...storage.identity, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write', 'customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write', 'material-contract:read', 'material-contract:write', 'subcontract-contract:read', 'auxiliary-contract:read'] }
  const session = () => structuredClone(actor)
  const common = { ...storage.identity, baseVersion: null, action: 'save', attachments: {} }
  try {
    const customer = await createProductionCustomerService(storage).execute({ ...common, requiredCapability: 'customer:write', commandId: 'invoice-pay-customer', draft: { name: '合成客户', contact: '合成人' } }, session)
    const project = await createProductionProjectService(storage).execute({ ...common, requiredCapability: 'project:write', commandId: 'invoice-pay-project', draft: { name: '合成工程', customerId: customer.id, manager: '合成经理' } }, session)
    const supplier = await createProductionSupplierService(storage).execute({ ...common, requiredCapability: 'supplier:write', commandId: 'invoice-pay-supplier', draft: { name: '合成供应商', taxNo: 'SYN-SELLER', supplierCategory: '其他', contact: '合成人' } }, session)
    const signatory = await createProductionOurSignatoryService(storage).execute({ ...storage.identity, requiredCapability: 'our-signatory:write', commandId: 'invoice-pay-own', baseVersion: null, draft: { name: '合成主体', taxNo: 'SYN-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '合成核实', status: 'active' } }, session)
    const main = await createProductionConstructionContractService(storage).execute({ ...common, requiredCapability: 'construction-contract:write', commandId: 'invoice-pay-main', draft: { name: '合成施工主合同', projectId: project.id, customerId: customer.id, content: '合成范围', signDate: '2026-01-01', ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version } }, session)
    const sourceMain = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
    const material = createProductionMaterialContractService(storage)
    const materialCommand = { ...common, requiredCapability: 'material-contract:write', commandId: 'invoice-pay-material', constructionMain: { id: main.id, projectId: project.id, basis: sourceMain.basis }, draft: { name: '合成采购合同', projectId: project.id, supplierId: supplier.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, content: '合成采购', signDate: '2026-01-01', amount: 100, taxRate: null, lineItems: [] } }
    const contract = await material.execute(materialCommand, session)
    const otherContract = await material.execute({ ...materialCommand, commandId: 'invoice-pay-other-material', draft: { ...materialCommand.draft, name: '另一份合成合同' } }, session)
    let finance = createProductionFinanceService(storage, { references: productionFinanceOwners })
    const candidates = await finance.lookup('payment_application', { kind: 'payment-contracts', keyword: '', projectId: project.id, supplierId: supplier.id, paymentBizType: '有合同-材料', contractKinds: ['材采'] }, session)
    expect(candidates.items).toContainEqual(expect.objectContaining({ id: `material_${contract.id}`, paymentContract: { domain: 'material', id: contract.id, version: contract.version } }))
    await expect(finance.lookup('payment_application', { kind: 'payment-contracts', keyword: '', projectId: project.id, supplierId: supplier.id, paymentBizType: '有合同-材料', contractKinds: ['材采'] }, () => ({ ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'material-contract:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const request = { ...storage.identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'save', commandId: 'invoice-pay-application', baseVersion: null, attachments: {}, draft: { name: '合成预付款', bizType: '预付款', projectId: project.id, supplierId: supplier.id, contractId: contract.id, contractReference: { domain: 'material', id: contract.id, version: contract.version }, applyAmount: 30, applyDate: '2026-01-01', applicant: '合成人', invoiceState: '先款后票', invoiceAllocations: [] } }
    const application = await finance.execute(request, session)
    const payment = { ...storage.identity, requiredCapability: 'finance-payment-record:write', kind: 'payment_record', action: 'confirm', commandId: 'invoice-pay-confirm', baseVersion: null, attachments: {}, draft: { projectId: project.id, supplierId: supplier.id, payeeName: '合成供应商', amount: 30, paymentDate: '2026-01-01', voucherNo: 'SYN-VOUCHER', bankSerialNo: 'SYN-BANK', confirmedBy: actor.actorId, applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] } }
    await expect(finance.execute(payment, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('先在付款申请中指定发票') } })
    expect(await storage.select('SELECT id FROM payment_records')).toEqual([])
    const invoices = createProductionInvoiceService(storage)
    const envelope = { ...storage.identity, requiredCapability: 'finance-invoice:write' }
    const created = await invoices.execute({ ...envelope, action: 'manual', commandId: 'invoice-pay-create', baseVersion: null, fields: { invoiceNumber: 'SYN-INV', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'SYN-BUYER', seller: '合成供应商', sellerTaxNo: 'SYN-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [] }, session)
    const reviewed = await invoices.execute({ ...envelope, action: 'review', commandId: 'invoice-pay-review', invoiceId: created.invoiceId, baseVersion: created.version, manualCompletion: true }, session)
    await invoices.execute({ ...envelope, action: 'archive', commandId: 'invoice-pay-archive', invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: project.id, supplierId: supplier.id, contract: { domain: 'material', id: otherContract.id, version: otherContract.version }, taxNumbersConfirmed: true, taxVerification: { buyerId: signatory.id, buyerVersion: signatory.version, supplierVersion: supplier.version } }, session)
    const form = await finance.form('payment_application', application.id, session)
    const attached = await finance.execute({ ...request, id: application.id, commandId: 'invoice-pay-attach', baseVersion: application.version, draft: { ...form.draft, invoiceAllocations: [{ invoiceId: created.invoiceId, allocatedAmount: 30 }] } }, session)
    await expect(finance.execute(payment, () => ({ ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(finance.execute(payment, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('合同不一致') } })
    expect(await storage.select('SELECT id FROM payment_records')).toEqual([])
    const correct = await invoices.execute({ ...envelope, action: 'manual', commandId: 'invoice-pay-correct-create', baseVersion: null, fields: { invoiceNumber: 'SYN-INV-2', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'SYN-BUYER', seller: '合成供应商', sellerTaxNo: 'SYN-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [] }, session)
    const correctReviewed = await invoices.execute({ ...envelope, action: 'review', commandId: 'invoice-pay-correct-review', invoiceId: correct.invoiceId, baseVersion: correct.version, manualCompletion: true }, session)
    const linked = await invoices.execute({ ...envelope, action: 'archive', commandId: 'invoice-pay-correct-archive', invoiceId: correct.invoiceId, baseVersion: correctReviewed.version, ownerKind: 'project', projectId: project.id, supplierId: supplier.id, contract: { domain: 'material', id: contract.id, version: contract.version }, taxNumbersConfirmed: true, taxVerification: { buyerId: signatory.id, buyerVersion: signatory.version, supplierVersion: supplier.version } }, session)
    const updatedForm = await finance.form('payment_application', application.id, session)
    const correctApplication = await finance.execute({ ...request, id: application.id, commandId: 'invoice-pay-replace', baseVersion: attached.version, draft: { ...updatedForm.draft, invoiceAllocations: [{ invoiceId: correct.invoiceId, allocatedAmount: 30 }] } }, session)
    const [first, competing] = await Promise.allSettled([finance.execute(payment, session), finance.execute({ ...payment, commandId: 'invoice-pay-competing' }, session)])
    expect(first.status).toBe('fulfilled')
    expect(competing).toMatchObject({ status: 'rejected', reason: { problem: { code: 'validation-failed', message: expect.stringContaining('超过付款申请可付金额') } } })
    if (first.status !== 'fulfilled')
      throw first.reason
    const confirmed = first.value
    expect(confirmed.paymentInvoiceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await finance.execute(payment, session)).toEqual(confirmed)
    const [history] = await storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_record\' AND id=?', [confirmed.id])
    const paymentSnapshot = JSON.parse(history!.snapshot_json)
    expect(paymentSnapshot.paymentInvoiceEvidence).toMatchObject([{ applicationId: application.id, contract: { domain: 'material', id: contract.id }, invoiceAdoptions: [{ invoice: { id: correct.invoiceId } }] }])
    const [coverage] = await storage.select<{ coverage_json: string }>('SELECT coverage_json FROM finance_payment_invoice_coverage WHERE record_id=? AND version=?', [confirmed.id, Number(confirmed.version)])
    await expect(validatePaymentInvoiceEvidence(storage, { ...paymentSnapshot, paymentInvoiceEvidence: [] }, JSON.parse(coverage!.coverage_json))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expectFinanceEvidenceDamageRejected(storage, actor, { kind: 'payment_application', id: application.id, version: correctApplication.version, commandId: correctApplication.commandId, field: 'invoiceAdoptions', digest: 'invoiceAdoptionsSha256' })
    await expectFinanceEvidenceDamageRejected(storage, actor, { kind: 'payment_record', id: confirmed.id, version: confirmed.version, commandId: confirmed.commandId, field: 'paymentInvoiceEvidence', digest: 'paymentInvoiceEvidenceSha256' })
    await expectFinanceEvidenceDamageRejected(storage, actor, { kind: 'payment_record', id: confirmed.id, version: confirmed.version, commandId: confirmed.commandId, field: 'paymentInvoiceEvidence', digest: 'paymentInvoiceEvidenceSha256', mode: 'empty' })
    await expectFinanceCoverageMissingRejected(storage, actor, { id: confirmed.id, version: confirmed.version })
    await invoices.execute({ ...envelope, action: 'attach-original', commandId: 'invoice-pay-original', invoiceId: correct.invoiceId, baseVersion: linked.version, confirmed: true, original: { fileName: '合成.png', fileSize: 8, mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' } }, session)
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    await expect(finance.execute({ ...payment, commandId: 'invoice-pay-duplicate' }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('超过付款申请可付金额') } })
    const beforeInvoiceRequest = { ...request, action: 'submit', commandId: 'invoice-pay-before-invoice', draft: { ...request.draft, applyAmount: 20, invoiceState: '先票后款', invoiceAllocations: [] } }
    const beforeInvoice = await finance.execute(beforeInvoiceRequest, session)
    const beforePayment = { ...payment, commandId: 'invoice-pay-before-confirm', draft: { ...payment.draft, amount: 20, voucherNo: 'V-BEFORE', bankSerialNo: 'B-BEFORE', applicationAllocations: [{ paymentApplicationId: beforeInvoice.id, allocatedAmount: 20 }] } }
    await expect(finance.execute(beforePayment, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('先在付款申请中指定发票') } })
    const beforeForm = await finance.form('payment_application', beforeInvoice.id, session)
    const partial = await finance.execute({ ...beforeInvoiceRequest, id: beforeInvoice.id, baseVersion: beforeInvoice.version, commandId: 'invoice-pay-before-partial', draft: { ...beforeForm.draft, invoiceAllocations: [{ invoiceId: correct.invoiceId, allocatedAmount: 10 }] } }, session)
    await expect(finance.execute(beforePayment, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('关联发票金额必须等于申请金额') } })
    const partialForm = await finance.form('payment_application', beforeInvoice.id, session)
    await finance.execute({ ...beforeInvoiceRequest, id: beforeInvoice.id, baseVersion: partial.version, commandId: 'invoice-pay-before-full', draft: { ...partialForm.draft, invoiceAllocations: [{ invoiceId: correct.invoiceId, allocatedAmount: 20 }] } }, session)
    expect((await finance.execute(beforePayment, session)).paymentInvoiceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    const mixedRequests = [
      { ...request, commandId: 'invoice-mixed-required', draft: { ...request.draft, applyAmount: 5, invoiceAllocations: [{ invoiceId: correct.invoiceId, allocatedAmount: 5 }] } },
      { ...request, commandId: 'invoice-mixed-no-invoice', draft: { ...request.draft, applyAmount: 5, invoiceState: '无需发票', invoiceAllocations: [] } },
      { ...request, commandId: 'invoice-mixed-no-contract', draft: { ...request.draft, applyAmount: 5, contractId: null, contractReference: null, invoiceAllocations: [] } },
    ]
    const mixedApplications = []
    for (const command of mixedRequests) mixedApplications.push(await finance.execute(command, session))
    const mixedPayment = { ...payment, commandId: 'invoice-mixed-payment', draft: { ...payment.draft, amount: 15, voucherNo: 'V-MIXED', bankSerialNo: 'B-MIXED', applicationAllocations: mixedApplications.map(row => ({ paymentApplicationId: row.id, allocatedAmount: 5 })) } }
    const mixed = await finance.execute(mixedPayment, session)
    expect(await finance.execute(mixedPayment, session)).toEqual(mixed)
    const [mixedRow] = await storage.select<{ coverage_json: string }>('SELECT coverage_json FROM finance_payment_invoice_coverage WHERE record_id=? AND version=?', [mixed.id, Number(mixed.version)])
    const mixedCoverage = JSON.parse(mixedRow!.coverage_json)
    expect(mixedCoverage.map((row: { applicationId: string }) => row.applicationId).sort()).toEqual(mixedApplications.map(row => row.id).sort())
    const [mixedHistory] = await storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_record\' AND id=? AND version=?', [mixed.id, Number(mixed.version)])
    const mixedSnapshot = JSON.parse(mixedHistory!.snapshot_json)
    expect(mixedSnapshot.paymentInvoiceEvidence).toMatchObject([{ applicationId: mixedApplications[0]!.id, applicationVersion: mixedApplications[0]!.version }])
    expect(mixedSnapshot.paymentInvoiceEvidence).toHaveLength(1)
    await expect(validatePaymentInvoiceEvidence(storage, mixedSnapshot, mixedCoverage.slice(1))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(validatePaymentInvoiceEvidence(storage, mixedSnapshot, [...mixedCoverage, mixedCoverage[0]])).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(validatePaymentInvoiceEvidence(storage, mixedSnapshot, mixedCoverage.map((row: { applicationVersion: string }, index: number) => index ? row : { ...row, applicationVersion: '999' }))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const mixedForm = await finance.form('payment_application', mixedApplications[0]!.id, session)
    await finance.execute({ ...mixedRequests[0]!, id: mixedApplications[0]!.id, commandId: 'invoice-mixed-after-confirm', baseVersion: mixedApplications[0]!.version, draft: { ...mixedForm.draft, note: '付款确认后补充说明' } }, session)
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    const contractForm = await material.form(contract.id, session)
    const changedContract = await material.execute({ ...materialCommand, id: contract.id, commandId: 'invoice-pay-contract-change', baseVersion: contractForm.version, draft: { ...contractForm.draft, content: '后续合同变更' } }, session, contract.id)
    expect(await finance.execute(payment, session)).toEqual(confirmed)
    await expect(finance.execute({ ...payment, commandId: 'invoice-pay-after-contract-change' }, session)).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('合同版本已变化') } })
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    for (const kind of ['no-contract', 'no-invoice'] as const) {
      const exception = await finance.execute({ ...request, commandId: `invoice-pay-${kind}-application`, draft: { ...request.draft, ...(kind === 'no-contract' ? { contractId: null, contractReference: null } : { contractReference: { ...request.draft.contractReference, version: changedContract.version }, invoiceState: '无需发票' }) } }, session)
      const result = await finance.execute({ ...payment, commandId: `invoice-pay-${kind}-confirm`, draft: { ...payment.draft, voucherNo: `V-${kind}`, bankSerialNo: `B-${kind}`, applicationAllocations: [{ paymentApplicationId: exception.id, allocatedAmount: 30 }] } }, session)
      expect(result.paymentInvoiceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    }
    const authorizationApplication = await finance.execute({ ...request, commandId: 'invoice-pay-auth-application', draft: { ...request.draft, contractId: null, contractReference: null } }, session)
    const beforeAuthChange = await storage.select('SELECT id FROM payment_records ORDER BY id')
    const beforeAuthCoverage = await storage.select('SELECT * FROM finance_payment_invoice_coverage ORDER BY record_id,version')
    let sessionReads = 0
    const changingSession = () => ++sessionReads < 3 ? actor : { ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:read') }
    await expect(finance.execute({ ...payment, commandId: 'invoice-pay-changing-authority', draft: { ...payment.draft, voucherNo: 'V-AUTH', bankSerialNo: 'B-AUTH', applicationAllocations: [{ paymentApplicationId: authorizationApplication.id, allocatedAmount: 30 }] } }, changingSession)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await storage.select('SELECT id FROM payment_records ORDER BY id')).toEqual(beforeAuthChange)
    expect(await storage.select('SELECT * FROM finance_payment_invoice_coverage ORDER BY record_id,version')).toEqual(beforeAuthCoverage)
    const failedPayment = { ...payment, commandId: 'invoice-pay-coverage-failure', draft: { ...payment.draft, voucherNo: 'V-FAIL', bankSerialNo: 'B-FAIL', applicationAllocations: [{ paymentApplicationId: authorizationApplication.id, allocatedAmount: 30 }] } }
    await storage.execute(`CREATE TRIGGER synthetic_coverage_failure BEFORE INSERT ON finance_payment_invoice_coverage BEGIN SELECT RAISE(ABORT,'synthetic coverage failure'); END`)
    try {
      await expect(finance.execute(failedPayment, session)).rejects.toThrow('synthetic coverage failure')
      expect(await storage.select('SELECT id FROM payment_records ORDER BY id')).toEqual(beforeAuthChange)
      expect(await storage.select('SELECT * FROM finance_payment_invoice_coverage ORDER BY record_id,version')).toEqual(beforeAuthCoverage)
      expect(await storage.select('SELECT command_id FROM finance_commands WHERE command_id=?', [failedPayment.commandId])).toEqual([])
    }
    finally { await storage.execute('DROP TRIGGER synthetic_coverage_failure') }
    const retriedPayment = await finance.execute(failedPayment, session)
    expect(await finance.execute(failedPayment, session)).toEqual(retriedPayment)
    await storage.close()
    storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
    expect((await storage.status()).schemaVersion).toBe(32)
    finance = createProductionFinanceService(storage, { references: productionFinanceOwners })
    expect(await finance.resolve('payment_record', payment.commandId, session)).toEqual({ outcome: 'applied', result: confirmed })
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    const backupDirectory = await mkdtemp(`${base}/backup-`)
    const restoreDirectory = await mkdtemp(`${base}/restore-`)
    const backup = await createLocalBackup(storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'payment-invoice-restore')
    const recovered = createProductionStorage({ directory: restored.directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
    try {
      await expect(validateFinanceJournal(recovered, actor)).resolves.toBeDefined()
      const [cold] = await recovered.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_record\' AND id=?', [confirmed.id])
      expect(JSON.parse(cold!.snapshot_json).paymentInvoiceEvidence).toMatchObject([{ applicationId: application.id, contract: { domain: 'material', id: contract.id }, invoiceAdoptions: [{ invoice: { id: correct.invoiceId } }] }])
      expect(restored.directory.startsWith(join(base, 'restore-'))).toBe(true)
      const recoveredFinance = createProductionFinanceService(recovered, { references: productionFinanceOwners })
      expect(await recoveredFinance.resolve('payment_record', payment.commandId, session)).toEqual({ outcome: 'applied', result: confirmed })
      expect(await recoveredFinance.execute(payment, session)).toEqual(confirmed)
      await recovered.close()
      const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});const history=db.prepare('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=?').get('payment_record',process.argv[2]);const receipt=db.prepare('SELECT result_json FROM finance_commands WHERE command_id=?').get(process.argv[3]);const coverage=db.prepare('SELECT coverage_json FROM finance_payment_invoice_coverage WHERE record_id=?').get(process.argv[2]);const mixed=db.prepare('SELECT coverage_json FROM finance_payment_invoice_coverage WHERE record_id=?').get(process.argv[4]);process.stdout.write(JSON.stringify({evidence:JSON.parse(history.snapshot_json).paymentInvoiceEvidence,coverage:JSON.parse(coverage.coverage_json),mixedCoverage:JSON.parse(mixed.coverage_json),receipt:JSON.parse(receipt.result_json),foreignKeys:db.prepare('PRAGMA foreign_key_check').all()}));db.close()`
      const independent = JSON.parse(execFileSync(process.execPath, ['-e', script, join(restored.directory, 'ruihang.sqlite'), confirmed.id, payment.commandId, mixed.id], { encoding: 'utf8' }))
      expect(independent).toMatchObject({ receipt: confirmed, foreignKeys: [], coverage: JSON.parse(coverage!.coverage_json), mixedCoverage, evidence: [{ applicationId: application.id, contract: { domain: 'material', id: contract.id }, invoiceAdoptions: [{ invoice: { id: correct.invoiceId } }] }] })
    }
    finally { await recovered.close() }
  }
  finally { await storage.close() }
})
