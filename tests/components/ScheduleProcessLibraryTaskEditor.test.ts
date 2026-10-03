import type { ScheduleProcessLibraryTaskDraft } from '~/lib/schedule/process-library'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ScheduleProcessLibraryTaskEditor from '~/components/schedule/ScheduleProcessLibraryTaskEditor.vue'

const tasks: ScheduleProcessLibraryTaskDraft[] = [
  {
    key: 'setting-out',
    name: '放线',
    durationDays: 3,
    trade: '泥水工',
    color: '#8b5cf6',
    stageCode: '',
    itemCodes: [],
    predecessorKey: null,
  },
  {
    key: 'waterproof',
    name: '防水',
    durationDays: 5,
    trade: '防水工',
    color: '#06b6d4',
    stageCode: 'WP-02',
    itemCodes: ['WP-WALL'],
    predecessorKey: 'setting-out',
  },
]

describe('标准工序库工序编辑表', () => {
  it('前置工序只列当前行之前的候选，并将字段修改回传给父级', async () => {
    const view = render(ScheduleProcessLibraryTaskEditor, {
      props: { tasks },
    })

    expect(
      (screen.getByRole('textbox', { name: '放线编码' }) as HTMLInputElement).readOnly,
    ).toBe(true)
    await fireEvent.update(screen.getByRole('spinbutton', { name: '防水默认工期' }), '8')
    expect(view.emitted()['update:tasks']?.at(-1)?.[0]).toEqual([
      tasks[0],
      { ...tasks[1], durationDays: 8 },
    ])

    await fireEvent.click(screen.getByRole('button', { name: '设置防水前置工序' }))
    expect(screen.getByRole('dialog').textContent).toContain('放线')
    expect(screen.getByRole('dialog').textContent).not.toContain('防水工')
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /放线/ }))
    await fireEvent.click(screen.getByRole('button', { name: '保存前置关系' }))
    expect(view.emitted()['update:tasks']?.at(-1)?.[0]).toEqual([
      tasks[0],
      { ...tasks[1], predecessorDisabled: false },
    ])
  })

  it('提供新增工序动作', async () => {
    const view = render(ScheduleProcessLibraryTaskEditor, {
      props: { tasks },
    })

    await fireEvent.click(screen.getByRole('button', { name: '新增工序' }))
    expect(view.emitted().add).toHaveLength(1)
  })

  it('置灰关系的原前置不再更早时，不能绕过恢复限制直接启用', async () => {
    render(ScheduleProcessLibraryTaskEditor, {
      props: {
        tasks: [
          { ...tasks[1], predecessorKey: 'setting-out', predecessorDisabled: true },
          { ...tasks[0] },
        ],
        plannedWindows: [
          { key: 'waterproof', plannedStart: '2026-07-01', plannedFinish: '2026-07-05' },
          { key: 'setting-out', plannedStart: '2026-07-06', plannedFinish: '2026-07-08' },
        ],
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '设置防水前置工序' }))
    expect((screen.getByRole('button', { name: '重新启用' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '保存前置关系' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('请先把原前置工序调整到当前工序之前。')).not.toBeNull()
  })
})
