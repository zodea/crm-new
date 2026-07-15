import { describe, expect, it } from 'vitest'
import { createDefaultPhaseTasks, derivePhaseViews, PROJECT_PHASES } from '~/lib/project/phases'

describe('项目六阶段定义', () => {
  it('按 #66 定稿为等序六阶段与 1/5/3/1/5/0 个默认任务', () => {
    expect(PROJECT_PHASES.map(phase => phase.name)).toEqual([
      '项目立项',
      '施工准备',
      '施工中',
      '完工及验收',
      '交付',
      '保修',
    ])
    const tasks = createDefaultPhaseTasks('p1')
    expect(PROJECT_PHASES.map((_, index) => tasks.filter(task => task.phaseIndex === index).length))
      .toEqual([1, 5, 3, 1, 5, 0])
  })

  it('阶段状态随任务完成数派生：全完成=done，首个未完成=active，其余=pending', () => {
    const tasks = createDefaultPhaseTasks('p1').map(task => ({
      ...task,
      status: task.phaseIndex === 0
        ? 'confirmed' as const
        : task.phaseIndex === 1 && task.taskIndex < 2
          ? 'uploaded' as const
          : 'pending' as const,
    }))
    expect(derivePhaseViews(tasks).map(view => ({
      name: view.name,
      progress: `${view.done}/${view.total}`,
      status: view.status,
    }))).toEqual([
      { name: '项目立项', progress: '1/1', status: 'done' },
      { name: '施工准备', progress: '2/5', status: 'active' },
      { name: '施工中', progress: '0/3', status: 'pending' },
      { name: '完工及验收', progress: '0/1', status: 'pending' },
      { name: '交付', progress: '0/5', status: 'pending' },
      { name: '保修', progress: '0/0', status: 'pending' },
    ])
  })
})
