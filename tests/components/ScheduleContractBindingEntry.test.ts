import type { ScheduleProjectView } from '~/lib/schedule/read-model'
import { render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, shallowRef, watch } from 'vue'
import ScheduleBoard from '~/components/schedule/ScheduleBoard.vue'
import ScheduleTimeline from '~/components/schedule/ScheduleTimeline.vue'

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
  setup(props, { slots }) {
    return () => h('a', {
      'data-testid': 'contract-binding-entry',
      'data-to': JSON.stringify(props.to),
      'href': typeof props.to === 'string' ? props.to : '#',
    }, slots.default?.())
  },
})

const snapshot: ScheduleProjectView = {
  id: 'project-1',
  name: '前期项目',
  code: 'PRE-01',
  plannedStart: '2026-07-01',
  plannedFinish: '2026-07-31',
  plannedProgress: 0.4,
  actualProgress: 0,
  deviationDays: -4,
  dependencies: [],
  disabledDependencies: [],
  groups: [{
    id: 'group-1',
    projectId: 'project-1',
    contractId: '',
    scopeBasis: 'provisional',
    processLibraryId: 'library-1',
    processLibraryName: '精装修标准工序',
    processLibraryVersion: 1,
    name: '前期1-2栋',
    sortOrder: 10,
    buildingIds: ['building-1', 'building-2'],
    buildingNames: ['1栋', '2栋'],
    plannedStart: '2026-07-01',
    plannedFinish: '2026-07-31',
    plannedProgress: 0.4,
    actualProgress: 0,
    deviationDays: -4,
    tasks: [],
  }],
}

describe('内部暂估排程绑定入口', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('只给待绑定合同分组显示状态与独立页面入口', async () => {
    const view = render(ScheduleBoard, {
      props: {
        snapshot,
        today: '2026-07-15',
      },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
        },
      },
    })

    expect(screen.getByText('待绑定合同')).not.toBeNull()
    const entry = screen.getByRole('link', { name: '绑定施工合同' })
    expect(entry.dataset.to).toContain('/schedule/project-1/bind/group-1')

    await view.rerender({
      snapshot: {
        ...snapshot,
        groups: [{
          ...snapshot.groups[0]!,
          scopeBasis: 'contract',
          contractId: 'contract-1',
        }],
      },
      today: '2026-07-15',
    })

    expect(screen.queryByText('待绑定合同')).toBeNull()
    expect(screen.queryByRole('link', { name: '绑定施工合同' })).toBeNull()
  })

  it('首页概览持续显示待绑定状态，但不塞入编辑入口', () => {
    render(ScheduleTimeline, {
      props: {
        snapshot,
        today: '2026-07-15',
        mode: 'overview',
      },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
        },
      },
    })

    expect(screen.getByText('待绑定合同')).not.toBeNull()
    expect(screen.queryByRole('link', { name: '绑定施工合同' })).toBeNull()
  })
})
