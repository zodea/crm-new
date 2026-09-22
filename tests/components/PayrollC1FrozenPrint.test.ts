import { render } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PayrollC1FrozenPrint from '~/components/payroll/PayrollC1FrozenPrint.vue'
import { c1Frozen } from '../helpers/payroll-c1-ui'

describe('c1 配对打印材料', () => {
  it('两份表同原人、原考勤、原标准与实发，含全成员和签字手印', () => {
    const view = render(PayrollC1FrozenPrint, { props: { document: c1Frozen() } })
    const pages = document.querySelectorAll('[data-payroll-print-page]')
    expect(pages).toHaveLength(2)
    expect(pages[0]!.textContent).toContain('C1 工资表')
    expect(pages[0]!.textContent).toContain('60.125')
    expect(pages[0]!.textContent).toContain('¥300.00')
    expect(pages[0]!.textContent).toContain('零成员')
    expect(pages[0]!.textContent).toContain('签字确认并按手印')
    expect(pages[1]!.textContent).toContain('月度考勤表')
    expect(pages[1]!.textContent).toContain('原施工内容')
    expect(pages[1]!.querySelector('footer')?.textContent).toContain('现场负责人')
    view.unmount()
  })
})
