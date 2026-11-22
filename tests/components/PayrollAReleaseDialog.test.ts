import type { PayrollAFormRead, PayrollAReleaseDraft } from '~/lib/payroll/central-a-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { payrollReleaseDefault, payrollReleaseError } from '~/lib/payroll/a-presentation'
import PayrollAReleaseDialog from '~/pages/subcontract/payroll/_components/PayrollAReleaseDialog.vue'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

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

it('明确空鼓450全部抵完请款450时可在原发放确认中提交全员0，撤权和普通零额仍拒', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const draft = { ...f.draft, payRatio: 0.3, ratioPlan: { schemaVersion: 1 as const, itemRatios: [{ itemId: f.target.itemId, ratio: 0.3 }], feeRatios: [] } }
    const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    const read = await form()
    expect(read.eligibility.canRelease).toBe(true)
    const ui = render(PayrollAReleaseDialog, { props: { open: true, read, busy: false, pending: false, error: '' } })
    const confirm = await screen.findByRole('button', { name: '确认实际发放' })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(confirm)
    const release = ui.emitted().submit![0]![0] as PayrollAReleaseDraft
    expect(release).toEqual({ actualAmount: 0, allocations: [{ workerId: draft.leaderWorkerId, amount: 0 }] })
    await f.service.execute(f.command(read, { kind: 'release-a', release: JSON.parse(JSON.stringify(release)) }))
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: draft.projectId })).netAmount.value).toBe(0)
    const denied = { ...read, eligibility: { ...read.eligibility, canRelease: false } }
    expect(payrollReleaseError(denied, payrollReleaseDefault(denied))).not.toBe('')
    const legacy: PayrollAFormRead = { ...read }
    delete legacy.hollow
    expect(payrollReleaseError(legacy, payrollReleaseDefault(legacy))).not.toBe('')
    expect(payrollReleaseError(read, { ...release, actualAmount: null })).not.toBe('')
    ui.unmount()
  }
  finally { await f.close() }
}, 30_000)
