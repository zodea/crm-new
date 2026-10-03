import { describe, expect, it } from 'vitest'
import { payrollReadLocation, payrollReturnTo, payrollSourceReturnTo, payrollViewScope } from '~/lib/payroll/central-navigation'
import { payrollStatementTarget } from '~/lib/payroll/central-target'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'

describe('中央工资阅读往返', () => {
  const scope = payrollViewScope({ origin: 'real', project: 'project-a', month: '2026-08', crew: 'crew-a', status: 'released', dayworkStatus: 'confirmed', format: 'C2', deleted: 'deleted', search: '成员', tab: 'daywork' })
  it('台账经唯一实体入口到工资详情，保来源与所有筛选，再返回原台账', () => {
    const from = payrollReadLocation('/subcontract/payroll', scope)
    const target = payrollStatementTarget({ id: 'wage-a', month: '2026-08', leaderName: '原姓名' }, scope, from)
    expect(target).not.toBeNull()
    const url = new URL(target!, 'https://test.invalid')
    expect(url.searchParams.get('origin')).toBe('real')
    expect(url.searchParams.get('project')).toBe('project-a')
    expect(url.searchParams.get('status')).toBe('released')
    expect(payrollReturnTo(url.searchParams.get('returnTo'), 'real')).toBe(from)
  })
  it('工资状态与签工确认状态独立，冷刷保全来源阅读筛选', () => {
    const path = payrollReadLocation('/subcontract/payroll/sources', scope)
    const restored = inspectRestorableTabPath(path)
    expect(restored?.fullPath).toBe(path)
    expect(new URL(restored!.fullPath, 'https://test.invalid').searchParams.get('status')).toBe('released')
    expect(new URL(restored!.fullPath, 'https://test.invalid').searchParams.get('dayworkStatus')).toBe('confirmed')
  })
  it('非法来源与重复项目不回默认；外部、写态及跨来源返回拒绝', () => {
    expect(inspectRestorableTabPath('/subcontract/payroll/new?origin=real')).toBeNull()
  })

  it.each([
    { case: '{ origin: \'invalid\' }', input: { origin: 'invalid' }, expected: '' },
    { case: '{ project: [\'a\', \'b\'] }', input: { project: ['a', 'b'] }, expected: '' },
  ])('非法来源与重复项目不回默认；外部、写态及跨来源返回拒绝 / payrollViewScope：$case', ({ input, expected }) => {
    expect(payrollViewScope(input).error).not.toBe(expected)
  })

  it.each(Array.from(['//evil.invalid', '/subcontract/payroll/new?origin=real', '/subcontract/payroll/wage-a?origin=demo']).map(input => ({ input })))('非法来源与重复项目不回默认；外部、写态及跨来源返回拒绝：输入组合 1 案例 %#', ({ input: path }) => {
    expect(payrollViewScope({ origin: 'invalid' }).error).not.toBe('')
    expect(payrollViewScope({ project: ['a', 'b'] }).error).not.toBe('')
    expect(payrollReturnTo(path, 'real')).toBeNull()
  })
  it('非法工资状态按现行规则恢复全部，不污染签工确认状态', () => {
    const parsed = payrollViewScope({ origin: 'real', status: 'confirmed', dayworkStatus: 'confirmed' })
    expect(parsed.status).toBe('')
    expect(parsed.dayworkStatus).toBe('confirmed')
    expect(inspectRestorableTabPath('/subcontract/payroll?origin=real&status=unknown')?.fullPath).toBe('/subcontract/payroll?origin=real')
  })
  it('签工改变范围后返回采用当前范围，保留来源工资的多状态', () => {
    const next = payrollViewScope({ origin: 'real', project: 'project-b', month: '2026-09', crew: '', status: '["draft","checked"]', dayworkStatus: 'confirmed' })
    const back = new URL(payrollSourceReturnTo('/subcontract/payroll/wage-a?origin=real&project=project-a', next), 'https://test.invalid')
    expect(back.pathname).toBe('/subcontract/payroll/wage-a')
    expect(back.searchParams.get('project')).toBe('project-b')
    expect(back.searchParams.get('crew')).toBeNull()
    expect(back.searchParams.get('status')).toBe('["draft","checked"]')
  })
})
