import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { createMemoryDb } from '../../tests/helpers/memory-db'

/** A real Native60 graph with an original expense and an optional undigitised paper clearance. */
export async function createHistoricalClearanceMigrationSource(directory: string, originalOnly?: { expenseItem: string }) {
  await mkdir(directory, { recursive: true })
  const native = await createMemoryDb()
  const ids = {
    service: 'clearance-native-service',
    payee: 'clearance-native-payee',
    expense: 'clearance-native-expense',
    expenseLine: 'clearance-native-expense-line',
    clearance: 'clearance-native-paper-clearance',
    clearanceLine: 'clearance-native-paper-clearance-line',
    expenseFile: 'clearance-native-expense-file',
    expenseAudit: 'clearance-native-expense-audit',
    clearanceAudit: 'clearance-native-paper-clearance-audit',
  }
  const original = Buffer.from([0, 10, 128, 255])
  const originalClearanceAudit = JSON.stringify({
    originalExpenseLineId: ids.expenseLine,
    amount: 30,
    status: 'confirmed',
    evidence: '原纸质清偿单从未电子化，当前纸单已缺失；未登记电子原件或文件元数据。',
  })
  try {
    await runMigrations(native, migrations.filter(migration => migration.version <= 60))
    await native.execute('PRAGMA foreign_keys=ON')
    await native.execute('INSERT INTO suppliers(id,name) VALUES(?,?),(?,?)', [ids.service, '原实际运输服务方', ids.payee, '原实际垫付收款人'])
    await native.execute(`INSERT INTO expense_reimbursements(id,applicant,applicant_supplier_id,applicant_name_snapshot,reimbursement_date,status,reason)
      VALUES(?,?,?,?,?,'confirmed',?)`, [ids.expense, '原实际垫付收款人', ids.payee, '原实际垫付收款人', '2026-10-01', '原费用100，原成本只计本单'])
    await native.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,counterparty_supplier_id,counterparty_name_snapshot)
      VALUES(?,?,?,100,?,?)`, [ids.expenseLine, ids.expense, originalOnly?.expenseItem ?? '历史运输原费用100', ids.service, '原实际运输服务方'])
    if (!originalOnly) {
      await native.execute(`INSERT INTO expense_reimbursements(id,applicant,applicant_supplier_id,applicant_name_snapshot,reimbursement_date,status,reason)
        VALUES(?,?,?,?,?,'confirmed',?)`, [ids.clearance, '原实际垫付收款人', ids.payee, '原实际垫付收款人', '2026-10-02', '历史纸单清偿30，原纸从未电子化，不能冒充银行支付'])
      await native.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,counterparty_supplier_id,counterparty_name_snapshot,original_expense_line_id)
        VALUES(?,?,?,30,?,?,?)`, [ids.clearanceLine, ids.clearance, '历史纸单清偿30', ids.service, '原实际运输服务方', ids.expenseLine])
      await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(?,?,?,?,?,?)', [ids.clearanceAudit, 'expense_reimbursements', ids.clearance, 'confirm', originalClearanceAudit, '原纸单清偿经办人'])
    }
    // The E original really exists; the absent paper C has neither a forged file nor an empty payload.
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)', [ids.expenseFile, 'expense_reimbursement', ids.expense, '原费用真实依据.bin', original.length, 'application/octet-stream', '原上传人', '2026-10-01T01:00:00.000Z'])
    await native.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [ids.expenseFile, original.toString('base64')])
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(?,?,?,?,?,?)', [ids.expenseAudit, 'expense_reimbursements', ids.expense, 'confirm', JSON.stringify({ amount: 100, status: 'confirmed' }), '原费用确认人'])
    const bytes = Buffer.from(native.raw.export())
    const path = join(directory, 'synthetic-native60-paper-clearance.sqlite')
    await writeFile(path, bytes)
    return {
      path,
      bytes,
      ids,
      original,
      originalClearanceAudit,
      originalSha256: createHash('sha256').update(original).digest('hex'),
      source: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') },
    }
  }
  finally {
    native.close()
  }
}
