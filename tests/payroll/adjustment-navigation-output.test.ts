import type { PayrollAdjustmentDetailRead } from '~/lib/payroll/central-adjustment-contract'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { payrollActualLocation, payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { createPayrollConfirmationWorkbook, payrollAdjustmentConfirmation } from '~/lib/payroll/adjustment-output'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { knownPayrollSigned, payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

it('实际事实按原引用分流，工资筛选与预算/人员返回保留，外站与错来源拒绝', () => {
  expect(payrollActualLocation({ kind: 'actual-event', eventId: 'actual' }, 'real').path).toBe('/subcontract/payroll/payments/actual')
  expect(payrollActualLocation({ kind: 'released-statement', statementId: 'wage' }, 'real').path).toBe('/subcontract/payroll/wage')
  const source = '/subcontract/payroll?origin=real&project=project&month=2026-08&crew=crew&status=%5B%22checked%22%2C%22released%22%5D'
  const back = payrollAdjustmentReturn(source, 'real')!
  expect(new URL(back, 'https://local.invalid').searchParams.get('status')).toBe('["checked","released"]')
  expect(payrollAdjustmentReturn('/base/worker/worker?origin=real&returnTo=%2Fbase%2Fworker%3Fsearch%3D张#payroll-actual-section', 'real')).toContain('#payroll-actual-section')
  expect(payrollAdjustmentReturn('/project/target-cost/budget?origin=real&tab=comparison', 'real')).toContain('/budget?origin=real&tab=comparison')
  expect(payrollAdjustmentReturn('/subcontract/payroll/payments?origin=real&project=project&statementId=wage', 'real')).toContain('statementId=wage')
  expect(payrollAdjustmentReturn('https://evil.invalid/', 'real')).toBeNull()
  expect(payrollAdjustmentReturn('/subcontract/payroll/payments/actual?origin=demo', 'real')).toBeNull()
  expect(inspectRestorableTabPath('/subcontract/payroll/adjustments/adjustment?origin=real')).not.toBeNull()
  expect(inspectRestorableTabPath('/subcontract/payroll/payments/actual?origin=real')).not.toBeNull()
  expect(inspectRestorableTabPath('/subcontract/payroll/payments/new?origin=real')).toBeNull()
  expect(inspectRestorableTabPath('/subcontract/payroll/adjustments/form/adjustment?origin=real')).toBeNull()
})
it('更正确认实际工作簿保原签名1000、核減100与后来余额分开，草稿不给输出', () => {
  const form = payrollAdjustmentFormRead()
  const snapshot = { schemaVersion: 1 as const, id: 'adjustment', rootAdjustmentId: 'adjustment', correctsAdjustmentId: null, original: form.original, reason: '核减100', evidenceNote: '原价核对', preview: { ...form.preview, afterAmount: knownPayrollSigned(900), delta: knownPayrollSigned(-100) }, confirmedBy: 'actor', confirmedAt: '2026-09-01T00:00:00.000Z', commandId: 'command' }
  const read: PayrollAdjustmentDetailRead = { context: form.context, original: form.original, adjustment: { id: 'adjustment', rootAdjustmentId: 'adjustment', originalStatementId: 'wage-original', projectId: 'project', status: 'confirmed', draft: { ...form.draft, reason: snapshot.reason, evidenceNote: snapshot.evidenceNote }, delta: -100, snapshot }, balance: { adjustmentId: 'adjustment', rootAdjustmentId: 'adjustment', confirmedDelta: knownPayrollSigned(-100), appliedDelta: knownPayrollSigned(-40), remainingDelta: knownPayrollSigned(-60), balanceVersion: 'after-refund', applicationIds: [] }, applications: [] }
  const document = payrollAdjustmentConfirmation(read)!
  const file = createPayrollConfirmationWorkbook(document)
  const book = XLSX.read(file.data, { type: 'array' })
  const sheets = book.SheetNames.map(name => XLSX.utils.sheet_to_json(book.Sheets[name]!, { header: 1 }))
  expect(sheets[0]).toContainEqual(['wage-original', '原项目', '2026-08', 'C2', 1000, 1000])
  expect(sheets[1]).toContainEqual(['本次有符号差额', -100])
  expect(sheets.at(-1)).toContainEqual([-100, -40, -60])
  expect(payrollAdjustmentConfirmation({ ...read, adjustment: { ...read.adjustment, status: 'draft', snapshot: null } })).toBeNull()
})
it('人员或预算经工资原单进入更正后，三跳来源和独立工资项目完整保留', () => {
  const sources = ['/base/worker/worker?origin=real#payroll-actual-section', '/subcontract/payroll/payments?origin=real&project=project&budgetId=budget&budgetProject=project&budgetReturnTo=%2Fproject%2Ftarget-cost%2Fbudget%3Forigin%3Dreal%26tab%3Dcomparison', '/finance/payment-management?payrollProject=project']
  for (const source of sources) {
    const wage = `/subcontract/payroll/wage?origin=real&returnTo=${encodeURIComponent(source)}`
    const correction = `/subcontract/payroll/adjustments/adjustment?origin=real&returnTo=${encodeURIComponent(wage)}`
    const back = payrollAdjustmentReturn(correction, 'real')
    expect(back).not.toBeNull()
    const wageBack = new URL(back!, 'https://crm.invalid').searchParams.get('returnTo')!
    const sourceBack = new URL(wageBack, 'https://crm.invalid').searchParams.get('returnTo')!
    expect(new URL(sourceBack, 'https://crm.invalid').pathname).toBe(new URL(source, 'https://crm.invalid').pathname)
    expect(payrollAdjustmentReturn(sourceBack, 'real')).not.toBeNull()
  }
  expect(payrollAdjustmentReturn('/subcontract/payroll/wage?origin=real&returnTo=https%3A%2F%2Fevil.invalid', 'real')).toBeNull()
  expect(payrollAdjustmentReturn('/subcontract/payroll/payments?project=other&budgetId=budget&budgetProject=project&budgetReturnTo=%2Fproject%2Ftarget-cost%2Fbudget', 'real')).toBeNull()
  expect(payrollAdjustmentReturn('/finance/payment-management?payrollProject=bad%20identity', 'real')).toBeNull()
  expect(payrollAdjustmentReturn('/project/project?origin=real&origin=demo', 'real')).toBeNull()
})
it('付款工资专用项目在直接和详情嵌套冷页签还原中保留，重复及非法值拒绝', () => {
  const payment = '/finance/payment-management?payrollProject=project'
  expect(inspectRestorableTabPath(payment)?.fullPath).toBe(payment)
  const actual = `/subcontract/payroll/payments/actual?origin=real&returnTo=${encodeURIComponent(payment)}`
  const restored = inspectRestorableTabPath(actual)
  expect(new URL(restored!.fullPath, 'https://crm.invalid').searchParams.get('returnTo')).toBe(payment)
  expect(inspectRestorableTabPath('/finance/payment-management?payrollProject=one&payrollProject=two')).toBeNull()
  expect(inspectRestorableTabPath('/finance/payment-management?payrollProject=bad%20id')).toBeNull()
  expect(inspectRestorableTabPath('/finance/receipt?payrollProject=project')).toBeNull()
})
