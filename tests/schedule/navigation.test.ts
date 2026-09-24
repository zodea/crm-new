import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { describe, expect, it } from 'vitest'
import {
  buildQuantityDrillLocation,
  buildScheduleReturnLocation,
  parseScheduleDrillContext,
  scheduleReturnContextQuery,
} from '~/lib/schedule/navigation'

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
  it('按原工序往返时保留用户筛选，日期只作说明且不更换阶段身份', () => {
    const location = buildQuantityDrillLocation('schedule', group, task, 'real', { building: 'building-2', month: '2026-09', view: 'crew', trade: '防水工', assignee: 'crew:1' }) as { query: Record<string, string> }
    const context = parseScheduleDrillContext(location.query)!
    expect(buildScheduleReturnLocation(context)).toMatchObject({ query: { building: 'building-2', month: '2026-09', view: 'crew', trade: '防水工', assignee: 'crew:1', stage: 'stage-1' } })
    expect(parseScheduleDrillContext({ ...location.query, task: ['task-1', 'task-2'] })).toBeNull()
    expect(parseScheduleDrillContext({ ...location.query, origin: 'invalid' })).toBeNull()
  })
  it('来源感知的排程下钻及返回保留正式或测试身份', () => {
    for (const origin of ['real', 'demo'] as const) {
      const location = buildQuantityDrillLocation('home', group, task, origin) as { query: Record<string, string> }
      expect(location.query.origin).toBe(origin)
      const context = parseScheduleDrillContext(location.query)!
      expect(buildScheduleReturnLocation(context)).toMatchObject({ path: '/', query: { project: task.projectId, origin } })
      expect(buildScheduleReturnLocation({ ...context, source: 'schedule' })).toMatchObject({ path: '/schedule', query: { origin } })
    }
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

  it('解析来源并返回对应首页或施工进度上下文', () => {
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

    expect(homeContext?.buildingIds).toEqual(['building-1', 'building-2'])
    expect(buildScheduleReturnLocation(homeContext!)).toEqual({
      path: '/',
      query: { project: 'project-1', group: 'group-1', task: 'task-1', buildings: 'building-1,building-2' },
    })
    expect(buildScheduleReturnLocation(scheduleContext!)).toEqual({
      path: '/schedule',
      query: { project: 'project-1', group: 'group-1', task: 'task-1' },
    })
    expect(parseScheduleDrillContext({ from: 'invoice' })).toBeNull()
  })
})
