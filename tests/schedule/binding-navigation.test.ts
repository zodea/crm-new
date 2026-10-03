import { describe, expect, it } from 'vitest'
import { buildBoqBuildingEvidenceLocation, buildScheduleBindingFloorLocation, buildScheduleBindingLocation, parseScheduleBindingReturnTo } from '~/lib/schedule/binding-navigation'

describe('绑定与清单证据更正往返', () => {
  it('清单来源与冻结楼层计划往返使用稳定合同、分组、清单行和楼层身份', () => {
    const floor = buildScheduleBindingFloorLocation('p', 'g', 'c', 'frozen', { task: 'original-task', month: '2026-09', view: 'crew' }, 'line')
    expect(floor.query).toMatchObject({ project: 'p', group: 'g', floorPlan: 'frozen', bindingContract: 'c', bindingLine: 'line', origin: 'real', month: '2026-09', view: 'crew' })
    const source = buildBoqBuildingEvidenceLocation('p', 'g', 'c', floor.query, 'line', true)
    expect(source.query).toMatchObject({ project: 'p', contract: 'c', line: 'line', mode: 'read', origin: 'real' })
    expect(parseScheduleBindingReturnTo(source.query.returnTo, 'p', 'c', 'real')).toContain('task=original-task')
  })
  it('携带固定项目分组来源、有效筛选与已选合同，不透传未知字段', () => {
    const location = buildScheduleBindingLocation('p', 'g', 'real', { task: 't', stage: 's', item: 'i', buildings: 'b1,b2', building: 'b2', month: '2026-09', view: 'crew', assignee: 'crew:c', trade: '泥水工', unsafe: '外部' }, 'c')
    expect(location).toEqual({ path: '/schedule/p/bind/g', query: { origin: 'real', contract: 'c', group: 'g', task: 't', stage: 's', item: 'i', buildings: 'b1,b2', building: 'b2', month: '2026-09', view: 'crew', assignee: 'crew:c', trade: '泥水工' } })
  })
  it.each((['https://evil.invalid', '//evil.invalid', '/schedule/other/bind/g?origin=real&contract=c', '/schedule/p/bind/g?origin=demo&contract=c', '/schedule/p/bind/g?origin=real&contract=other', '/schedule/p/bind/g?origin=real&origin=real&contract=c', '/schedule/p/bind/g?origin=real&contract=c&group=other', '/schedule/p/bind/g?origin=real&contract=c&task=x&task=y']).map(input => ({ input })))('更正来源仅可返回同项目同来源同合同的稳定分组，不容许失效或错配目标：输入案例 %#', ({ input: bad }) => {
    const valid = '/schedule/p/bind/g?origin=real&contract=c&group=g&task=t&view=crew&assignee=crew%3Ac&unsafe=x'
    expect(parseScheduleBindingReturnTo(valid, 'p', 'c', 'real')).toBe('/schedule/p/bind/g?origin=real&contract=c&view=crew&assignee=crew%3Ac&group=g&task=t')
    expect(parseScheduleBindingReturnTo(bad, 'p', 'c', 'real')).toBeNull()
  })
})
