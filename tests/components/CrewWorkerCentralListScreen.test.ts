import type { CrewListPageDTO, WorkerListPageDTO } from '~/lib/crew-worker/repository'
import type { ReadState } from '~/types/read-model'
import { render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, shallowRef } from 'vue'
import CrewWorkerCentralListScreen from '~/components/crew-worker/CrewWorkerCentralListScreen.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { crewWorkerReadTestInstance } from '../../server/utils/crew-worker-read-test-instance'

const crewListState = shallowRef<ReadState<CrewListPageDTO>>({ kind: 'idle' })
const workerListState = shallowRef<ReadState<WorkerListPageDTO>>({ kind: 'idle' })
const loadCrewList = vi.fn()
const loadWorkerList = vi.fn()
const visibility = reactive({ includeDemo: true })
vi.mock('~/stores/crew-worker-read', () => ({ useCrewWorkerReadStore: () => ({
  get crewListState() { return crewListState.value },
  get workerListState() { return workerListState.value },
  loadCrewList,
  loadWorkerList,
}) }))
vi.mock('~/stores/crew-worker-command', () => ({ useCrewWorkerCommandStore: () => ({ latestWrite: null }) }))
const route = reactive({ path: '/base/crew', fullPath: '/base/crew', query: {} as Record<string, string> })
const replace = vi.fn()
const navigate = vi.fn()
const global = { components: {
  StatePanel,
  ListShell: defineComponent({ template: '<main><slot name="toolbar"/><slot name="table"/></main>' }),
  KitTable: defineComponent({ props: ['data', 'empty'], setup: props => () => h('section', [
    ...props.data.map((row: { name: string }) => h('span', row.name)),
    props.empty.actionLabel ? h('button', props.empty.actionLabel) : null,
  ]) }),
  NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
  SearchInput: defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], template: '<input aria-label="搜索" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>' }),
}, stubs: { KitMultiSelectFilter: true, SelectFilter: true, EntityLink: true } }

beforeEach(() => {
  setActivePinia(createPinia())
  route.query = {}
  route.fullPath = '/base/crew'
  crewListState.value = { kind: 'idle' }
  workerListState.value = { kind: 'idle' }
  visibility.includeDemo = true
  replace.mockReset().mockResolvedValue(undefined)
  loadCrewList.mockReset().mockImplementation(async (query) => {
    const data = await crewWorkerReadTestInstance.listCrews(query, 'crew-component-meta')
    crewListState.value = data.empty ? { kind: 'empty', data, empty: data.empty } : { kind: 'ready', data }
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useDataVisibilityStore', () => visibility)
  vi.stubGlobal('navigateTo', navigate)
})

describe('班组工人列表实际分页与读取状态', () => {
  it('合法越界回写实际末页，保留当前筛选、来源和大小', async () => {
    route.query = { page: '99', pageSize: '10', sort: 'name-asc', origin: 'real' }
    render(CrewWorkerCentralListScreen, { props: { kind: 'crew' }, global })
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ query: { pageSize: '10', sort: 'name-asc', origin: 'real' } }))
    expect(screen.getByRole('link', { name: '新增班组' })).toBeTruthy()
  })

  it('旧查询的迟到结果不回写覆盖已经变化的来源', async () => {
    let finish!: () => void
    loadCrewList.mockImplementationOnce(async () => new Promise<void>((resolve) => {
      finish = resolve
    }))
    route.query = { page: '99' }
    render(CrewWorkerCentralListScreen, { props: { kind: 'crew' }, global })
    await waitFor(() => expect(loadCrewList).toHaveBeenCalledTimes(1))
    visibility.includeDemo = false
    await waitFor(() => expect(loadCrewList).toHaveBeenCalledTimes(2))
    const data = await crewWorkerReadTestInstance.listCrews({ includeDemo: true, page: 99 }, 'crew-component-meta')
    crewListState.value = data.empty ? { kind: 'empty', data, empty: data.empty } : { kind: 'ready', data }
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
  })

  it('401撤回旧事实和新建入口，显示重新登录而不伪装空集合', async () => {
    const data = await crewWorkerReadTestInstance.listCrews({ includeDemo: true }, 'crew-component-meta')
    crewListState.value = { kind: 'ready', data }
    loadCrewList.mockResolvedValue(undefined)
    render(CrewWorkerCentralListScreen, { props: { kind: 'crew' }, global })
    expect(screen.getByRole('link', { name: '新增班组' })).toBeTruthy()
    crewListState.value = { kind: 'forbidden', problem: { code: 'unauthenticated', message: '登录失效', retryable: false, fieldErrors: {}, traceId: null } }
    await waitFor(() => expect(screen.getByRole('heading', { name: '登录已失效，请重新登录' })).toBeTruthy())
    expect(screen.queryByRole('link', { name: '新增班组' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新建班组' })).toBeNull()
  })
})
