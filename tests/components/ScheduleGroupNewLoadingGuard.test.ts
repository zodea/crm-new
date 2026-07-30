import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import ScheduleGroupNewScreen from '~/components/schedule/ScheduleGroupNewScreen.vue'

const NuxtLinkStub = defineComponent({
  setup(_, { slots }) {
    return () => h('a', { href: '#' }, slots.default?.())
  },
})

const SelectFilterStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h('select', attrs)
  },
})

const GanttStub = defineComponent({
  setup() {
    return () => h('div', { 'role': 'grid', 'aria-label': '标准工序模板甘特' })
  },
})

describe('新建排程范围加载保护', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('切换范围时禁用下一步，楼栋加载完成后才允许进入第二步', async () => {
    let loadBuildingsCalls = 0
    let resolveProvisionalBuildings: (() => void) | undefined
    const store = {
      catalog: [{ id: 'project-1', name: '测试项目', code: 'P-01' }],
      contracts: [{ id: 'contract-1', name: '施工合同', no: 'SG-01', lineCount: 1 }],
      processLibraries: [{
        id: 'library-1',
        name: '标准工序',
        version: 1,
        taskCount: 1,
        isDefault: true,
      }],
      processTasks: [{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }],
      processTasksLibraryId: 'library-1',
      buildings: [{ id: 'building-1', name: '1栋', code: 'B1' }],
      buildingCoverage: [{
        id: 'building-1',
        name: '1栋',
        code: 'B1',
        inContract: true,
        scheduled: false,
      }],
      saving: false,
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraries: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraryTasks: vi.fn().mockResolvedValue([{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }]),
      loadContracts: vi.fn().mockResolvedValue(undefined),
      loadBuildings: vi.fn(async () => {
        loadBuildingsCalls += 1
        if (loadBuildingsCalls === 1)
          return
        await new Promise<void>((resolve) => {
          resolveProvisionalBuildings = resolve
        })
      }),
      createGroup: vi.fn(),
    }

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => ({ query: { project: 'project-1' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useScheduleStore', () => store)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }))

    render(ScheduleGroupNewScreen, {
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          ScheduleTemplateGanttEditor: GanttStub,
          SelectFilter: SelectFilterStub,
        },
      },
    })

    const nextStep = await screen.findByRole('button', { name: '下一步：选择工序' })
    await waitFor(() => expect(loadBuildingsCalls).toBe(1))
    await waitFor(() => expect((nextStep as HTMLButtonElement).disabled).toBe(false))

    await fireEvent.click(screen.getByRole('radio', { name: /内部暂估/ }))
    await waitFor(() => expect(loadBuildingsCalls).toBe(2))
    expect((nextStep as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(nextStep)
    expect(screen.queryByRole('heading', { name: '调整标准工序' })).toBeNull()

    resolveProvisionalBuildings?.()
    await waitFor(() => expect((nextStep as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(nextStep)
    expect(screen.getByRole('heading', { name: '调整标准工序' })).not.toBeNull()
  })
})
