import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import HomeDashboardSurface from '~/components/home/HomeDashboardSurface.vue'
import StatePanel from '~/components/ui/StatePanel.vue'

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const HomeScheduleOverviewStub = defineComponent({
  emits: ['selectTask'],
  setup(_, { emit }) {
    return () => h('button', {
      'type': 'button',
      'aria-label': '施工进度甘特',
      'onClick': () => emit('selectTask', { id: 'task-1' }),
    }, '施工进度甘特')
  },
})

const global = {
  components: {
    NuxtLink: NuxtLinkStub,
    StatePanel,
  },
  stubs: { HomeScheduleOverview: HomeScheduleOverviewStub },
}

describe('homeDashboardSurface', () => {
  it('中央排程缺源不显示假进度或创建入口，查看来源保留项目身份', () => {
    render(HomeDashboardSurface, {
      props: { state: 'not-connected', today: '2026-09-10', selectedProjectId: 'new-project', selectedProjectName: '中央新项目', selectedOrigin: 'real', sourceDescription: '中央排程尚未接入，计划与实际进度未知。' },
      global,
    })
    expect(screen.getByRole('status', { name: '中央新项目的排程来源尚未接入' })).not.toBeNull()
    expect(screen.getByText('中央排程尚未接入，计划与实际进度未知。')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '施工进度甘特' })).toBeNull()
    expect(screen.queryByRole('link', { name: '新建楼栋分组' })).toBeNull()
    expect(JSON.parse(screen.getByRole('link', { name: '查看施工进度来源' }).getAttribute('href')!)).toEqual({ path: '/schedule', query: { project: 'new-project', origin: 'real', from: 'home' } })
  })
  it('renders loading, catalog-empty, schedule-empty and error as explicit shared states', async () => {
    const loading = render(HomeDashboardSurface, {
      props: { state: 'loading', today: '2026-07-27' },
      global,
    })
    expect(screen.getByRole('status', { name: '正在读取首页施工进度' })).not.toBeNull()
    loading.unmount()

    const catalogEmpty = render(HomeDashboardSurface, {
      props: { state: 'catalog-empty', today: '2026-07-27' },
      global,
    })
    expect(screen.getByRole('status', { name: '尚无可查看项目' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '新建项目' })).not.toBeNull()
    catalogEmpty.unmount()

    const scheduleEmpty = render(HomeDashboardSurface, {
      props: {
        state: 'schedule-empty',
        today: '2026-07-27',
        selectedProjectId: 'project-1',
        selectedProjectName: '示范项目',
      },
      global,
    })
    expect(screen.getByRole('status', { name: '示范项目还没有施工排程' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '新建楼栋分组' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '打开施工进度' })).not.toBeNull()
    scheduleEmpty.unmount()

    const error = render(HomeDashboardSurface, {
      props: {
        state: 'error',
        today: '2026-07-27',
        errorDescription: '数据库暂时不可用',
      },
      global,
    })
    expect(screen.getByRole('alert', { name: '首页施工进度加载失败' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(error.emitted().retry).toHaveLength(1)
  })

  it('keeps usable facts visible while announcing partial-data and recoverable switch errors', async () => {
    const snapshot = {
      id: 'project-1',
      groups: [],
    }
    const view = render(HomeDashboardSurface, {
      props: {
        state: 'ready',
        today: '2026-07-27',
        snapshot,
        coverageTitle: '部分排程数据尚未就绪',
        coverageDescription: '缺失部分不按 0 推断。',
        recoverableError: '切换失败，已恢复原项目。',
        recoverableTitle: '首页刷新失败，已保留当前项目',
        recoverableActionLabel: '重新刷新',
      },
      global,
    })

    expect(screen.getByRole('status', { name: '部分排程数据尚未就绪' })).not.toBeNull()
    expect(screen.getByRole('alert', { name: '首页刷新失败，已保留当前项目' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '施工进度甘特' })).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '重新刷新' }))
    expect(view.emitted().retryRecoverable).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: '施工进度甘特' }))
    expect(view.emitted().selectTask).toHaveLength(1)
  })

  it('replaces a recoverable error with a busy state while keeping cached facts visible', () => {
    render(HomeDashboardSurface, {
      props: {
        state: 'ready',
        today: '2026-07-27',
        snapshot: {
          id: 'project-1',
          groups: [],
        },
        recoverableError: '刷新失败，已保留当前项目。',
        recoverableLoading: true,
      },
      global,
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status', { name: '正在重新加载首页施工进度' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '施工进度甘特' })).not.toBeNull()
  })
})
