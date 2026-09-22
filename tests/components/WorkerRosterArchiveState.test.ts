import type { WorkerRosterPreview } from '~/lib/worker-roster/contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, ref } from 'vue'
import { useWorkerRosterArchive } from '~/composables/useWorkerRosterArchive'
import { rosterProblem } from '~/lib/worker-roster/contract'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const preview = vi.fn()
const execute = vi.fn()
const acknowledge = vi.fn()
const archive = vi.fn()
vi.mock('~/stores/worker-roster', () => ({ useWorkerRosterStore: () => ({ repository: { preview, archives: vi.fn(async () => []), archive }, execute, acknowledge, restore: vi.fn(), pending: null }) }))
const route = reactive({ query: { project: 'one' } })
let ui: ReturnType<typeof useWorkerRosterArchive>
const Harness = defineComponent({ setup() {
  ui = useWorkerRosterArchive()
  return () => h('span', ui.preview.value?.projectName ?? '无名册')
} })
const context = { workspaceId: 'work', actorId: 'actor', origin: 'real' as const, capabilities: ['payroll:read', 'payroll:write', 'worker:sensitive:read'] }
function read(projectId = 'one'): WorkerRosterPreview {
  return { context, scope: { projectId, statementIds: ['statement'], registeredOn: '2026-09-22' }, projectName: `private-${projectId}`, sourceVersion: 'v1', members: [], diagnostics: [], counts: { present: 0, left: 0, notEntered: 0, unknown: 0 } }
}
beforeEach(() => {
  vi.clearAllMocks()
  route.query.project = 'one'
  preview.mockImplementation(async (scope: { projectId: string }) => read(scope.projectId))
  execute.mockImplementation(async () => {
    rosterProblem('forbidden', '私密权限已撤回')
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: { list: vi.fn(async () => ({ context, rows: [] })) } } }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn(async () => true) }))
  vi.stubGlobal('useTabCloseGuard', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('切换项目后的迟到预览不能显示前一个项目的私密名册', async () => {
  let reply!: (value: WorkerRosterPreview) => void
  preview.mockImplementationOnce(() => new Promise<WorkerRosterPreview>(resolve => reply = resolve))
  const wrapper = mount(Harness)
  await flushPromises()
  const building = ui.buildPreview()
  route.query.project = 'two'
  await flushPromises()
  reply(read())
  await building
  expect(wrapper.text()).toBe('无名册')
  expect(ui.busy.value).toBe(false)
  wrapper.unmount()
})
it('归档时撤权立即隐藏已读名册及版本', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  await ui.buildPreview()
  await ui.save()
  expect(wrapper.text()).toBe('无名册')
  expect(ui.list.value).toBeNull()
  expect(ui.versions.value).toEqual([])
  expect(ui.error.value).toContain('撤回')
  wrapper.unmount()
})
it('停用页面时到达的归档回执不能恢复私密缓存或确认完成', async () => {
  let finish!: (result: { archiveId: string }) => void
  execute.mockImplementation(() => new Promise(resolve => finish = resolve))
  const active = ref(true)
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, () => active.value ? h(Harness) : h('div', 'other')) }))
  await flushPromises()
  await ui.buildPreview()
  const saving = ui.save()
  active.value = false
  await flushPromises()
  finish({ archiveId: 'saved' })
  await saving
  expect(ui.opened.value).toBeNull()
  expect(archive).not.toHaveBeenCalled()
  expect(acknowledge).not.toHaveBeenCalled()
  wrapper.unmount()
})
