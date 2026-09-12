import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { targetCostListQuery, targetCostOrigin, targetCostReturnTo, targetCostSourceContext } from '~/lib/target-cost/navigation'
import { targetCostProjectTarget } from '~/lib/target-cost/project-navigation'

describe('目标成本来源与返回上下文', () => {
  it('项目入口由唯一Registry解析且仅在有读取能力时开放', () => {
    const input = { projectId: 'project', projectName: '已有项目', origin: 'real' as const, returnTo: '/project/target-cost/a?origin=real&tab=comparison' }
    expect(targetCostProjectTarget({ ...input, allowed: false })).toBeNull()
    const target = targetCostProjectTarget({ ...input, allowed: true })!
    expect(new URL(target, 'https://ruihang.invalid').pathname).toBe('/project/project')
    expect(new URL(target, 'https://ruihang.invalid').searchParams.get('returnTo')).toBe(input.returnTo)
  })
  it('保留完整筛选分页，丢弃未知键与非法页码', () => {
    expect(targetCostListQuery({ origin: 'real', search: '预算', project: 'p', baseline: ['baseline', 'history'], status: ['draft'], page: '2', pageSize: '20', sort: 'name-asc', write: 'yes' })).toEqual({ origin: 'real', search: '预算', project: 'p', baseline: ['baseline', 'history'], status: ['draft'], page: '2', pageSize: '20', sort: 'name-asc' })
    expect(targetCostListQuery({ page: '-1', pageSize: 'abc' })).toEqual({ origin: 'real' })
  })
  it('失效来源不回退，同名跨来源不能返回串页', () => {
    expect(targetCostOrigin('bad')).toBeNull()
    expect(targetCostOrigin(['real', 'demo'])).toBeNull()
    expect(targetCostReturnTo('/project/target-cost?origin=demo', 'real')).toBeNull()
    expect(targetCostReturnTo('/project/target-cost/form/a?origin=real', 'real')).toBeNull()
    expect(targetCostReturnTo('https://evil.invalid/project/target-cost', 'real')).toBeNull()
    expect(targetCostReturnTo('/project/target-cost?origin=real&search=A&page=2', 'real')).toBe('/project/target-cost?origin=real&search=A&page=2')
  })
  it('来源语义导航保持项目、原版本和完整列表筛选，未知或跨来源返回拒绝', () => {
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
    const context = targetCostSourceContext(url.pathname, Object.fromEntries(url.searchParams))
    expect(context).toMatchObject({ id: 'budget-a', projectId: 'p', origin: 'real' })
    expect(new URL(context!.returnTo, 'https://ruihang.invalid').searchParams.get('returnTo')).toBe(targetCostReturnTo(list, 'real'))
    expect(targetCostSourceContext('/finance/payment', Object.fromEntries(url.searchParams))).toBeNull()
    expect(targetCostSourceContext(url.pathname, { ...Object.fromEntries(url.searchParams), origin: 'demo' })).toBeNull()
  })
})
