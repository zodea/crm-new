import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  dependencyConflictPreview,
  dependencyConflicts,
  dependencyWouldCycle,
  planTemplateTasks,
  rescheduledTaskWindow,
  scheduleDeviationDays,
  schedulePlannedProgress,
} from '~/lib/schedule/planning'

describe('施工进度纯领域规则', () => {
  it('三种搭接方式与手工锚定产出可复现的计划区间', () => {
    const rows = [
      { key: 'a', durationDays: 10, enabled: true, anchorStart: null },
      { key: 'b', durationDays: 6, enabled: true, anchorStart: null },
      { key: 'c', durationDays: 4, enabled: true, anchorStart: '2026-07-20' },
    ] as const

    expect(planTemplateTasks('2026-07-01', 'half', rows)).toEqual([
      { key: 'a', durationDays: 10, plannedStart: '2026-07-01', plannedFinish: '2026-07-10' },
      { key: 'b', durationDays: 6, plannedStart: '2026-07-06', plannedFinish: '2026-07-11' },
      { key: 'c', durationDays: 4, plannedStart: '2026-07-20', plannedFinish: '2026-07-23' },
    ])
    expect(planTemplateTasks('2026-07-01', 'seq', rows).map(row => row.plannedStart))
      .toEqual(['2026-07-01', '2026-07-11', '2026-07-20'])
    expect(planTemplateTasks('2026-07-01', 'same', rows).map(row => row.plannedStart))
      .toEqual(['2026-07-01', '2026-07-01', '2026-07-20'])
  })

  it('计划应完成率与偏差天数只依赖公开计划/实际输入', () => {
    expect(schedulePlannedProgress('2026-07-01', '2026-07-11', '2026-07-06')).toBe(0.5)
    expect(schedulePlannedProgress('2026-07-01', '2026-07-11', '2026-06-20')).toBe(0)
    expect(schedulePlannedProgress('2026-07-01', '2026-07-11', '2026-07-20')).toBe(1)
    expect(scheduleDeviationDays({
      plannedStart: '2026-07-01',
      plannedFinish: '2026-07-11',
      actualProgress: 0.8,
      today: '2026-07-06',
    })).toBe(3)
  })

  it('fS+lag 只报告真正越过约束的后续工序', () => {
    const conflicts = dependencyConflicts(
      [
        { id: 'a', name: '前置', plannedStart: '2026-07-01', plannedFinish: '2026-07-20' },
        { id: 'b', name: '后续', plannedStart: '2026-07-08', plannedFinish: '2026-07-18' },
        { id: 'c', name: '宽松后续', plannedStart: '2026-07-25', plannedFinish: '2026-07-30' },
      ],
      [
        { id: 'd1', predId: 'a', succId: 'b', dependencyType: 'FS', lagDays: -5 },
        { id: 'd2', predId: 'a', succId: 'c', dependencyType: 'FS', lagDays: 2 },
      ],
    )

    expect(conflicts).toEqual([expect.objectContaining({
      dependencyId: 'd1',
      predecessorId: 'a',
      successorId: 'b',
      requiredDate: '2026-07-15',
    })])
  })

  it('依赖预览实时给出最早日期和冲突天数，lag 只接受 -365..365', () => {
    expect(dependencyConflictPreview({
      predecessorFinish: '2026-07-20',
      successorStart: '2026-07-18',
      lagDays: 2,
    })).toEqual({
      earliestStart: '2026-07-22',
      conflictDays: 4,
      hasConflict: true,
    })
    expect(dependencyConflictPreview({
      predecessorFinish: '2026-07-20',
      successorStart: '2026-07-22',
      lagDays: 2,
    }).hasConflict).toBe(false)
    expect(() => dependencyConflictPreview({
      predecessorFinish: '2026-07-20',
      successorStart: '2026-07-22',
      lagDays: 366,
    })).toThrow(/-365.*365/)
    expect(() => dependencyConflictPreview({
      predecessorFinish: '2026-07-20',
      successorStart: '2026-07-22',
      lagDays: 1.5,
    })).toThrow(/整数/)
  })

  it('新增或恢复依赖会拦截自环和跨多跳循环', () => {
    const dependencies = [
      { id: 'ab', predId: 'a', succId: 'b', dependencyType: 'FS' as const, lagDays: 0 },
      { id: 'bc', predId: 'b', succId: 'c', dependencyType: 'FS' as const, lagDays: 0 },
    ]
    expect(dependencyWouldCycle(dependencies, { predecessorId: 'c', successorId: 'a' })).toBe(true)
    expect(dependencyWouldCycle(dependencies, { predecessorId: 'a', successorId: 'c' })).toBe(false)
    expect(dependencyWouldCycle(dependencies, { predecessorId: 'a', successorId: 'a' })).toBe(true)
  })

  it('甘特拖动整体平移日期，右缘只调整工期且不允许负工期', () => {
    expect(rescheduledTaskWindow({
      plannedStart: '2026-07-01',
      plannedFinish: '2026-07-10',
      deltaDays: 3,
      mode: 'move',
    })).toEqual({
      plannedStart: '2026-07-04',
      plannedFinish: '2026-07-13',
    })
    expect(rescheduledTaskWindow({
      plannedStart: '2026-07-01',
      plannedFinish: '2026-07-10',
      deltaDays: -20,
      mode: 'resize-finish',
    })).toEqual({
      plannedStart: '2026-07-01',
      plannedFinish: '2026-07-01',
    })
    expect(addCalendarDays('2026-07-01', 3)).toBe('2026-07-04')
  })
})
