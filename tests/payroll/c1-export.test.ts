import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollC1Workbook } from '../../app/lib/payroll/c1-export'
import { c1Frozen } from '../helpers/payroll-c1-ui'

describe('c1 真正配对工作簿', () => {
  it('回读同一冻结工资与逐日考勤，保60.125、零收款及未登记空格', () => {
    const document = c1Frozen()
    const file = createPayrollC1Workbook(document)
    const book = XLSX.read(file.data, { type: 'array' })
    expect(book.SheetNames).toEqual(['工资表', '考勤表'])
    const salary = XLSX.utils.sheet_to_json(book.Sheets.工资表!, { header: 1 }) as unknown[][]
    const attendance = XLSX.utils.sheet_to_json(book.Sheets.考勤表!, { header: 1 }) as unknown[][]
    expect(salary.some(row => row.includes(60.125))).toBe(true)
    expect(salary.find(row => row[0] === '核算应发')).toEqual(['核算应发', 601.25, '实际发放', 300])
    expect(salary.find(row => row[0] === '零成员')).toEqual(['零成员', '成员', 0, ''])
    expect(attendance[3]?.slice(0, 3)).toEqual(['原工人', '8 / 2', ''])
    expect(attendance[4]?.slice(0, 3)).toEqual(['零成员', '', ''])
    expect(attendance.some(row => row.includes('原施工内容'))).toBe(true)
    expect(JSON.stringify(salary)).not.toContain('此前实际发放')
    expect(file.defaultName).toContain('C1工资与考勤.xlsx')
  })
})
