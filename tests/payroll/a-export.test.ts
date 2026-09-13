import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from '~/lib/payroll/a-export'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'

describe('冻结 A 工资实际工作簿', () => {
  it('生成可解析xlsx，保存原冻结四金额、姓名和零收款成员，不加入未开放类型', () => {
    const document = payrollUiDocument()
    const file = createPayrollAWorkbook(document)
    const workbook = XLSX.read(file.data, { type: 'array' })
    expect(file.defaultName).toBe('冻结项目-原负责人-2026-09-工资表.xlsx')
    expect(workbook.SheetNames).toEqual(['发放汇总', '工资明细', '组内分配', '此前实际发放'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.发放汇总!)).toEqual([expect.objectContaining({ 累计应付: 400, 此前实际已发: 20, 本次核算应发: 300, 本次实际发放: 280, 经办人: '原经办人' })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.组内分配!)).toEqual([expect.objectContaining({ 收款人: '原负责人', 实际收款金额: 280 }), expect.objectContaining({ 收款人: '零收款成员', 实际收款金额: 0 })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.工资明细!)).toEqual([expect.objectContaining({ 工人: '原负责人', 完成现场量: 8, 工资单价: 12 })])
  })
})
