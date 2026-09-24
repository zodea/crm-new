import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollABookProof, PayrollABookRef } from '../../app/lib/payroll/central-a-fees-contract'
import { isPayrollAStatementSourceSnapshot } from '../../app/lib/payroll/central-a-codec'
import { hasPayrollAFeesDocument } from '../../app/lib/payroll/central-a-fees-contract'
import { feeObject, isPayrollABook } from '../../app/lib/payroll/central-a-fees-validation'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

export const samePayrollABook = (left: PayrollABookRef, right: PayrollABookRef): boolean => left.bookPurpose === right.bookPurpose && left.managementBookId === right.managementBookId

/** 调用方另核项目/负责人；这里不以姓名、当前成员或缺省字段推定管理用途。 */
export async function resolvePayrollABook(tx: TransactionDb, statementId: string): Promise<PayrollABookProof> {
  const [head] = await tx.select<Record<string, unknown>>('SELECT w.*,s.source_json FROM wage_statements w LEFT JOIN payroll_a_statement_sources s ON s.statement_id=w.id WHERE w.id=?', [statementId])
  const unavailable: PayrollABookProof = { state: 'unproven', book: null, reasons: ['原工资没有可证明的请款簿用途'] }
  if (!head || head.format_family !== 'A')
    return unavailable
  const [relation] = await tx.select<{ project_id: string, leader_worker_id: string, book_purpose: string, management_book_id: string | null }>('SELECT * FROM payroll_a_statement_books WHERE statement_id=?', [statementId])
  if (relation) {
    const book = { bookPurpose: relation.book_purpose, managementBookId: relation.management_book_id }
    if (!isPayrollABook(book) || relation.project_id !== head.project_id || relation.leader_worker_id !== head.leader_worker_id)
      return unavailable
    if (book.bookPurpose === 'management') {
      const [manager] = await tx.select<{ project_id: string, manager_worker_id: string | null }>('SELECT project_id,manager_worker_id FROM payroll_a_management_books WHERE id=?', [book.managementBookId])
      if (!manager || manager.project_id !== head.project_id || manager.manager_worker_id !== head.leader_worker_id)
        return unavailable
    }
    if (head.status === 'released') {
      const document = (await loadPayrollAReleasedWithMigration(tx, statementId)).get(statementId) ?? (await loadPayrollMigratedProof(tx, String(head.project_id))).aDocuments.get(statementId)
      if (!document || !hasPayrollAFeesDocument(document) || !samePayrollABook(document.book, book as PayrollABookRef))
        return unavailable
    }
    return { state: 'proven', book: book as PayrollABookRef, sourceVersion: String(head.source_version ?? '') }
  }
  if (head.status === 'released') {
    const migrated = (await loadPayrollMigratedProof(tx, String(head.project_id))).aDocuments.get(statementId)
    if (migrated)
      return { state: 'proven', book: hasPayrollAFeesDocument(migrated) ? migrated.book : { bookPurpose: 'ordinary', managementBookId: null }, sourceVersion: String(head.source_version ?? '') }
  }
  try {
    if (!isPayrollAStatementSourceSnapshot(JSON.parse(String(head.source_json))))
      return unavailable
    if (head.status === 'released' && !(await loadPayrollAReleasedWithMigration(tx, statementId)).has(statementId))
      return unavailable
    return { state: 'proven', book: { bookPurpose: 'ordinary', managementBookId: null }, sourceVersion: String(head.source_version ?? '') }
  }
  catch { return unavailable }
}

export async function loadPayrollABookPayments(tx: TransactionDb, scope: { projectId: string, leaderWorkerId: string, book: PayrollABookRef }, excludedId: string | null) {
  const rows = await tx.select<Record<string, unknown>>('SELECT id,month,pay_ratio,actual_amount FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND format_family=\'A\' AND status=\'released\' AND id<>? ORDER BY month,id', [scope.projectId, scope.leaderWorkerId, excludedId ?? ''])
  const result: typeof rows = []
  for (const row of rows) {
    const explicit = await tx.select<{ book_purpose: string, management_book_id: string | null }>('SELECT book_purpose,management_book_id FROM payroll_a_statement_books WHERE statement_id=?', [row.id])
    const [original] = await tx.select<{ source_json: string | null, snapshot_json: string | null }>('SELECT s.source_json,w.snapshot_json FROM wage_statements w LEFT JOIN payroll_a_statement_sources s ON s.statement_id=w.id WHERE w.id=?', [row.id])
    const claims: unknown[] = []
    for (const raw of [original?.source_json, original?.snapshot_json]) {
      try {
        const value: unknown = raw ? JSON.parse(raw) : null
        if (feeObject(value)) {
          if (Object.hasOwn(value, 'book'))
            claims.push(value.book)
          if (feeObject(value.aSource) && Object.hasOwn(value.aSource, 'book'))
            claims.push(value.aSource.book)
        }
      }
      catch { /* 无法解析的原文不能提供用途证明。 */ }
    }
    // 旧 A 的原主体累计口径继续保留已知历史实付；不为原单补写或输出新用途字段。
    if (!explicit.length && !claims.length && scope.book.bookPurpose === 'ordinary') {
      result.push(row)
      continue
    }
    const proof = await resolvePayrollABook(tx, String(row.id))
    if (proof.state === 'proven' && samePayrollABook(proof.book, scope.book))
      result.push(row)
    // 完全失去用途线索时，也不能证明这笔历史不属于当前管理簿；保留未知，不能跳过成零。
    else if (proof.state === 'unproven' && (scope.book.bookPurpose === 'ordinary' || (!explicit.length && !claims.some(isPayrollABook)) || explicit.some(r => r.book_purpose === scope.book.bookPurpose && r.management_book_id === scope.book.managementBookId) || claims.some(book => isPayrollABook(book) && samePayrollABook(book, scope.book))))
      result.push({ ...row, actual_amount: null })
  }
  return result
}
