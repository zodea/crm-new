import { render } from '@testing-library/vue'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import PayrollC2FrozenPrint from '~/components/payroll/PayrollC2FrozenPrint.vue'
import { createPayrollC2Workbook } from '~/lib/payroll/c2-export'
import { c2Frozen } from '../helpers/payroll-c2-ui'

it('工资和签工两个输出保原半工、证明、空规则及全成员真实分配，不输出考勤', () => {
  const frozen = c2Frozen()
  const view = render(PayrollC2FrozenPrint, { props: { document: frozen } })
  const pages = document.querySelectorAll('[data-payroll-print-page]')
  expect(pages).toHaveLength(2)
  expect(pages[0]!.textContent).toContain('¥525.00')
  expect(pages[0]!.textContent).toContain('¥500.00')
  expect(pages[0]!.textContent).toContain('零成员')
  expect(pages[0]!.textContent).toContain('签字确认并按手印')
  expect(pages[1]!.textContent).toContain('零星签工表')
  expect(pages[1]!.textContent).toContain('0.5 工')
  expect(pages[1]!.textContent).toContain('证明甲')
  expect(pages[1]!.textContent).toContain('已明确保存为空规则')
  expect(document.body.textContent).not.toContain('考勤表')
  const file = createPayrollC2Workbook(frozen)
  const book = XLSX.read(file.data, { type: 'array' })
  expect(book.SheetNames).toEqual(['工资表', '签工表'])
  const salary = XLSX.utils.sheet_to_json(book.Sheets.工资表!, { header: 1 })
  const source = XLSX.utils.sheet_to_json(book.Sheets.签工表!, { header: 1 })
  expect(salary).toContainEqual(['核算应发', 525, '实际发放', 500])
  expect(salary).toContainEqual(['零成员', '成员', 0, ''])
  expect(source).toContainEqual(['计算规则', ''])
  expect(source).toContainEqual(['原成员', '2026-08-01', '08:00', '17:00', 0.5, '原零星施工内容', '证明甲', '2026-08-02', ''])
  view.unmount()
})
