import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { describe, expect, it } from 'vitest'
import {
  buildQuantityDrillLocation,
  buildScheduleReturnLocation,
  parseScheduleDrillContext,
} from '~/lib/schedule/navigation'

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
      query: { project: 'project-1', group: 'group-1', task: 'task-1' },
    })
    expect(buildScheduleReturnLocation(scheduleContext!)).toEqual({
      path: '/schedule',
      query: { project: 'project-1', group: 'group-1', task: 'task-1' },
    })
    expect(parseScheduleDrillContext({ from: 'invoice' })).toBeNull()
  })
})
