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
  it('键盘统一整体移动与右边缘改工期，并只向父级提交一个窗口状态', async () => {
    const view = render(ScheduleTemplateGanttEditor, {
      props: { rows },
    })

    const move = screen.getByRole('button', { name: '移动模板工序：放线及新建墙体' })
    await fireEvent.keyDown(move, { key: 'ArrowRight' })
    expect(view.emitted().updateWindow?.[0]).toEqual([{
      key: 'setting-out',
      plannedStart: '2026-07-02',
      plannedFinish: '2026-07-04',
    }])

    const resize = screen.getByRole('button', { name: '调整模板工期：放线及新建墙体' })
    await fireEvent.keyDown(resize, { key: 'ArrowRight' })
    expect(view.emitted().updateWindow?.[1]).toEqual([{
      key: 'setting-out',
      plannedStart: '2026-07-01',
      plannedFinish: '2026-07-04',
    }])
  })

  it('显示工序、工种和日期并提供局部横向滚动容器', () => {
    render(ScheduleTemplateGanttEditor, {
      props: { rows },
    })

    expect(screen.getByRole('grid', { name: '标准工序模板甘特' }).textContent)
      .toContain('卫生间回填及防水')
    expect(screen.getByTestId('template-gantt-scroll').className).toContain('overflow-x-auto')
  })
})
