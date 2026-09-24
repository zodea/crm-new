import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { payrollC1SourceContext, payrollC1WorkspaceReturn } from '../../app/lib/payroll/c1-navigation'

describe('c1 格式与原逐日来源', () => {
  it('个人配置返回保留原新建草稿身份、多状态与嵌套矩阵范围', () => {
    const matrix = `/subcontract/attendance?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]' })}`
    const back = `/subcontract/payroll/new?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]', format: 'C1', draftKey: 'draft-one', returnTo: matrix })}`
    const accepted = payrollC1WorkspaceReturn(back, 'real')
    expect(accepted).not.toBeNull()
    const result = new URL(accepted!, 'https://payroll.invalid')
    expect(result.pathname).toBe('/subcontract/payroll/new')
    expect(result.searchParams.get('draftKey')).toBe('draft-one')
    expect(result.searchParams.get('status')).toBe('["draft","checked"]')
    expect(result.searchParams.get('returnTo')).toBe(matrix)
    expect(payrollC1WorkspaceReturn(`${back}&unknown=x`, 'real')).toBeNull()
    expect(payrollC1WorkspaceReturn(back.replace('draft-one', ''), 'real')).toBeNull()
    expect(payrollC1WorkspaceReturn(back.replace('2026-08', '2026-13'), 'real')).toBeNull()
  })
  it('按原 record/worker/date 打开矩阵并保 C1 新草稿目标，不能串格式与来源', () => {
    const back = '/subcontract/payroll/new?origin=real&format=C1&draftKey=draft-one&project=p&month=2026-08&crew=c'
    const result = resolveNavigationTarget({ kind: 'source-record', subject: { state: 'resolved', entity: 'attendance', id: 'r', label: '原考勤', no: null }, variant: 'matrix', view: null, filters: { projectId: 'p', dataOrigin: 'real', month: '2026-08', crewId: 'c', workerId: 'w', workDate: '2026-08-01', recordId: 'r' } }, { returnTo: back })
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
    expect(payrollC1WorkspaceReturn(back.replace('format=C1', 'format=A'), 'real')).toBeNull()
    expect(payrollC1WorkspaceReturn(back, 'demo')).toBeNull()
  })
})
