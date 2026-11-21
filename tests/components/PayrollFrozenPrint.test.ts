import { render } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import PayrollAFrozenPrint from '~/components/payroll/PayrollAFrozenPrint.vue'
import PayrollC1FrozenPrint from '~/components/payroll/PayrollC1FrozenPrint.vue'
import PayrollC2FrozenPrint from '~/components/payroll/PayrollC2FrozenPrint.vue'
import { createPayrollC2Workbook } from '~/lib/payroll/c2-export'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'
import { c1Frozen } from '../helpers/payroll-c1-ui'
import { c2Frozen } from '../helpers/payroll-c2-ui'

it('打印内容仅用已传冻结值，零成员和四类签名位置完整', () => {
  const wrapper = mount(PayrollAFrozenPrint, { props: { document: payrollUiDocument() }, global: { stubs: { teleport: true } } })
  expect(wrapper.text()).toContain('原负责人')
  expect(wrapper.text()).toContain('零收款成员')
  expect(wrapper.text()).toContain('¥0.00')
  expect(wrapper.text()).toContain('此前实际已发')
  for (const label of ['班组长', '施工员', '安全员', '现场负责人', '签字确认并按手印'])
    expect(wrapper.text()).toContain(label)
  wrapper.unmount()
})

it.each([
  {
    format: 'C1',
    print: () => render(PayrollC1FrozenPrint, { props: { document: c1Frozen() } }),
    salary: ['C1 工资表', '60.125', '¥300.00'],
    source: ['月度考勤表', '原施工内容'],
    verifySource: (page: Element) => expect(page.querySelector('footer')?.textContent).toContain('现场负责人'),
  },
  {
    format: 'C2',
    print: () => render(PayrollC2FrozenPrint, { props: { document: c2Frozen() } }),
    salary: ['¥525.00', '¥500.00'],
    source: ['零星签工表', '0.5 工', '证明甲', '已明确保存为空规则'],
    verifySource: () => expect(document.body.textContent).not.toContain('考勤表'),
  },
])('$format 配对打印保留冻结工资和来源凭据', ({ print, salary, source, verifySource }) => {
  const view = print()
  const pages = document.querySelectorAll('[data-payroll-print-page]')
  expect(pages).toHaveLength(2)
  for (const text of [...salary, '零成员', '签字确认并按手印'])
    expect(pages[0]!.textContent).toContain(text)
  for (const text of source)
    expect(pages[1]!.textContent).toContain(text)
  verifySource(pages[1]!)
  view.unmount()
})

it('c2 工作簿保留原半工、证明、空规则和零分配成员', () => {
  const file = createPayrollC2Workbook(c2Frozen())
  const book = XLSX.read(file.data, { type: 'array' })
  expect(book.SheetNames).toEqual(['工资表', '签工表'])
  const salary = XLSX.utils.sheet_to_json(book.Sheets.工资表!, { header: 1 })
  const source = XLSX.utils.sheet_to_json(book.Sheets.签工表!, { header: 1 })
  expect(salary).toContainEqual(['核算应发', 525, '实际发放', 500])
  expect(salary).toContainEqual(['零成员', '成员', 0, ''])
  expect(source).toContainEqual(['计算规则', ''])
  expect(source).toContainEqual(['原成员', '2026-08-01', '08:00', '17:00', 0.5, '原零星施工内容', '证明甲', '2026-08-02', ''])
})
