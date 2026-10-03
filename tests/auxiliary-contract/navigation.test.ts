import { describe, expect, it } from 'vitest'
import { validateAuxiliaryReturnTo } from '../../app/lib/auxiliary-contract/navigation'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'

describe('辅助合同只读导航', () => {
  it.each((['other_expense', 'company_expense']).map(input => ({ input })))('两类主链接落到各自只读路由，返回保留筛选页码和锚点：输入案例 %#', ({ input: kind }) => {
    const origin = '/contract/other-expense?search=检测&page=2&pageSize=10&supplierId=s-1#aux-row-c-1'
    expect(validateAuxiliaryReturnTo(origin, 'real')).toBe(origin)
    const target = resolveNavigationTarget({ kind: 'entity-detail', subject: { entity: 'contract', state: 'resolved', id: 'c-1', label: '合同', no: null }, variant: kind, view: null, filters: { dataOrigin: 'real', contractKind: kind } })
    expect(target).toMatchObject({ state: 'resolved', to: `/contract/${kind.replace('_', '-')}/c-1?origin=real` })
  })
  it.each([
    { case: '\'/project/p-1?origin=real&tab=contract#contracts\' / \'real\'', input: '/project/p-1?origin=real&tab=contract#contracts', argument2: 'real' },
    { case: '\'/base/supplier/s-1?origin=real&tab=contracts\' / \'real\'', input: '/base/supplier/s-1?origin=real&tab=contracts', argument2: 'real' },
  ])('返回严格校验内部路由、层数和来源，不接受任意 URL 或跨来源上下文 / validateAuxiliaryReturnTo：$case', ({ input, argument2 }) => {
    expect(validateAuxiliaryReturnTo(input, argument2)).not.toBeNull()
  })

  it.each(Array.from(['https://example.com', '//example.com', '/contract/other-expense/c-1?origin=demo', '/settings/ocr', '/contract/company-expense?projectId=p-1', '/contract/other-expense/../construction']).map(input => ({ input })))('返回严格校验内部路由、层数和来源，不接受任意 URL 或跨来源上下文：输入组合 1 案例 %#', ({ input: value }) => {
    expect(validateAuxiliaryReturnTo(value, 'real')).toBeNull()
  })
  it('项目和分供方的列表来源可以嵌套在真实详情返回链中', () => {
    expect(validateAuxiliaryReturnTo(`/project/p-1?origin=real&returnTo=${encodeURIComponent('/project?returnTo=https://example.com')}`)).toBeNull()
  })

  it.each(Array.from([
    ['/project/p-1?origin=real', '/project?search=检测&page=2&pageSize=10&nav=return330#project-row-real.p-1'],
    ['/base/supplier/s-1?origin=real', '/base/supplier?search=检测&page=2&pageSize=10#supplier-row-real%3As-1'],
  ]))('项目和分供方的列表来源可以嵌套在真实详情返回链中：输入组合 1 案例 %#', (detail, list) => {
    const source = `${detail}&returnTo=${encodeURIComponent(list!)}#auxiliary-contract-journey`
    expect(validateAuxiliaryReturnTo(source)).not.toBeNull()
  })
})
