import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PayrollC1ReleaseDialog from '~/components/payroll/PayrollC1ReleaseDialog.vue'
import PayrollC2ReleaseDialog from '~/components/payroll/PayrollC2ReleaseDialog.vue'
import { c1Form } from '../helpers/payroll-c1-ui'
import { c2Form } from '../helpers/payroll-c2-ui'

describe.each([
  { family: 'c1', Dialog: PayrollC1ReleaseDialog, form: c1Form, defaultSubmit: { actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }] } },
  { family: 'c2', Dialog: PayrollC2ReleaseDialog, form: c2Form, defaultSubmit: { actualAmount: 525, allocations: [{ workerId: 'w', amount: 525 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } },
] as const)('$family 实际发放确认', ({ Dialog, form, defaultSubmit }) => {
  it('保全零成员，确认后等回执而不自行关窗', async () => {
    const view = render(Dialog, { props: { open: true, read: form(), busy: false, pending: false, error: '' } })
    expect((await screen.findByLabelText('零成员收款金额') as HTMLInputElement).value).toBe('0')
    await fireEvent.click(screen.getByRole('button', { name: '确认实际发放' }))
    expect(view.emitted().submit?.[0]?.[0]).toEqual(defaultSubmit)
    expect(view.emitted()['update:open']).toBeUndefined()
  })
  it('空白不转零，少一分不确认，unknown 保原分配且只恢复原提交', async () => {
    const read = form()
    const view = render(Dialog, { props: { open: true, read, busy: false, pending: false, error: '' } })
    await fireEvent.update(await screen.findByLabelText('实际发放总额'), '')
    expect((screen.getByRole('button', { name: '确认实际发放' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('实际发放总额'), '300')
    await fireEvent.update(screen.getByLabelText('原工人收款金额'), '299.99')
    expect(screen.getByRole('alert').textContent).toContain('0.01')
    await view.rerender({ open: true, read, busy: false, pending: true, error: '结果未知' })
    expect((screen.getByLabelText('原工人收款金额') as HTMLInputElement).value).toBe('299.99')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
    expect(view.emitted().recover).toHaveLength(1)
  })
})
