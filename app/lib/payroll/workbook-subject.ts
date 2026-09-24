import type { PayrollStatementRow } from './central-contract'

export function payrollWorkbookBookLabel(row: PayrollStatementRow): string {
  if (row.formatFamily !== 'A')
    return row.formatFamily
  return row.book?.bookPurpose === 'management' ? `A·管理费簿·${row.book.managementBookId}` : row.book?.bookPurpose === 'ordinary' ? 'A·普通施工簿' : 'A·旧簿用途缺失'
}

export function payrollWorkbookSubjectKey(row: PayrollStatementRow): string {
  const book = row.formatFamily === 'A' ? `${row.book?.bookPurpose ?? 'unknown'}:${row.book?.managementBookId ?? ''}` : row.formatFamily
  return [row.projectId, row.leaderWorkerId, row.formatFamily, book].join(':')
}

export function payrollWorkbookSubjectLabel(row: PayrollStatementRow): string {
  return `${row.projectName || row.projectId}-${row.leaderName || row.leaderWorkerId}-${payrollWorkbookBookLabel(row)}`
}
