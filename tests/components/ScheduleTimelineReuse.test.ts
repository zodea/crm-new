import type { ScheduleProjectView } from '~/lib/schedule/read-model'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
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
  it('首页和施工进度页通过同一可观察时间轴呈现同一工序', async () => {
    const home = render(HomeScheduleOverview, {
      props: {
        snapshot,
        today: '2026-05-20',
      },
      global,
    })

    const homeTimeline = screen.getByRole('grid', { name: '施工排程时间轴' })
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

    const boardTimeline = screen.getByRole('grid', { name: '施工排程时间轴' })
    expect(boardTimeline.textContent).toContain('放线及新建墙体')
    await fireEvent.click(screen.getByRole('button', { name: '放线及新建墙体', exact: true }))
    expect(board.emitted().selectTask?.[0]).toEqual([snapshot.groups[0]!.tasks[0]])
  })
})
