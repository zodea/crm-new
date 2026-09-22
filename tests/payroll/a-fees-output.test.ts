import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from '~/lib/payroll/a-export'
import { feeDocument, feeManagementBook, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

it('冻结费用工作表保存逐条基数和负价，原文档不变且不称完整工作簿', () => {
  const document = feeDocument()
  const management = feeManagementBook()
  document.book = { bookPurpose: 'management', managementBookId: management.book.id }
  document.fees.management = { book: management.book, revision: management.revision! }
  document.fees.negativeLines = [{ ...negativeDraft(), id: 'negative-revision', lineId: 'negative-line', statementId: document.id, projectId: document.projectId, managementBookId: management.book.id, managementRevisionId: management.revision!.id, revision: 1, signedAmountFen: -60000, removed: false, operatorId: 'actor', createdAt: '2026-09-14' }]
  const before = JSON.stringify(document)
  const result = createPayrollAWorkbook(document)
  const book = XLSX.read(result.data, { type: 'array' })
  expect(book.SheetNames).toEqual(expect.arrayContaining(['费用组成', '费用原量依据', '负价代付清单', '本簿此前实际已领']))
  expect(XLSX.utils.sheet_to_json(book.Sheets['负价代付清单']!)).toContainEqual(expect.objectContaining({ 数量: 30, 单位: '套', 负单价: -20, 有符号金额: -600, 事由: '未收尾代付依据' }))
  expect(result.defaultName).toContain('管理费进度款')
  expect(JSON.stringify(document)).toBe(before)
})
