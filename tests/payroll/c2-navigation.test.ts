import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { payrollDayworkReturn } from '../../app/lib/payroll/c2-navigation'
import { inspectRestorableTabPath } from '../../app/lib/tabs/restore-target'

describe('c2 原签工导航', () => {
  it('按稳定签工身份打开只读台账，保原工资新稿而非进入编辑器', () => {
    const back = '/subcontract/payroll/new?origin=real&format=C2&draftKey=c2-new&project=p&month=2026-08&crew=c&status=%5B%22draft%22%2C%22checked%22%5D'
    const result = resolveNavigationTarget({ kind: 'source-record', subject: { state: 'resolved', entity: 'daywork', id: 'dw-one', label: '原签工', no: null }, variant: 'ledger', view: null, filters: { dataOrigin: 'real', projectId: 'p', month: '2026-08', crewId: 'c', workerId: 'w', workDate: '2026-08-01' } }, { returnTo: back })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('原签工目标不可达')
    const url = new URL(result.to, 'https://payroll.invalid')
    expect(url.pathname).toBe('/subcontract/daywork')
    expect(url.searchParams.get('record')).toBe('dw-one')
    expect(url.searchParams.get('worker')).toBe('w')
    expect(url.searchParams.get('workDate')).toBe('2026-08-01')
    expect(url.searchParams.get('payrollFormat')).toBe('C2')
    expect(url.searchParams.get('payrollReturnTo')).toBe(back)
    expect(payrollDayworkReturn(result.to, 'real')).toBe(result.to)
    expect(payrollDayworkReturn(result.to, 'demo')).toBeNull()
    expect(inspectRestorableTabPath(result.to)).not.toBeNull()
    expect(inspectRestorableTabPath('/subcontract/daywork/new?origin=real&draftKey=test')).toBeNull()
  })
})
