import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { payrollC1SourceContext, payrollC1WorkspaceReturn } from '../../app/lib/payroll/c1-navigation'
import { payrollDayworkReturn } from '../../app/lib/payroll/c2-navigation'
import { inspectRestorableTabPath } from '../../app/lib/tabs/restore-target'

describe('c1 格式与原逐日来源', () => {
  function configReturnPaths() {
    const matrix = `/subcontract/attendance?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]' })}`
    const back = `/subcontract/payroll/new?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]', format: 'C1', draftKey: 'draft-one', returnTo: matrix })}`
    return { matrix, back }
  }

  it('个人配置返回保留原新建草稿身份、多状态与嵌套矩阵范围', () => {
    const { matrix, back } = configReturnPaths()
    const accepted = payrollC1WorkspaceReturn(back, 'real')
    expect(accepted).not.toBeNull()
    const result = new URL(accepted!, 'https://payroll.invalid')
    expect(result.pathname).toBe('/subcontract/payroll/new')
    expect(result.searchParams.get('draftKey')).toBe('draft-one')
    expect(result.searchParams.get('status')).toBe('["draft","checked"]')
    expect(result.searchParams.get('returnTo')).toBe(matrix)
  })

  it.each([
    { reason: '意外查询参数', change: (back: string) => `${back}&unknown=x` },
    { reason: '缺失草稿编号', change: (back: string) => back.replace('draft-one', '') },
    { reason: '无效月份', change: (back: string) => back.replace('2026-08', '2026-13') },
  ])('个人配置拒绝异常返回范围（$reason）', ({ change }) => {
    expect(payrollC1WorkspaceReturn(change(configReturnPaths().back), 'real')).toBeNull()
  })

  const attendanceReturn = '/subcontract/payroll/new?origin=real&format=C1&draftKey=draft-one&project=p&month=2026-08&crew=c'

  it('按原 record/worker/date 打开矩阵并保 C1 新草稿目标，不能串格式与来源', () => {
    const result = resolveNavigationTarget({ kind: 'source-record', subject: { state: 'resolved', entity: 'attendance', id: 'r', label: '原考勤', no: null }, variant: 'matrix', view: null, filters: { projectId: 'p', dataOrigin: 'real', month: '2026-08', crewId: 'c', workerId: 'w', workDate: '2026-08-01', recordId: 'r' } }, { returnTo: attendanceReturn })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('target unavailable')
    const url = new URL(result.to, 'https://payroll.invalid')
    expect(url.pathname).toBe('/subcontract/attendance')
    expect(url.searchParams.get('record')).toBe('r')
    expect(url.searchParams.get('worker')).toBe('w')
    const query = Object.fromEntries(url.searchParams)
    expect(payrollC1SourceContext(query, { kind: 'attendance', id: 'r', origin: 'real', projectId: 'p' })?.draftKey).toBe('draft-one')
    expect(payrollC1SourceContext(query, { kind: 'attendance', id: 'another', origin: 'real', projectId: 'p' })).toBeNull()
  })

  it.each([
    { reason: '其他工资格式', to: attendanceReturn.replace('format=C1', 'format=A'), origin: 'real' },
    { reason: '其他数据来源', to: attendanceReturn, origin: 'demo' },
  ] as const)('原考勤返回拒绝错配（$reason）', ({ to, origin }) => {
    expect(payrollC1WorkspaceReturn(to, origin)).toBeNull()
  })
})

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
