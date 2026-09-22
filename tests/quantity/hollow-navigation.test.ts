import type { NavigationIntentDTO } from '~/types/read-model'
import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollSourceContext } from '~/lib/payroll/a-navigation'
import { isQuantityHollowWorkPath, quantityHollowPath, quantityHollowQuery, quantityHollowSourceQuery } from '~/lib/quantity/hollow-navigation'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'

const namespace = 'core-quantity_projects-0123456789abcdef01234567'
const unitId = `${namespace}:units:${encodeURIComponent('一单元101')}`
const recordId = `${namespace}:quantity_hollow_records:${encodeURIComponent('厨房检查#1')}`
const revisionId = `${namespace}:quantity_hollow_revisions:${encodeURIComponent('原检查#1')}`
const scope = { projectId: 'project', unitId, origin: 'real' as const, includeDemo: false }
const back = '/subcontract/payroll/form/wage?origin=real&focus=completion&returnTo=%2Fsubcontract%2Fpayroll%3Forigin%3Dreal'
const intent = (): NavigationIntentDTO => ({ kind: 'entity-subview', subject: { state: 'resolved', entity: 'quantity-unit', id: unitId, label: '厨房空鼓', no: null }, variant: 'hollow-record', view: null, filters: { projectId: 'project', dataOrigin: 'real', recordId, revisionId } })

describe('户级空鼓的受控来源导航', () => {
  it('只允许规范工作地址直接刷新，中文迁入身份与原工资返回继续有效', () => {
    const resolved = resolveNavigationTarget(intent(), { returnTo: back })
    if (resolved.state !== 'resolved')
      throw new Error('来源不可达')
    const query = quantityHollowSourceQuery(scope, Object.fromEntries(new URL(resolved.to, 'https://test.invalid').searchParams))
    for (const [mode, additions] of [['new', { draftKey: 'original-draft' }], ['form', {}]] as const) {
      const path = `${quantityHollowPath(scope, mode, recordId)}?${new URLSearchParams({ ...query, ...additions })}`
      expect(isQuantityHollowWorkPath(path)).toBe(true)
      expect(isQuantityHollowWorkPath(`${path}#section-evidence`)).toBe(true)
      expect(inspectRestorableTabPath(path)).toBeNull()
      expect(isQuantityHollowWorkPath(path.replace('/subcontract/', '/prefix/../subcontract/'))).toBe(false)
      expect(isQuantityHollowWorkPath(`${path}&origin=real`)).toBe(false)
      expect(isQuantityHollowWorkPath(`${path}&unexpected=1`)).toBe(false)
      expect(isQuantityHollowWorkPath(`${path}#unknown`)).toBe(false)
      expect(isQuantityHollowWorkPath(path.replace('payrollReturnTo=', 'payrollReturnTo=https%3A%2F%2Fother.invalid%2F'))).toBe(false)
    }
    const native = { ...scope, unitId: 'native/unit' }
    expect(isQuantityHollowWorkPath(`${quantityHollowPath(native, 'new')}?origin=real&draftKey=draft`)).toBe(true)
    expect(isQuantityHollowWorkPath(`${quantityHollowPath(scope, 'form', recordId).replace('quantity_hollow_records', 'quantity_hollow_revisions')}?origin=real`)).toBe(false)
  })
  it('合法中文物理身份定位精确原修订，保原工资返回和只读冷页签', () => {
    const resolved = resolveNavigationTarget(intent(), { returnTo: back })
    expect(resolved.state).toBe('resolved')
    if (resolved.state !== 'resolved')
      throw new Error('来源不可达')
    const url = new URL(resolved.to, 'https://test.invalid')
    expect(url.pathname).toBe(quantityHollowPath(scope, 'detail', recordId))
    expect(url.searchParams.get('revisionId')).toBe(revisionId)
    expect(payrollSourceContext(Object.fromEntries(url.searchParams), { kind: 'quantity-unit', id: unitId, projectId: 'project', origin: 'real' })?.returnTo).toBe(back)
    expect(inspectRestorableTabPath(resolved.to)?.fullPath).toBe(resolved.to)
    expect(quantityHollowSourceQuery(scope, Object.fromEntries(url.searchParams)).payrollReturnTo).toBe(back)
  })
  it('拒绝错误来源、额外归属与重复修订，不把整页写态加入冷恢复', () => {
    expect(quantityHollowQuery('project', unitId, ['real', 'demo'])).toBeNull()
    expect(inspectRestorableTabPath(`${quantityHollowPath(scope, 'new')}?origin=real&draftKey=draft`)).toBeNull()
    expect(inspectRestorableTabPath(`${quantityHollowPath(scope, 'form', recordId)}?origin=real`)).toBeNull()
    const duplicate = `${quantityHollowPath(scope, 'detail', recordId)}?origin=real&revisionId=first&revisionId=second`
    expect(inspectRestorableTabPath(duplicate)).toBeNull()
    const bad = intent()
    bad.filters.ownerId = 'other-worker'
    expect(resolveNavigationTarget(bad).state).not.toBe('resolved')
    const wrongTable = intent()
    wrongTable.filters.revisionId = recordId
    expect(resolveNavigationTarget(wrongTable).state).not.toBe('resolved')
  })
})
