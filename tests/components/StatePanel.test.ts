import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import StatePanel from '~/components/ui/StatePanel.vue'

describe('statePanel', () => {
  it('announces structural loading with a layout skeleton', () => {
    render(StatePanel, {
      props: {
        kind: 'loading',
        title: '正在加载项目详情',
      },
    })

    const status = screen.getByRole('status', { name: '正在加载项目详情' })
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('[data-ui="state-panel-skeleton"]').length).toBeGreaterThan(2)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders business empty guidance and emits its optional primary action', async () => {
    const view = render(StatePanel, {
      props: {
        kind: 'empty',
        title: '还没有施工项目',
        description: '新建第一个项目后，可在这里跟踪阶段与经营数据。',
        actionLabel: '新增项目',
      },
    })

    expect(screen.getByRole('status', { name: '还没有施工项目' })).not.toBeNull()
    expect(screen.getByText('新建第一个项目后，可在这里跟踪阶段与经营数据。')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '新增项目' }))
    expect(view.emitted().action).toHaveLength(1)
  })

  it('uses an alert and retry action for failures', async () => {
    const view = render(StatePanel, {
      props: {
        kind: 'error',
        title: '项目加载失败',
        description: '数据库暂时不可用。',
        actionLabel: '重新加载',
      },
    })

    expect(screen.getByRole('alert', { name: '项目加载失败' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(view.emitted().action).toHaveLength(1)
  })

  it('presents a permission boundary as an expected status instead of an error alert', () => {
    render(StatePanel, {
      props: {
        kind: 'forbidden',
        title: '无权查看该详情',
        description: '请联系管理员申请对应业务范围。',
      },
    })

    expect(screen.getByRole('status', { name: '无权查看该详情' })).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('请联系管理员申请对应业务范围。')).not.toBeNull()
  })
})
