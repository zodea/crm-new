import type { ScheduleProcessLibraryDetail } from '~/lib/schedule/process-library'
import { render, screen, waitFor } from '@testing-library/vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  ref,
  shallowRef,
} from 'vue'
import ScheduleProcessLibraryFormPage from '~/pages/schedule/process-library/_components/ScheduleProcessLibraryFormPage.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', async importOriginal => ({ ...await importOriginal<typeof import('vue-router')>(), onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))

const NuxtLinkStub = defineComponent({
  setup(_, { slots }) {
    return () => h('a', { href: '#' }, slots.default?.())
  },
})

const EditorStub = defineComponent({
  setup() {
    return () => h('div')
  },
})

const InactiveScreen = defineComponent({
  setup() {
    return () => h('div', '标准工序库列表')
  },
})

const sourceDetail: ScheduleProcessLibraryDetail = {
  id: 'library-1',
  code: 'interior-decoration',
  name: '精装修标准工序',
  version: 1,
  description: '来源版本',
  isDefault: true,
  usageCount: 1,
  tasks: [{
    id: 'task-1',
    libraryId: 'library-1',
    key: 'setting-out',
    name: '放线',
    durationDays: 3,
    trade: '泥水工',
    color: '#64748b',
    stageCode: null,
    itemCodes: [],
    predecessorKey: null,
    predecessorDisabled: false,
    sortOrder: 10,
  }],
}

describe('标准工序库表单页签复用', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('停用期间 source 变化后，重新激活会按当前 query 初始化并支持重置为空白', async () => {
    setActivePinia(createPinia())
    const loadDetail = vi.fn(async () => sourceDetail)
    const useTestStore = defineStore('schedule-process-library-form-reuse', () => ({
      detail: shallowRef<ScheduleProcessLibraryDetail | null>(null),
      loading: shallowRef(false),
      saving: shallowRef(false),
      error: shallowRef(''),
      origin: shallowRef('real'),
      canWrite: shallowRef(true),
      readVersion: shallowRef(null),
      loadLibraries: vi.fn(async () => undefined),
      loadDetail,
      saveVersion: vi.fn(),
    }))
    const route: { query: { source?: string } } = { query: {} }
    const active = ref(true)

    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useScheduleProcessLibraryStore', () => useTestStore())
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }))

    const Host = defineComponent({
      setup() {
        return () => h(KeepAlive, null, {
          default: () => active.value
            ? h(ScheduleProcessLibraryFormPage)
            : h(InactiveScreen),
        })
      },
    })

    render(Host, {
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          ScheduleProcessLibraryTaskEditor: EditorStub,
          ScheduleTemplateGanttEditor: EditorStub,
        },
      },
    })

    expect(await screen.findByRole('heading', { name: '新建标准工序库' })).not.toBeNull()

    active.value = false
    await nextTick()
    route.query.source = 'library-1'
    await nextTick()
    active.value = true
    await nextTick()

    await waitFor(() => expect(loadDetail).toHaveBeenCalledWith('library-1'))
    expect(await screen.findByRole('heading', { name: '基于旧版新建版本' })).not.toBeNull()
    expect((screen.getByLabelText('工序库编码 *') as HTMLInputElement).value)
      .toBe('interior-decoration')

    active.value = false
    await nextTick()
    delete route.query.source
    await nextTick()
    active.value = true
    await nextTick()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '新建标准工序库' })).not.toBeNull(),
    )
    expect((await screen.findByLabelText('工序库编码 *') as HTMLInputElement).value).toBe('')
  })
})
