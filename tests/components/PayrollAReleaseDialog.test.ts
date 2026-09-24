import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PayrollAReleaseDialog from '~/components/payroll/PayrollAReleaseDialog.vue'

function form(): PayrollAFormRead {
  const known = { value: 300, knownValue: 300, state: 'known' as const, reasons: [] }
  return { context: { workspaceId: 'w', actorId: 'a', origin: 'real', sourceVersion: 'v1', capabilities: ['payroll:read', 'payroll:write'], readonly: false }, statementId: 'wage-a', draftKey: null, status: 'checked', needsRecheck: false, paymentSourceVersion: 'paid-v1', draft: { projectId: 'p', leaderWorkerId: 'leader', memberWorkerIds: ['leader', 'zero'] }, options: { projects: [], crews: [], workers: [] }, members: [{ id: 'leader', name: '负责人', crewId: null, eligible: true, reasons: [], source: null }, { id: 'zero', name: '零收款成员', crewId: null, eligible: true, reasons: [], source: null }], facts: [], lines: [], prices: [], ratioDefault: { value: 1, source: 'subject-config', statementId: null, configId: null, sourceVersion: null }, totals: { workAmount: known, cumulativeAmount: known, previouslyPaid: known, grossAmount: known }, blockers: [], eligibility: { canSaveDraft: false, canCheck: true, canRelease: true, canOutput: false, reasons: [] } }
}

describe('中央A工资实发确认', () => {
  it('保留零成员，提交后等实际结果，不主动关闭弹层', async () => {
    const { emitted } = render(PayrollAReleaseDialog, { props: { open: true, read: form(), busy: false, pending: false, error: '' } })
    expect((await screen.findByRole('spinbutton', { name: '零收款成员收款金额' }) as HTMLInputElement).value).toBe('0')
    await fireEvent.click(screen.getByRole('button', { name: '确认实际发放' }))
    expect(emitted().submit?.[0]?.[0]).toEqual({ actualAmount: 300, allocations: [{ workerId: 'leader', amount: 300 }, { workerId: 'zero', amount: 0 }] })
    expect(emitted()['update:open']).toBeUndefined()
  })
  it('金额空白不转零；分配差一分不能确认，未知提交保输入并禁关闭', async () => {
    const { rerender, emitted } = render(PayrollAReleaseDialog, { props: { open: true, read: form(), busy: false, pending: false, error: '' } })
    const total = await screen.findByRole('spinbutton', { name: '实际发放总额' })
    await fireEvent.update(total, '')
    expect((screen.getByRole('button', { name: '确认实际发放' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('填写实际发放')
    await fireEvent.update(total, '300')
    await fireEvent.update(screen.getByRole('spinbutton', { name: '负责人收款金额' }), '299.99')
    expect(screen.getByRole('alert').textContent).toContain('0.01')
    await rerender({ open: true, read: form(), busy: false, pending: true, error: '结果尚未确认' })
    expect((screen.getByRole('spinbutton', { name: '负责人收款金额' }) as HTMLInputElement).value).toBe('299.99')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(emitted()['update:open']).toBeUndefined()
  })
})
