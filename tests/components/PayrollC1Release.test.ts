import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PayrollC1ReleaseDialog from '~/components/payroll/PayrollC1ReleaseDialog.vue'
import { c1Form } from '../helpers/payroll-c1-ui'

describe('c1 实际发放确认', () => {
  it('保全零成员，确认后等回执而不自行关窗', async () => {
    const view = render(PayrollC1ReleaseDialog, { props: { open: true, read: c1Form(), busy: false, pending: false, error: '' } })
    expect((await screen.findByLabelText('零成员收款金额') as HTMLInputElement).value).toBe('0')
    await fireEvent.click(screen.getByRole('button', { name: '确认实际发放' }))
    expect(view.emitted().submit?.[0]?.[0]).toEqual({ actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }] })
    expect(view.emitted()['update:open']).toBeUndefined()
  })
  it('空白不转零，少一分不确认，unknown 保原分配且只恢复原提交', async () => {
    const read = c1Form()
    const view = render(PayrollC1ReleaseDialog, { props: { open: true, read, busy: false, pending: false, error: '' } })
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
