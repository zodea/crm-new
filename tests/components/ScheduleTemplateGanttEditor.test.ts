import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ScheduleTemplateGanttEditor from '~/components/schedule/ScheduleTemplateGanttEditor.vue'

const rows = [
  {
    key: 'setting-out',
    name: '放线及新建墙体',
    trade: '泥水工',
    color: '#8b5cf6',
    plannedStart: '2026-07-01',
    plannedFinish: '2026-07-03',
  },
  {
    key: 'waterproof',
    name: '卫生间回填及防水',
    trade: '防水工',
    color: '#06b6d4',
    plannedStart: '2026-07-04',
    plannedFinish: '2026-07-07',
  },
]

describe('模板甘特编辑器', () => {
  it.each([
    { key: 'ArrowRight', mode: '移动模板工序', start: '2026-07-02', finish: '2026-07-04' },
    { key: 'ArrowLeft', mode: '移动模板工序', start: '2026-06-30', finish: '2026-07-02' },
    { key: 'ArrowRight', mode: '调整模板工期', start: '2026-07-01', finish: '2026-07-04' },
    { key: 'ArrowLeft', mode: '调整模板工期', start: '2026-07-01', finish: '2026-07-02' },
  ])('$mode / $key 只向父级提交一个完整日期窗口', async ({ key, mode, start, finish }) => {
    const view = render(ScheduleTemplateGanttEditor, {
      props: { rows },
    })

    await fireEvent.keyDown(screen.getByRole('button', { name: `${mode}：放线及新建墙体` }), { key })
    expect(view.emitted().updateWindow).toEqual([[{
      key: 'setting-out',
      plannedStart: start,
      plannedFinish: finish,
    }]])
  })

  it('显示工序、工种和日期', () => {
    render(ScheduleTemplateGanttEditor, {
      props: { rows },
    })

    expect(screen.getByRole('grid', { name: '标准工序模板甘特' }).textContent)
      .toContain('卫生间回填及防水')
  })
})
