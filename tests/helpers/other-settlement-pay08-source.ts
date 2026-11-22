import type { BusinessSession } from '../../server/utils/business-session'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { CENTRAL_FINANCE_KINDS, FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { readVerifiedOriginalExpense } from '../../app/lib/finance/expense-reference'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createMemoryDb } from './memory-db'

/** A complete old Native owner, including the original legacy approval and already confirmed cash. */
export async function createOtherSettlementPay08Source(directory: string, options: {
  applicationName?: string
  applicationStatus?: 'submitted' | 'approved'
  settlementAmount?: number
  paidAmount?: number
} = {}) {
  const { applicationName = '原批复未知费用申请', applicationStatus = 'submitted', settlementAmount = 70, paidAmount = 20 } = options
  await mkdir(directory, { recursive: true })
  const native = await createMemoryDb()
  const ids = {
    service: 'pay08-native-service',
    payee: 'pay08-native-payee',
    expense: 'pay08-native-expense',
    expenseLine: 'pay08-native-expense-line',
    settlement: 'pay08-native-settlement',
    application: 'pay08-native-application',
    payment: `pay08-native-paid-${paidAmount}`,
    applicationFile: 'pay08-native-application-file',
    settlementFile: 'pay08-native-settlement-file',
  }
  const original = Buffer.from([0, 10, 128, 255])
  try {
    // Freeze the genuine pre-PAY08 schema rather than changing a new production application's provenance.
    await runMigrations(native, migrations.filter(migration => migration.version <= 60))
    await native.execute('PRAGMA foreign_keys=ON')
    await native.execute('INSERT INTO suppliers(id,name) VALUES(?,?),(?,?)', [ids.service, '原实际服务交易方', ids.payee, '原实际垫付收款人'])
    await native.execute(`INSERT INTO expense_reimbursements(id,applicant,applicant_supplier_id,applicant_name_snapshot,reimbursement_date,status)
      VALUES(?,?,?,?,?,'confirmed')`, [ids.expense, '原实际垫付收款人', ids.payee, '原实际垫付收款人', '2026-10-01'])
    await native.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,counterparty_supplier_id,counterparty_name_snapshot)
      VALUES(?,?,?,100,?,?)`, [ids.expenseLine, ids.expense, '真实历史无合同费用', ids.service, '原实际服务交易方'])
    const expense = await readVerifiedOriginalExpense(native, ids.expenseLine)
    if (!expense)
      throw new Error('合成来源缺少真实已确认原费用')
    await native.execute(`INSERT INTO expenditure_settlements(id,name,supplier_id,payee_supplier_id,payee_name_snapshot,total_amount,settlement_date,status)
      VALUES(?,?,?,?,?,?,?,'draft')`, [ids.settlement, '原已确认费用结算', ids.service, ids.payee, '原实际垫付收款人', settlementAmount, '2026-10-01'])
    await native.execute('INSERT INTO expenditure_settlement_expense_allocations VALUES(?,?,?,?,?,?,?,?,?,NULL)', ['pay08-native-adoption', ids.settlement, expense.id, expense.version, expense.sourceRevision, settlementAmount, JSON.stringify(expense), '2026-10-01T01:00:00.000Z', '原费用采用人'])
    await native.execute('UPDATE expenditure_settlements SET status=\'confirmed\' WHERE id=?', [ids.settlement])
    await native.execute(`INSERT INTO payment_applications(id,name,biz_type,supplier_id,payee_name_snapshot,apply_amount,approved_amount,approved_amount_origin,status,apply_date,applicant,invoice_state)
      VALUES(?,?,'公司付款',?,?,?,0,'legacy',?,?,?,'无需发票')`, [ids.application, applicationName, ids.payee, '原实际垫付收款人', settlementAmount, applicationStatus, '2026-10-01', '原申请人'])
    await native.execute('INSERT INTO payment_application_settlement_allocations(id,payment_application_id,settlement_id,allocated_amount) VALUES(?,?,?,?)', ['pay08-native-app-adoption', ids.application, ids.settlement, settlementAmount])
    await native.execute(`INSERT INTO payment_records(id,supplier_id,payee_name,payee_name_snapshot,amount,payment_date,voucher_no,bank_serial_no,confirmation_status)
      VALUES(?,?,?,?,?,?,'PAY08-OLD-VOUCHER','PAY08-OLD-BANK','needs_review')`, [ids.payment, ids.payee, '原实际垫付收款人', '原实际垫付收款人', paidAmount, '2026-10-01'])
    await native.execute('INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES(?,?,?,?)', ['pay08-native-old-cash-allocation', ids.payment, ids.application, paidAmount])
    await native.execute('UPDATE payment_records SET confirmation_status=\'confirmed\',confirmed_by=\'原确认人\',confirmed_at=\'2026-10-01T02:00:00.000Z\' WHERE id=?', [ids.payment])
    for (const [fileId, ownerType, ownerId, fileName] of [
      [ids.applicationFile, 'payment_application', ids.application, '原申请核验依据.bin'],
      [ids.settlementFile, 'expenditure_settlement', ids.settlement, '原结算依据.bin'],
    ]) {
      await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)', [fileId, ownerType, ownerId, fileName, original.length, 'application/octet-stream', '原上传人', '2026-10-01T01:00:00.000Z'])
      await native.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [fileId, original.toString('base64')])
    }
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(?,?,?,?,?,?)', ['pay08-native-old-cash-audit', 'payment_records', ids.payment, 'confirm', JSON.stringify({ amount: paidAmount, confirmed_by: '原确认人', bank_serial_no: 'PAY08-OLD-BANK' }), '原确认人'])
    const bytes = Buffer.from(native.raw.export())
    const path = join(directory, 'synthetic-native-pay08-other.sqlite')
    await writeFile(path, bytes)
    return { path, bytes, ids, original, originalSha256: createHash('sha256').update(original).digest('hex'), source: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') } }
  }
  finally {
    native.close()
  }
}

/** Historical E only: complete genuine Native bytes, no current creation shortcut or extra cash/settlement. */
export async function adoptHistoricalExpenseFixture(storage: ProductionStorage, actor: BusinessSession & { capabilities: string[] }, options: { directory: string, serviceId: string, payeeId: string, serviceName: string, payeeName: string, prefix?: string, original?: boolean }) {
  const prefix = options.prefix ?? 'historical-expense'
  const sameParty = options.serviceId === options.payeeId
  const ids = { service: `${prefix}-service`, payee: sameParty ? `${prefix}-service` : `${prefix}-payee`, expense: `${prefix}-head`, line: `${prefix}-line`, file: `${prefix}-file` }
  const db = await createMemoryDb()
  let source
  try {
    await runMigrations(db, migrations.filter(row => row.version <= 60))
    await db.execute('PRAGMA foreign_keys=ON')
    await db.execute('INSERT INTO suppliers(id,name) VALUES(?,?)', [ids.service, options.serviceName])
    if (!sameParty)
      await db.execute('INSERT INTO suppliers(id,name) VALUES(?,?)', [ids.payee, options.payeeName])
    await db.execute('INSERT INTO expense_reimbursements(id,applicant,applicant_supplier_id,applicant_name_snapshot,reimbursement_date,status) VALUES(?,?,?,?,?,\'confirmed\')', [ids.expense, options.payeeName, ids.payee, options.payeeName, '2026-10-05'])
    await db.execute('INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,counterparty_supplier_id,counterparty_name_snapshot) VALUES(?,?,?,100,?,?)', [ids.line, ids.expense, '历史真实原费用100', ids.service, options.serviceName])
    if (options.original) {
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)', [ids.file, 'expense_reimbursement', ids.expense, '原費真实证据.bin', 4, 'application/octet-stream', '原上传人', '2026-10-05T01:00:00.000Z'])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [ids.file, 'AAqA/w=='])
    }
    const bytes = Buffer.from(db.raw.export())
    await mkdir(options.directory, { recursive: true })
    await writeFile(join(options.directory, `${prefix}.sqlite`), bytes)
    source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
  }
  finally { db.close() }
  for (const capability of ['core:migration:write', ...CENTRAL_FINANCE_KINDS.flatMap(kind => [`${FINANCE_FAMILIES[kind]}:read`, `${FINANCE_FAMILIES[kind]}:write`])]) {
    if (!actor.capabilities.includes(capability))
      actor.capabilities.push(capability)
  }
  const session = () => structuredClone(actor)
  const finance = createProductionFinanceService(storage)
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const preview = await finance.preflightSnapshot({ ...identity, source }, session)
  const bindings = [{ legacyId: ids.service, targetId: options.serviceId }, ...(!sameParty ? [{ legacyId: ids.payee, targetId: options.payeeId }] : [])]
  const mappings = bindings.map((binding) => {
    const candidate = preview.candidates.find(row => row.entityType === 'suppliers' && row.serverId === binding.targetId)!
    return { entityType: 'suppliers' as const, ...binding, version: candidate.version, sourceVersion: candidate.sourceVersion, reason: '完整历史原费无项目，真实服务方和垫付身份逐项核实；不新造工程或现金' }
  })
  await finance.importSnapshot({ ...identity, commandId: `${prefix}-adopt`, source, mappings }, session)
  const form = await finance.form('reimbursement', ids.expense, session)
  return { id: ids.expense, version: form.version, attachmentIds: form.attachments.map(file => file.id), lineId: ids.line, ids, source }
}
