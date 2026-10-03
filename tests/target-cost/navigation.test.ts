import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { targetCostListQuery, targetCostOrigin, targetCostReturnTo, targetCostSourceContext } from '~/lib/target-cost/navigation'
import { targetCostProjectTarget } from '~/lib/target-cost/project-navigation'

describe('目标成本来源与返回上下文', () => {
  it.each([
    { case: '没有读取能力', allowed: false },
    { case: '有读取能力', allowed: true },
  ])('项目入口由唯一 Registry 解析并核对读取能力：$case', ({ allowed }) => {
    const input = { projectId: 'project', projectName: '已有项目', origin: 'real' as const, returnTo: '/project/target-cost/a?origin=real&tab=comparison' }
    const target = targetCostProjectTarget({ ...input, allowed })
    if (!allowed) {
      expect(target).toBeNull()
      return
    }
    if (target === null)
      throw new Error('具备读取能力时项目入口应开放')
    expect(new URL(target, 'https://ruihang.invalid').pathname).toBe('/project/project')
    expect(new URL(target, 'https://ruihang.invalid').searchParams.get('returnTo')).toBe(input.returnTo)
  })
  it.each([
    { case: '{ origin: \'real\', search: \'预算\', project: \'p\', baseline: [\'baseline\', \'history\'], status: [\'draft\'], page: \'2\', pageSize: \'20\'', input: { origin: 'real', search: '预算', project: 'p', baseline: ['baseline', 'history'], status: ['draft'], page: '2', pageSize: '20', sort: 'name-asc', write: 'yes' }, expected: { origin: 'real', search: '预算', project: 'p', baseline: ['baseline', 'history'], status: ['draft'], page: '2', pageSize: '20', sort: 'name-asc' } },
    { case: '{ page: \'-1\', pageSize: \'abc\' }', input: { page: '-1', pageSize: 'abc' }, expected: { origin: 'real' } },
  ])('保留完整筛选分页，丢弃未知键与非法页码 / targetCostListQuery：$case', ({ input, expected }) => {
    expect(targetCostListQuery(input)).toEqual(expected)
  })
  it('失效来源不回退，同名跨来源不能返回串页', () => {
    expect(targetCostReturnTo('/project/target-cost?origin=real&search=A&page=2', 'real')).toBe('/project/target-cost?origin=real&search=A&page=2')
  })

  it.each([
    { case: '\'bad\'', input: 'bad' },
    { case: '[\'real\', \'demo\']', input: ['real', 'demo'] },
  ])('失效来源不回退，同名跨来源不能返回串页 / targetCostOrigin：$case', ({ input }) => {
    expect(targetCostOrigin(input)).toBeNull()
  })

  it.each([
    { case: '\'/project/target-cost?origin=demo\' / \'real\'', input: '/project/target-cost?origin=demo', argument2: 'real' },
    { case: '\'/project/target-cost/form/a?origin=real\' / \'real\'', input: '/project/target-cost/form/a?origin=real', argument2: 'real' },
    { case: '\'https://evil.invalid/project/target-cost\' / \'real\'', input: 'https://evil.invalid/project/target-cost', argument2: 'real' },
  ])('失效来源不回退，同名跨来源不能返回串页 / targetCostReturnTo：$case', ({ input, argument2 }) => {
    expect(targetCostReturnTo(input, argument2)).toBeNull()
  })
  it.each([
    { case: '匹配来源', path: '/contract/subcontract', origin: 'real', accepted: true },
    { case: '未接来源页', path: '/finance/payment', origin: 'real', accepted: false },
    { case: '跨数据来源', path: '/contract/subcontract', origin: 'demo', accepted: false },
  ])('来源语义导航保持项目、原版本与完整筛选：$case', ({ path, origin, accepted }) => {
    const list = '/project/target-cost?origin=real&search=A&page=2&pageSize=20&baseline=history'
    const returnTo = `/project/target-cost/budget-a?origin=real&tab=comparison&returnTo=${encodeURIComponent(list)}`
    const result = resolveNavigationTarget({ kind: 'entity-list', entity: 'contract', variant: 'subcontract', view: null, filters: { dataOrigin: 'real', projectId: 'p', costCategory: '合同劳务' } }, { returnTo })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('来源未解析')
    const url = new URL(result.to, 'https://ruihang.invalid')
    expect(url.pathname).toBe('/contract/subcontract')
    expect(url.searchParams.get('projectId')).toBe('p')
    expect(url.searchParams.get('subKind')).toBe('劳务')
    const context = targetCostSourceContext(path, { ...Object.fromEntries(url.searchParams), origin })
    if (!accepted) {
      expect(context).toBeNull()
      return
    }
    expect(context).toMatchObject({ id: 'budget-a', projectId: 'p', origin: 'real' })
    const restoredList = new URL(new URL(context!.returnTo, 'https://ruihang.invalid').searchParams.get('returnTo')!, 'https://ruihang.invalid')
    expect(restoredList.pathname).toBe('/project/target-cost')
    expect(Object.fromEntries(restoredList.searchParams)).toEqual({ origin: 'real', search: 'A', baseline: 'history', page: '2', pageSize: '20' })
  })
})
