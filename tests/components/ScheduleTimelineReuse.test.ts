import type { ScheduleProjectView } from '~/lib/schedule/read-model'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, shallowRef, watch } from 'vue'
import HomeScheduleOverview from '~/components/home/HomeScheduleOverview.vue'
import ScheduleBoard from '~/components/schedule/ScheduleBoard.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('watch', watch)

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(_, { slots }) {
    return () => h('a', slots.default?.())
  },
})

const StatusChipStub = defineComponent({
  setup(_, { slots }) {
    return () => h('span', slots.default?.())
  },
})

const snapshot: ScheduleProjectView = {
  id: 'project-1',
  name: '示范项目',
  code: 'DEMO-01',
  plannedStart: '2026-05-01',
  plannedFinish: '2026-06-30',
  plannedProgress: 0.6,
  actualProgress: 0.5,
  deviationDays: -2,
  dependencies: [],
  disabledDependencies: [],
  groups: [{
    id: 'group-1',
    projectId: 'project-1',
    contractId: 'contract-1',
    name: '1栋-2栋',
    sortOrder: 1,
    buildingIds: ['building-1', 'building-2'],
    buildingNames: ['1栋', '2栋'],
    plannedStart: '2026-05-01',
    plannedFinish: '2026-06-30',
    plannedProgress: 0.6,
    actualProgress: 0.5,
    deviationDays: -2,
    tasks: [{
      id: 'task-1',
      projectId: 'project-1',
      groupId: 'group-1',
      parentId: null,
      name: '放线及新建墙体',
      trade: '泥水工',
      color: '#7C5CE7',
      durationDays: 30,
      plannedStart: '2026-05-01',
      plannedFinish: '2026-05-30',
      baselineStart: null,
      baselineFinish: null,
      hasQty: false,
      manualProgress: 0.5,
      stageId: null,
      sortOrder: 1,
      itemIds: [],
      itemNames: [],
      boqLineIds: [],
      floorPlans: [],
      applicableUnits: null,
      completedUnits: null,
      actualProgress: 0.5,
      actualStart: null,
      actualFinish: null,
      plannedProgress: 0.6,
      deviationDays: -2,
    }],
  }],
}

const global = {
  components: {
    NuxtLink: NuxtLinkStub,
    StatusChip: StatusChipStub,
  },
}

describe('施工排程时间轴复用', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('今天线读取本机系统日期，不使用传入的固定演示日期', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12))
    const board = render(ScheduleBoard, {
      props: {
        snapshot,
        today: '2026-06-01',
      },
      global,
    })

    expect(document.querySelector('.today-label')?.getAttribute('style')).toContain('31.1475')
    board.unmount()
    vi.useRealTimers()
  })

  it('以同一棵 WBS Tree 呈现首页与工作台，并默认只展开首个楼栋分组', async () => {
    const secondGroup = {
      ...snapshot.groups[0]!,
      id: 'group-2',
      name: '3栋-4栋',
      buildingIds: ['building-3', 'building-4'],
      buildingNames: ['3栋', '4栋'],
      tasks: [{
        ...snapshot.groups[0]!.tasks[0]!,
        id: 'task-2',
        groupId: 'group-2',
        name: '给排水安装',
      }],
    }
    const twoGroupSnapshot = {
      ...snapshot,
      groups: [snapshot.groups[0]!, secondGroup],
    }

    const board = render(ScheduleBoard, {
      props: {
        snapshot: twoGroupSnapshot,
        today: '2026-05-20',
      },
      global,
    })

    expect(screen.getByRole('tree', { name: '施工排程 WBS' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '放线及新建墙体', exact: true })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '给排水安装', exact: true })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /计划起止/ })).not.toBeNull()
    expect(screen.queryByText('计划开始', { exact: true })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '展开分组：3栋-4栋' }))
    expect(screen.getByRole('button', { name: '给排水安装', exact: true })).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '向3栋-4栋追加工序' }))
    expect(board.emitted().addTask?.[0]).toEqual([secondGroup])
    expect(screen.getByRole('button', { name: '给排水安装', exact: true })).not.toBeNull()

    const secondGroupItem = screen.getByRole('treeitem', { name: /3栋-4栋/ })
    await fireEvent.click(within(secondGroupItem).getByText('61天', { exact: true }))
    expect(screen.getByRole('button', { name: '给排水安装', exact: true })).not.toBeNull()

    secondGroupItem.focus()
    await fireEvent.keyDown(secondGroupItem, { key: 'ArrowLeft' })
    expect(screen.queryByRole('button', { name: '给排水安装', exact: true })).toBeNull()
    await fireEvent.keyDown(secondGroupItem, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '给排水安装', exact: true })).not.toBeNull()
    expect(JSON.parse(window.sessionStorage.getItem('schedule-wbs-expanded-groups-v2') ?? '{}')).toEqual({
      '["","","real"]:real:project-1': ['group-1', 'group-2'],
    })
    board.unmount()

    render(HomeScheduleOverview, {
      props: {
        snapshot: twoGroupSnapshot,
        today: '2026-05-20',
      },
      global,
    })
    expect(screen.getByRole('tree', { name: '施工排程 WBS' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '给排水安装', exact: true })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /追加工序/ })).toBeNull()
  })

  it('首页和施工进度页通过同一可观察时间轴呈现同一工序', async () => {
    const home = render(HomeScheduleOverview, {
      props: {
        snapshot,
        today: '2026-05-20',
      },
      global,
    })

    const homeTimeline = screen.getByTestId('home-schedule-scroll')
    expect(homeTimeline.textContent).toContain('放线及新建墙体')
    await fireEvent.click(screen.getByRole('button', { name: '放线及新建墙体', exact: true }))
    expect(home.emitted().selectTask?.[0]).toEqual([snapshot.groups[0]!.tasks[0]])
    home.unmount()

    const board = render(ScheduleBoard, {
      props: {
        snapshot,
        today: '2026-05-20',
      },
      global,
    })

    const boardTimeline = screen.getByTestId('schedule-scroll')
    expect(boardTimeline.textContent).toContain('放线及新建墙体')
    await fireEvent.click(screen.getByRole('button', { name: '放线及新建墙体', exact: true }))
    expect(board.emitted().selectTask?.[0]).toEqual([snapshot.groups[0]!.tasks[0]])
    const durationHandle = screen.getByRole('button', { name: '调整工期：放线及新建墙体' })
    Object.assign(durationHandle, { setPointerCapture: vi.fn() })
    await fireEvent.pointerDown(durationHandle, { pointerId: 4, clientX: 20 })
    await fireEvent.pointerMove(durationHandle, { pointerId: 4, clientX: 200 })
    await fireEvent.pointerCancel(durationHandle, { pointerId: 4, clientX: 200 })
    expect(board.emitted().rescheduleTask).toBeUndefined()

    await fireEvent.keyDown(durationHandle, { key: 'ArrowRight' })
    expect(board.emitted().rescheduleTask?.[0]).toEqual([{
      task: snapshot.groups[0]!.tasks[0],
      plannedStart: '2026-05-01',
      plannedFinish: '2026-05-31',
    }])
  })

  it('快速拖动即使没有中间 pointermove 也以 pointerup 最终位置提交日期', async () => {
    const board = render(ScheduleBoard, {
      props: {
        snapshot,
        today: '2026-05-20',
      },
      global,
    })

    const planBar = screen.getByRole('button', { name: '移动工序：放线及新建墙体' })
    const chart = planBar.closest('.chart-cell')
    expect(chart).not.toBeNull()
    Object.assign(planBar, { setPointerCapture: vi.fn() })
    Object.assign(chart!, {
      getBoundingClientRect: () => ({ width: 610 }),
    })

    await fireEvent.pointerDown(planBar, { pointerId: 8, clientX: 100 })
    await fireEvent.pointerUp(planBar, { pointerId: 8, clientX: 110 })

    expect(board.emitted().rescheduleTask?.[0]).toEqual([{
      task: snapshot.groups[0]!.tasks[0],
      plannedStart: '2026-05-02',
      plannedFinish: '2026-05-31',
    }])

    const durationHandle = screen.getByRole('button', { name: '调整工期：放线及新建墙体' })
    Object.assign(durationHandle, { setPointerCapture: vi.fn() })
    await fireEvent.pointerDown(durationHandle, { pointerId: 9, clientX: 100 })
    await fireEvent.pointerUp(durationHandle, { pointerId: 9, clientX: 110 })

    expect(board.emitted().rescheduleTask?.[1]).toEqual([{
      task: snapshot.groups[0]!.tasks[0],
      plannedStart: '2026-05-01',
      plannedFinish: '2026-05-31',
    }])
  })
})
