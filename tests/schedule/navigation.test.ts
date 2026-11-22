import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { describe, expect, it } from 'vitest'
import { buildBoqBuildingEvidenceLocation, buildScheduleBindingFloorLocation, buildScheduleBindingLocation, parseScheduleBindingReturnTo } from '~/lib/schedule/binding-navigation'
import { buildQuantityDrillLocation, buildScheduleReturnLocation, parseScheduleDrillContext, scheduleReturnContextQuery } from '~/lib/schedule/navigation'
import { processLibraryNavigationQuery, processLibraryReturnTo } from '~/lib/schedule/process-library-navigation'

it('首页总览与来源返回只保明确工序和五种筛选，不透传其他字段', () => {
  const context = { group: 'g', task: 't', stage: 's', item: 'i', buildings: 'b', building: 'b', month: '2026-08', view: 'crew', trade: '泥水工', assignee: 'crew:c' }
  expect(scheduleReturnContextQuery({ ...context, project: 'p', origin: 'real', unsafe: 'external' })).toEqual(context)
})

const task = {
  id: 'task-1',
  projectId: 'project-1',
  groupId: 'group-1',
  name: '卫生间防水',
  plannedStart: '2026-07-01',
  plannedFinish: '2026-07-10',
  stageId: 'stage-1',
  itemIds: ['item-1', 'item-2'],
  itemNames: ['墙面防水', '地面防水'],
} as ScheduleTaskView

const group = {
  id: 'group-1',
  name: '户内1栋-2栋',
  buildingIds: ['building-1', 'building-2'],
} as ScheduleGroupView

describe('排程下钻导航', () => {
  describe('按原工序往返时保留用户筛选，日期只作说明且不更换阶段身份', () => {
    const location = buildQuantityDrillLocation('schedule', group, task, 'real', { building: 'building-2', month: '2026-09', view: 'crew', trade: '防水工', assignee: 'crew:1' }) as { query: Record<string, string> }
    const context = parseScheduleDrillContext(location.query)!
    it('关联事实保持原契约', () => {
      expect(buildScheduleReturnLocation(context)).toMatchObject({ query: { building: 'building-2', month: '2026-09', view: 'crew', trade: '防水工', assignee: 'crew:1', stage: 'stage-1' } })
    })

    it.each([
      { case: '{ ...location.query, task: [\'task-1\', \'task-2\'] }', input: { ...location.query, task: ['task-1', 'task-2'] } },
      { case: '{ ...location.query, origin: \'invalid\' }', input: { ...location.query, origin: 'invalid' } },
    ])('parseScheduleDrillContext：$case', ({ input }) => {
      expect(parseScheduleDrillContext(structuredClone(input))).toBeNull()
    })
  })
  it.each((['real', 'demo'] as const).map(input => ({ input })))('来源感知的排程下钻及返回保留正式或测试身份：输入案例 %#', ({ input: origin }) => {
    const location = buildQuantityDrillLocation('home', group, task, origin) as { query: Record<string, string> }
    expect(location.query.origin).toBe(origin)
    const context = parseScheduleDrillContext(location.query)!
    expect(buildScheduleReturnLocation(context)).toMatchObject({ path: '/', query: { project: task.projectId, origin } })
    expect(buildScheduleReturnLocation({ ...context, source: 'schedule' })).toMatchObject({ path: '/schedule', query: { origin } })
  })
  it('首页和施工进度页共用完整工程量筛选参数', () => {
    const location = buildQuantityDrillLocation('home', group, task)

    expect(location).toEqual({
      path: '/subcontract/quantity',
      query: {
        project: 'project-1',
        group: 'group-1',
        building: 'building-1',
        buildings: 'building-1,building-2',
        task: 'task-1',
        groupName: '户内1栋-2栋',
        taskName: '卫生间防水',
        stage: 'stage-1',
        item: 'item-1',
        itemName: '墙面防水、地面防水',
        planStart: '2026-07-01',
        planFinish: '2026-07-10',
        from: 'home',
      },
    })
  })

  describe('解析来源并返回对应首页或施工进度上下文', () => {
    const homeContext = parseScheduleDrillContext({
      project: 'project-1',
      group: 'group-1',
      task: 'task-1',
      buildings: 'building-1,building-2',
      from: 'home',
    })
    const scheduleContext = parseScheduleDrillContext({
      project: 'project-1',
      group: 'group-1',
      task: 'task-1',
      from: 'schedule',
    })
    it('关联事实保持原契约', () => {
      expect(homeContext?.buildingIds).toEqual(['building-1', 'building-2'])
      expect(parseScheduleDrillContext({ from: 'invoice' })).toBeNull()
    })

    it.each([
      { case: 'homeContext!', input: homeContext!, expected: {
        path: '/',
        query: { project: 'project-1', group: 'group-1', task: 'task-1', buildings: 'building-1,building-2' },
      } },
      { case: 'scheduleContext!', input: scheduleContext!, expected: {
        path: '/schedule',
        query: { project: 'project-1', group: 'group-1', task: 'task-1' },
      } },
    ])('buildScheduleReturnLocation：$case', ({ input, expected }) => {
      expect(buildScheduleReturnLocation(structuredClone(input))).toEqual(expected)
    })
  })
})

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

describe('工序库建组返回上下文', () => {
  it('保留同来源稳定项目的建组入口，复制来源单独传递', () => {
    const returnTo = '/schedule/new?project=project-443&origin=real'
    expect(processLibraryReturnTo({ origin: 'real', returnTo })).toBe(returnTo)
    expect(processLibraryNavigationQuery('real', returnTo, 'version-1')).toEqual({ origin: 'real', returnTo, source: 'version-1' })
  })
  it.each([
    'https://evil.example/schedule/new?project=p&origin=real',
    '//evil.example/schedule/new?project=p&origin=real',
    '/schedule/new?project=p&origin=demo',
    '/schedule/new?project=p&origin=real&project=q',
    '/schedule/new?project=p&origin=real&step=3',
    '/schedule/new?project=p&origin=real#secret',
    '/project/form?project=p&origin=real',
    '/schedule/new?project=%00&origin=real',
    '/schedule/new?origin=real',
  ])('拒绝未授权的返回地址：%s', (returnTo) => {
    expect(processLibraryReturnTo({ origin: 'real', returnTo })).toBeNull()
    expect(processLibraryNavigationQuery('real', returnTo)).toEqual({ origin: 'real' })
  })
})
