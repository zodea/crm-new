import type { ProcessLibraryCatalog, ProcessLibraryCreateCommand, ProcessLibraryVersion } from '~/lib/schedule/process-library-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, shallowRef } from 'vue'
import ScheduleProcessLibraryDetail from '~/components/schedule/ScheduleProcessLibraryDetail.vue'
import ScheduleProcessLibraryScreen from '~/components/schedule/ScheduleProcessLibraryScreen.vue'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'

function version(id = 'old'): ProcessLibraryVersion {
  return { id, code: 'interior', name: '精装修', version: 1, description: '旧版说明', taskCount: 1, isDefault: false, usageCount: null, dataOrigin: 'real', sourceVersion: `source-${id}`, sourceVersionId: null, sortOrder: 0, createdAt: null, createdBy: null, updatedAt: null, deletedAt: null, migrationBatchId: null, legacyId: null, tasks: [{ id: 'task-a', libraryId: id, libraryVersion: 1, key: 'a', name: `放线-${id}`, durationDays: 3, trade: '泥水工', color: '#64748b', stageCode: 'stage-1', itemCodes: ['wall'], sortOrder: 10, predecessorKey: null, predecessorDisabled: false, legacyId: null, createdAt: null, updatedAt: null, deletedAt: null }] }
}
const Link = defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : `${props.to.path}?${new URLSearchParams(props.to.query)}` }, slots.default?.()) })
const Table = defineComponent({
  props: ['columns', 'data'],
  setup: (props, { slots }) => () => h('div', { 'data-testid': 'library-table' }, props.data.map((row: Record<string, unknown>, rowIndex: number) => h('div', props.columns.map((column: { field?: string, slot?: string }) => h('div', column.slot ? slots[column.slot]?.({ row, rowIndex }) : String(row[column.field ?? ''] ?? '')))))),
})

function harness(component: typeof ScheduleProcessLibraryScreen | typeof ScheduleProcessLibraryDetail, selectedOrigin: 'real' | 'demo' = 'real') {
  setActivePinia(createPinia())
  const origin = shallowRef(selectedOrigin)
  const route = reactive({ params: { id: 'old' }, query: { origin: selectedOrigin } })
  const catalog: ProcessLibraryCatalog = { origin: selectedOrigin, workspaceId: 'workspace', actorId: 'actor', capabilities: ['process-library:read', 'process-library:write'], sourceVersion: 'catalog-1', seriesVersions: { interior: 1 }, libraries: [{ ...version(), dataOrigin: selectedOrigin }] }
  const repository = { list: vi.fn(async () => catalog), detail: vi.fn(async (id: string) => ({ ...version(id), dataOrigin: selectedOrigin })), execute: vi.fn(async (command: ProcessLibraryCreateCommand) => ({ commandId: command.commandId, id: 'created', version: 2, sourceVersion: 'new' })) }
  const useStore = defineStore(`read-pages-${Math.random()}`, () => createProcessLibraryState(repository, () => origin.value))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useScheduleProcessLibraryStore', () => useStore())
  const active = shallowRef(true)
  const Other = defineComponent({ setup: () => () => h('div', '其他页签') })
  const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(component) : h(Other) }) })
  render(Host, { global: { components: { NuxtLink: Link }, stubs: { KitTable: Table } } })
  return { repository, route, origin, active, store: useStore() }
}

describe('工序库中央只读页面', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('详情往返后同源刷新保留原表格、链接焦点与横滚值，网络失败给重试并保持只读', async () => {
    const { repository, active, store } = harness(ScheduleProcessLibraryScreen)
    await screen.findByRole('link', { name: '查看版本' })
    const table = screen.getByTestId('library-table')
    const link = screen.getByRole('link', { name: '查看版本' })
    table.scrollLeft = 180
    active.value = false
    await nextTick()
    await store.loadDetail('old')
    let fail!: (cause: Error) => void
    repository.list.mockImplementationOnce(() => new Promise((_resolve, reject) => fail = reject))
    active.value = true
    await nextTick()
    expect(screen.getByTestId('library-table')).toBe(table)
    expect(table.scrollLeft).toBe(180)
    link.focus()
    await screen.findByText('正在刷新工序库，暂时不能新建版本。')
    expect(document.activeElement).toBe(link)
    expect(screen.queryByRole('link', { name: '基于此版本新建' })).toBeNull()
    fail(new Error('网络暂不可用'))
    await screen.findByRole('button', { name: '重试刷新' })
    expect(screen.getByTestId('library-table')).toBe(table)
    expect(table.scrollLeft).toBe(180)
    expect(document.activeElement).toBe(link)
    expect(screen.queryByText('还没有标准工序库')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重试刷新' }))
    await screen.findByRole('link', { name: '基于此版本新建' })
    expect(screen.getByTestId('library-table')).toBe(table)
    expect(table.scrollLeft).toBe(180)
  })

  it('列表未知引用不会伪装成零；详情和复制链接保留版本与来源', async () => {
    harness(ScheduleProcessLibraryScreen)
    await screen.findByText('当前身份无法读取引用情况')
    expect(screen.queryByText(/尚未引用/)).toBeNull()
    expect(screen.getByRole('link', { name: '查看版本' }).getAttribute('href')).toBe('/schedule/process-library/old?origin=real')
    expect(screen.getByRole('link', { name: '基于此版本新建' }).getAttribute('href')).toBe('/schedule/process-library/form?origin=real&source=old')
  })

  it('演示列表可看版本但不提供新建或复制入口', async () => {
    const { repository } = harness(ScheduleProcessLibraryScreen, 'demo')
    await screen.findByText('演示来源只读，可查看各版本及工序。')
    expect(screen.getByRole('link', { name: '查看版本' }).getAttribute('href')).toContain('origin=demo')
    expect(screen.queryByRole('link', { name: '基于此版本新建' })).toBeNull()
    expect(screen.queryByRole('link', { name: '新建空白工序库' })).toBeNull()
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('独立详情展示不可变任务、映射和未知引用，没有可编辑字段', async () => {
    const { repository } = harness(ScheduleProcessLibraryDetail)
    await screen.findByRole('heading', { name: '精装修 · v1' })
    expect(screen.getByText('放线-old')).not.toBeNull()
    expect(screen.getByText('stage-1')).not.toBeNull()
    expect(screen.getByText('wall')).not.toBeNull()
    expect(screen.getByRole('region', { name: '工序明细，可横向滚动' }).getAttribute('tabindex')).toBe('0')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('详情切换时旧响应迟到也不会显示旧版任务', async () => {
    const { repository, route } = harness(ScheduleProcessLibraryDetail)
    await screen.findByText('放线-old')
    let finish!: (value: ProcessLibraryVersion) => void
    repository.detail.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    route.params.id = 'slow'
    await waitFor(() => expect(repository.detail).toHaveBeenCalledWith('slow', 'real', expect.any(Object)))
    route.params.id = 'next'
    await screen.findByText('放线-next')
    finish(version('slow'))
    await waitFor(() => expect(screen.queryByText('放线-slow')).toBeNull())
  })

  it('中央引用项目链接使用已核验的来源，未知引用不显示项目投影', async () => {
    const { repository, route } = harness(ScheduleProcessLibraryDetail)
    await screen.findByText('放线-old')
    const usageProjects = [{ id: 'project-1', name: '中央引用项目', groupCount: 2 }]
    repository.detail.mockResolvedValueOnce({ ...version('used'), usageCount: 2, usageProjects })
    route.params.id = 'used'
    const link = await screen.findByRole('link', { name: '中央引用项目' })
    expect(link.getAttribute('href')).toBe('/schedule?project=project-1&origin=real')
    expect(screen.getByText('2 个楼栋分组')).not.toBeNull()
    repository.detail.mockResolvedValueOnce({ ...version('unknown'), usageCount: null, usageProjects })
    route.params.id = 'unknown'
    await screen.findByText('放线-unknown')
    expect(screen.queryByRole('link', { name: '中央引用项目' })).toBeNull()
    expect(screen.getByText('当前身份无法读取引用情况')).not.toBeNull()
  })

  it('中央详情未附带引用项目投影时仍可正常展示版本与引用数', async () => {
    const detail = { id: 'old', code: 'legacy', name: '历史工序库', version: 1, dataOrigin: 'real', description: '', isDefault: false, taskCount: 0, usageCount: 2, tasks: [] }
    vi.stubGlobal('useRoute', () => ({ params: { id: 'old' }, query: { origin: 'real' } }))
    vi.stubGlobal('useScheduleProcessLibraryStore', () => ({ origin: 'real', canWrite: true, loadDetail: vi.fn().mockResolvedValue(detail) }))
    render(ScheduleProcessLibraryDetail, { global: { components: { NuxtLink: Link }, stubs: { KitTable: Table } } })
    await screen.findByRole('heading', { name: '历史工序库 · v1' })
    expect(screen.getByText('已被 2 个排程引用')).not.toBeNull()
    expect(screen.queryByRole('region', { name: '引用项目' })).toBeNull()
  })
})
