import type { PayrollAFormRead, PayrollAReleaseDraft } from '~/lib/payroll/central-a-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import PayrollAReleaseDialog from '~/components/payroll/PayrollAReleaseDialog.vue'
import { payrollReleaseDefault, payrollReleaseError } from '~/lib/payroll/a-presentation'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

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
