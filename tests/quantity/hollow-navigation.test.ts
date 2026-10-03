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
  it.each([
    { case: '原生新建身份', path: `${quantityHollowPath({ ...scope, unitId: 'native/unit' }, 'new')}?origin=real&draftKey=draft`, allowed: true },
    { case: '错误记录物理表', path: `${quantityHollowPath(scope, 'form', recordId).replace('quantity_hollow_records', 'quantity_hollow_revisions')}?origin=real`, allowed: false },
  ])('工作地址核对规范物理身份：$case', ({ path, allowed }) => {
    expect(isQuantityHollowWorkPath(path)).toBe(allowed)
  })

  describe.each([['new', { draftKey: 'original-draft' }], ['form', {}]] as const)('%s 工作地址', (mode, additions) => {
    it.each([
      { case: '规范地址', change: (path: string) => path, allowed: true },
      { case: '已登记证据锚点', change: (path: string) => `${path}#section-evidence`, allowed: true },
      { case: '路径跳转片段', change: (path: string) => path.replace('/subcontract/', '/prefix/../subcontract/'), allowed: false },
      { case: '重复数据来源', change: (path: string) => `${path}&origin=real`, allowed: false },
      { case: '未登记参数', change: (path: string) => `${path}&unexpected=1`, allowed: false },
      { case: '未登记锚点', change: (path: string) => `${path}#unknown`, allowed: false },
      { case: '工资返回外链', change: (path: string) => path.replace('payrollReturnTo=', 'payrollReturnTo=https%3A%2F%2Fother.invalid%2F'), allowed: false },
    ])('核对受控来源与直接刷新边界：$case', ({ change, allowed }) => {
      const resolved = resolveNavigationTarget(intent(), { returnTo: back })
      if (resolved.state !== 'resolved')
        throw new Error('来源不可达')
      const query = quantityHollowSourceQuery(scope, Object.fromEntries(new URL(resolved.to, 'https://test.invalid').searchParams))
      const path = `${quantityHollowPath(scope, mode, recordId)}?${new URLSearchParams({ ...query, ...additions })}`
      expect(isQuantityHollowWorkPath(change(path))).toBe(allowed)
      expect(inspectRestorableTabPath(path)).toBeNull()
    })
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
    const duplicate = `${quantityHollowPath(scope, 'detail', recordId)}?origin=real&revisionId=first&revisionId=second`
    expect(inspectRestorableTabPath(duplicate)).toBeNull()
  })

  it.each([
    { case: '额外班组归属', filters: { ownerId: 'other-worker' } },
    { case: '修订来自错误物理表', filters: { revisionId: recordId } },
  ])('错误归属与修订不生成来源链接：$case', ({ filters }) => {
    const candidate = intent()
    Object.assign(candidate.filters, filters)
    expect(resolveNavigationTarget(candidate).state).not.toBe('resolved')
  })

  it.each([
    { case: '`{quantityHollowPath(scope, \'new\')}?origin=real&draftKey=draft`', input: `${quantityHollowPath(scope, 'new')}?origin=real&draftKey=draft` },
    { case: '`{quantityHollowPath(scope, \'form\', recordId)}?origin=real`', input: `${quantityHollowPath(scope, 'form', recordId)}?origin=real` },
  ])('拒绝错误来源、额外归属与重复修订，不把整页写态加入冷恢复 / inspectRestorableTabPath：$case', ({ input }) => {
    expect(inspectRestorableTabPath(input)).toBeNull()
  })
})
