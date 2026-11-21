import type { ProcessLibraryCatalog, ProcessLibraryCreateCommand, ProcessLibraryVersion } from '~/lib/schedule/process-library-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import { processLibraryProblem } from '~/lib/schedule/process-library-contract'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'
import ScheduleProcessLibraryFormPage from '~/pages/schedule/process-library/_components/ScheduleProcessLibraryFormPage.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', async importOriginal => ({ ...await importOriginal<typeof import('vue-router')>(), onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))

function version(id = 'old'): ProcessLibraryVersion {
  return { id, code: 'interior', name: '精装修', version: 1, description: '旧版', taskCount: 1, isDefault: false, usageCount: null, dataOrigin: 'real', sourceVersion: `source-${id}`, sourceVersionId: null, sortOrder: 0, createdAt: null, createdBy: null, updatedAt: null, deletedAt: null, migrationBatchId: null, legacyId: null, tasks: [{ id: 'task-a', libraryId: id, libraryVersion: 1, key: 'a', name: '放线', durationDays: 3, trade: '', color: '#64748b', itemCodes: [], sortOrder: 10, predecessorKey: null, predecessorDisabled: false, legacyId: null, createdAt: null, updatedAt: null, deletedAt: null }] }
}
function catalog(max = 3): ProcessLibraryCatalog {
  return { origin: 'real', workspaceId: 'workspace', actorId: 'actor', capabilities: ['process-library:read', 'process-library:write'], sourceVersion: `catalog-${max}`, seriesVersions: { interior: max }, libraries: [version(), { ...version('latest'), version: max }] }
}
const Link = defineComponent({ setup: (_, { slots }) => () => h('a', slots.default?.()) })
const Empty = defineComponent({ setup: () => () => h('div') })

function harness(returnTo?: string) {
  setActivePinia(createPinia())
  const route = reactive({ path: '/schedule/process-library/form', fullPath: '/schedule/process-library/form?source=old&origin=real', query: { source: 'old', origin: 'real', returnTo } })
  const repository = { list: vi.fn(async () => catalog()), detail: vi.fn(async (id: string) => version(id)), execute: vi.fn(async (command: ProcessLibraryCreateCommand) => ({ commandId: command.commandId, id: 'created', version: 4, sourceVersion: 'new' })) }
  const useStore = defineStore(`form-${Math.random()}`, () => createProcessLibraryState(repository, () => 'real'))
  const store = useStore()
  const confirm = vi.fn(async () => true)
  const push = vi.fn()
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push }))
  vi.stubGlobal('useScheduleProcessLibraryStore', () => store)
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), error: vi.fn() }))
  const active = ref(true)
  const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ScheduleProcessLibraryFormPage) : h(Empty) }) })
  render(Host, { global: { components: { NuxtLink: Link, ScheduleProcessLibraryTaskEditor: Empty, ScheduleTemplateGanttEditor: Empty } } })
  return { route, repository, store, confirm, push, active }
}

describe('工序库中央整页表单', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('冲突后保留人工稿，取消核对不保存，显式核对后再次保存才采用最新系列基准', async () => {
    const { repository, confirm } = harness()
    await screen.findByLabelText('工序库名称 *')
    await fireEvent.update(screen.getByLabelText('工序库名称 *'), '人工稿')
    repository.execute.mockRejectedValueOnce(processLibraryProblem('conflict', '同编码已更新'))
    await fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }))
    await waitFor(() => expect(repository.execute).toHaveBeenCalledTimes(1))
    const recheck = await screen.findByRole('button', { name: '重新核对当前版本系列' })
    expect((screen.getByLabelText('工序库名称 *') as HTMLInputElement).value).toBe('人工稿')
    confirm.mockResolvedValueOnce(false)
    await fireEvent.click(recheck)
    expect(repository.list).toHaveBeenCalledTimes(1)
    repository.list.mockResolvedValue(catalog(4))
    await fireEvent.click(recheck)
    await screen.findByText(/已核对同编码当前最高版本 v4/)
    expect((screen.getByLabelText('工序库名称 *') as HTMLInputElement).value).toBe('人工稿')
    expect(repository.execute).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }))
    await waitFor(() => expect(repository.execute).toHaveBeenCalledTimes(2))
    expect(repository.execute.mock.calls[1]![0]).toEqual(expect.objectContaining({ baseVersion: 4, sourceVersion: 'source-old', draft: expect.objectContaining({ name: '人工稿', sourceLibraryId: 'old' }) }))
  })

  it('来源读取失败不展示可写空白表单，提供重试', async () => {
    const { repository, route } = harness()
    await screen.findByLabelText('工序库名称 *')
    repository.detail.mockRejectedValueOnce(new Error('版本读取失败'))
    route.query.source = 'missing'
    await screen.findByRole('button', { name: '重试读取' })
    expect(screen.queryByRole('button', { name: '保存为新版本' })).toBeNull()
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('冲突核对确认迟到于停用及 source 切换时不会发读或覆盖新表单', async () => {
    const { repository, confirm, active, route } = harness()
    await screen.findByLabelText('工序库名称 *')
    repository.execute.mockRejectedValueOnce(processLibraryProblem('conflict', '同编码已更新'))
    await fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }))
    let approve!: (value: boolean) => void
    confirm.mockImplementationOnce(() => new Promise(resolve => approve = resolve))
    await fireEvent.click(await screen.findByRole('button', { name: '重新核对当前版本系列' }))
    active.value = false
    await nextTick()
    route.query.source = 'next'
    active.value = true
    await nextTick()
    await waitFor(() => expect(repository.detail).toHaveBeenCalledWith('next', 'real', expect.any(Object)))
    approve(true)
    await nextTick()
    expect(repository.list).toHaveBeenCalledTimes(2)
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })

  it('离开路由 query 先变化时不重置缓存人工稿，返回同一表单只重读权限', async () => {
    const { repository, route, active } = harness()
    await screen.findByLabelText('工序库名称 *')
    await fireEvent.update(screen.getByLabelText('工序库名称 *'), '离开前人工稿')
    route.path = '/schedule/process-library/old'
    route.query.source = ''
    await nextTick()
    active.value = false
    await nextTick()
    route.path = '/schedule/process-library/form'
    route.query.source = 'old'
    active.value = true
    await nextTick()
    const field = await screen.findByLabelText('工序库名称 *')
    expect((field as HTMLInputElement).value).toBe('离开前人工稿')
    expect(repository.detail).toHaveBeenCalledTimes(1)
  })

  it('取消离开保留人工稿，再确认离开才导航；正在保存不能重复提交', async () => {
    const { confirm, push, repository } = harness()
    await screen.findByLabelText('工序库名称 *')
    await fireEvent.update(screen.getByLabelText('工序库名称 *'), '人工稿')
    confirm.mockResolvedValueOnce(false)
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(push).not.toHaveBeenCalled()
    expect((screen.getByLabelText('工序库名称 *') as HTMLInputElement).value).toBe('人工稿')
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(push).toHaveBeenCalledWith({ path: '/schedule/process-library', query: { origin: 'real' } })
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('权限撤销后的重读保留人工稿并禁写，恢复权限再核对可继续', async () => {
    const { repository, active } = harness()
    await screen.findByLabelText('工序库名称 *')
    await fireEvent.update(screen.getByLabelText('工序库名称 *'), '权限变化前人工稿')
    repository.list.mockRejectedValueOnce(processLibraryProblem('forbidden', '权限已撤销'))
    active.value = false
    await nextTick()
    active.value = true
    await screen.findByText('权限已撤销')
    expect((screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('工序库名称 *') as HTMLInputElement).value).toBe('权限变化前人工稿')
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前版本系列' }))
    await screen.findByText(/已核对同编码当前最高版本 v3/)
    expect((screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['取消', '保存为新版本'])('%s 保留经过校验的建组返回入口', async (action) => {
    const returnTo = '/schedule/new?project=project-a&origin=real'
    const { push } = harness(returnTo)
    await screen.findByLabelText('工序库名称 *')
    await fireEvent.click(screen.getByRole('button', { name: action }))
    const path = action === '取消' ? '/schedule/process-library' : '/schedule/process-library/created'
    await waitFor(() => expect(push).toHaveBeenCalledWith({ path, query: { origin: 'real', returnTo } }))
  })
})
