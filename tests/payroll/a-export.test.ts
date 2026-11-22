import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from '~/lib/payroll/a-export'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'
import { feeDocument, feeManagementBook, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

describe('冻结 A 工资实际工作簿', () => {
  it('生成可解析xlsx，保存原冻结四金额、姓名和零收款成员，不加入未开放类型', () => {
    const document = payrollUiDocument()
    const file = createPayrollAWorkbook(document)
    const workbook = XLSX.read(file.data, { type: 'array' })
    expect(file.defaultName).toMatch(/^工资-冻结项目-位置未记录-分项未记录-2026-09-月度-原负责人-[a-f0-9]{32}\.xlsx$/)
    expect(workbook.SheetNames).toEqual(['发放汇总', '工资明细', '组内分配', '此前实际发放', '原施工范围', '施工范围说明'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.发放汇总!)).toEqual([expect.objectContaining({ 累计应付: 400, 此前实际已发: 20, 本次核算应发: 300, 本次实际发放: 280, 经办人: '原经办人' })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.组内分配!)).toEqual([expect.objectContaining({ 收款人: '原负责人', 实际收款金额: 280 }), expect.objectContaining({ 收款人: '零收款成员', 实际收款金额: 0 })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.工资明细!)).toEqual([expect.objectContaining({ 工人: '原负责人', 完成现场量: 8, 工资单价: 12 })])
  })
})

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
