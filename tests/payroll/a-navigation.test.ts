import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollAEntryReturn, payrollAWorkspaceReturn, payrollSourceContext } from '~/lib/payroll/a-navigation'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'

describe('a工资原来源返回', () => {
  it('保存新建draftKey与独立编辑身份，不允许任意路径/另一来源/重复参数', () => {
    const draft = '/subcontract/payroll/new?origin=real&draftKey=draft-a&project=project-a'
    expect(payrollAWorkspaceReturn(draft, 'real')).toBe(draft)
    expect(payrollAWorkspaceReturn('/subcontract/payroll/form/wage-a?origin=real', 'real')).toBe('/subcontract/payroll/form/wage-a?origin=real')
    for (const path of ['/subcontract/payroll/new?origin=real', `${draft}&draftKey=draft-b`, 'https://evil.test/', '//evil.test/path', '/subcontract/payroll/config?origin=real', '/base/worker/form/worker-a'])
      expect(payrollAWorkspaceReturn(path, 'real')).toBeNull()
    expect(payrollAWorkspaceReturn(draft, 'demo')).toBeNull()
  })
  it('工程量入口保留全部原筛选，限定同项目同来源', () => {
    const path = '/subcontract/quantity?origin=real&project=p&building=b&month=2026-09&view=crew&trade=泥水&assignee=worker%3Aw'
    expect(new URL(payrollAEntryReturn(path, 'real', 'p')!, 'https://test.invalid').searchParams.get('trade')).toBe('泥水')
    expect(payrollAEntryReturn(path, 'real', 'other')).toBeNull()
    expect(payrollAEntryReturn(`${path}&commandId=cmd`, 'real')).toBeNull()
    expect(payrollAEntryReturn(path, 'demo')).toBeNull()
  })
  it('冷恢复仅保留只读来源marker，工资配置和新建写态不恢复', () => {
    const back = '/subcontract/payroll/new?origin=real&draftKey=draft-a&project=project-a'
    const query = new URLSearchParams({ origin: 'real', payrollReturnTo: back, payrollSourceKind: 'quantity-unit', payrollSourceId: 'unit-a', payrollProject: 'project-a', stageId: 'stage-a', itemId: 'item-a', completionId: 'completion-a' })
    const path = `/subcontract/quantity/project-a/unit-a?${query}`
    const restored = inspectRestorableTabPath(path)
    expect(new URL(restored!.fullPath, 'https://test.invalid').searchParams.get('payrollReturnTo')).toBe(back)
    expect(restored!.fullPath).toContain('completionId=completion-a')
    expect(inspectRestorableTabPath(path.replace('payrollSourceId=unit-a', 'payrollSourceId=unit-b'))).toBeNull()
    expect(inspectRestorableTabPath('/subcontract/payroll/config?origin=real')).toBeNull()
    expect(inspectRestorableTabPath(back)).toBeNull()
  })
  it('registry以稳定户身份生成来源marker，篡改/换项目时不能当原工资返回', () => {
    const result = resolveNavigationTarget({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: 'unit-a', label: '101', no: null }, variant: 'detail', view: null, filters: { projectId: 'project-a', dataOrigin: 'real', stageId: 'stage-a' } }, { returnTo: '/subcontract/payroll/form/wage-a?origin=real' })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('应有可达来源')
    const url = new URL(result.to, 'https://test.invalid')
    expect(url.pathname).toBe('/subcontract/quantity/project-a/unit-a')
    expect(url.searchParams.get('origin')).toBe('real')
    expect(url.searchParams.get('stageId')).toBe('stage-a')
    const query = Object.fromEntries(url.searchParams)
    const expected = { kind: 'quantity-unit' as const, id: 'unit-a', projectId: 'project-a', origin: 'real' as const }
    expect(payrollSourceContext(query, expected)?.statementId).toBe('wage-a')
    expect(payrollSourceContext(query, { ...expected, id: 'unit-b' })).toBeNull()
    expect(payrollSourceContext(query, { ...expected, projectId: 'project-b' })).toBeNull()
    expect(payrollSourceContext({ ...query, payrollReturnTo: '/project/project-a' }, expected)).toBeNull()
  })
})
