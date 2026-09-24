import { render, screen } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ScheduleContractBindingPage from '~/pages/schedule/[pid]/bind/[gid].vue'

const ScreenStub = defineComponent({
  props: {
    projectId: {
      type: String,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => h('div', {
      'data-testid': 'binding-screen-route',
      'data-project': props.projectId,
      'data-group': props.groupId,
    })
  },
})

describe('施工排程合同绑定路由', () => {
  beforeAll(() => {
    vi.stubGlobal('useRoute', () => ({
      params: {
        pid: 'project-1',
        gid: 'group-1',
      },
      query: { origin: 'real' },
    }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('把项目与分组参数交给独立整页 Screen', () => {
    render(ScheduleContractBindingPage, {
      global: {
        components: {
          ScheduleContractBindingScreen: ScreenStub,
        },
      },
    })

    expect(screen.getByTestId('binding-screen-route').dataset).toMatchObject({
      project: 'project-1',
      group: 'group-1',
    })
  })
})
