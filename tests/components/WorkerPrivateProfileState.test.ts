import type { WorkerPrivateProfile } from '~/lib/worker-roster/contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, ref, shallowRef } from 'vue'
import { useWorkerPrivateProfile } from '~/composables/useWorkerPrivateProfile'
import { rosterProblem } from '~/lib/worker-roster/contract'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const profile = vi.fn()
const execute = vi.fn()
const resolve = vi.fn()
const acknowledge = vi.fn()
const pending = shallowRef<{ commandId: string } | null>(null)
vi.mock('~/stores/worker-roster', () => ({ useWorkerRosterStore: () => ({ repository: { profile }, execute, resolve, acknowledge, restore: vi.fn(), get pending() {
  return pending.value
} }) }))
const id = ref('one')
let ui: ReturnType<typeof useWorkerPrivateProfile>
const Harness = defineComponent({ setup() {
  ui = useWorkerPrivateProfile(() => id.value)
  return () => h('span', ui.current.value?.worker.idCard ?? '无私密资料')
} })
function read(workerId = 'one'): WorkerPrivateProfile {
  return { context: { workspaceId: 'work', actorId: 'actor', origin: 'real', capabilities: ['worker:write', 'worker:sensitive:read'] }, worker: { id: workerId, dataOrigin: 'real', name: workerId, crewId: null, currentProjectId: null, phone: '', idCard: `private-${workerId}`, trade: '', projectStatus: '', entryDate: null, exitDate: null, safetyEducation: false, status: 'draft', updatedAt: '' }, sourceVersion: `${workerId}-v1`, revision: 0, values: { laborContractSigned: null, laborContractSignedOn: null, portraitId: null, bankCardId: null }, assets: [], diagnostics: [] }
}
beforeEach(() => {
  vi.clearAllMocks()
  id.value = 'one'
  pending.value = null
  profile.mockImplementation(async (workerId: string) => read(workerId))
  execute.mockImplementation(async () => {
    rosterProblem('forbidden', '私密权限已撤回')
  })
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn(async () => true) }))
  vi.stubGlobal('useTabCloseGuard', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('换工人后的迟到读取不能显示另一人的实名字段', async () => {
  let reply!: (value: WorkerPrivateProfile) => void
  profile.mockImplementationOnce(() => new Promise<WorkerPrivateProfile>(resolve => reply = resolve))
  const wrapper = mount(Harness)
  id.value = 'two'
  await flushPromises()
  expect(wrapper.text()).toBe('private-two')
  reply(read('one'))
  await flushPromises()
  expect(wrapper.text()).toBe('private-two')
  wrapper.unmount()
})
it('保存时撤权立即隐藏已读私密资料，保留未保存稿不继续写', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.values.value.laborContractSigned = true
  await ui.save()
  expect(wrapper.text()).toBe('无私密资料')
  expect(ui.values.value.laborContractSigned).toBe(true)
  expect(ui.writable.value).toBe(false)
  expect(ui.error.value).toContain('撤回')
  wrapper.unmount()
})
it('停用页面时到达的保存结果不能恢复旧页面私密缓存', async () => {
  let finish!: () => void
  execute.mockImplementation(() => new Promise<void>(resolve => finish = resolve))
  const active = ref(true)
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, () => active.value ? h(Harness) : h('div', 'other')) }))
  await flushPromises()
  ui.values.value.laborContractSigned = false
  const saving = ui.save()
  active.value = false
  await flushPromises()
  finish()
  await saving
  await flushPromises()
  expect(ui.current.value).toBeNull()
  expect(acknowledge).not.toHaveBeenCalled()
  wrapper.unmount()
})
