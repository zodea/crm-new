import type { QuantityHollowCommand } from '~/lib/quantity/central-hollow-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import QuantityHollowFormPage from '~/components/quantity/QuantityHollowFormPage.vue'
import { hollowIdentity, hollowRead, hollowRecord, hollowResult, hollowTarget } from '../helpers/quantity-hollow-ui-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
const repository = { hollow: vi.fn(), execute: vi.fn() }
const context = vi.fn()
const push = vi.fn()
const confirm = vi.fn()
const success = vi.fn()
let route: { path: string, fullPath: string, query: Record<string, string> }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  route = reactive({ path: '/subcontract/quantity/project/unit/hollow/new', fullPath: '/subcontract/quantity/project/unit/hollow/new?origin=real&draftKey=draft', query: { origin: 'real', draftKey: 'draft' } })
  context.mockResolvedValue(structuredClone(hollowIdentity))
  repository.hollow.mockImplementation(async () => hollowRead())
  repository.execute.mockImplementation(async command => hollowResult(command))
  confirm.mockResolvedValue(true)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { quantity: repository, projectCommands: { context } } }))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success }))
  vi.stubGlobal('useTabTitle', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
const global = { stubs: { PayrollASourceReturn: true, QuantityHollowCommandRecovery: true } }
const page = () => mount(QuantityHollowFormPage, { props: { projectId: 'project', unitId: 'unit' }, attachTo: document.body, global })
type Page = ReturnType<typeof page>
const button = (wrapper: Page, label: string) => wrapper.findAll('button').find(button => button.text() === label)!
async function fill(wrapper: Page, count = '19') {
  await wrapper.get('select[aria-label="空鼓检查范围"]').setValue(JSON.stringify(hollowTarget))
  await wrapper.get('input[aria-label="检查日期"]').setValue('2026-09-01')
  await wrapper.get('input[aria-label="检查发现总处数"]').setValue(count)
  await wrapper.get('textarea[aria-label="检查说明"]').setValue('冷返回仍保留的原检查说明')
}

it('未知保存完整字段冷恢复，核对原提交后才进入真实记录详情', async () => {
  let wrapper = page()
  await flushPromises()
  await fill(wrapper, '0')
  repository.execute.mockRejectedValueOnce(new Error('回复丢失'))
  await button(wrapper, '保存空鼓检查').trigger('click')
  await flushPromises()
  const original = structuredClone(repository.execute.mock.calls[0]![0]) as QuantityHollowCommand
  expect(original.action).toMatchObject({ input: { count: 0, note: '冷返回仍保留的原检查说明' } })
  expect(wrapper.get('[aria-label="空鼓提交核对"]').text()).toContain('回复丢失')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('空鼓提交核对')
  expect(push).not.toHaveBeenCalled()
  wrapper.unmount()
  setActivePinia(createPinia())
  wrapper = page()
  await flushPromises()
  expect((wrapper.get('input[aria-label="检查发现总处数"]').element as HTMLInputElement).value).toBe('0')
  expect((wrapper.get('textarea[aria-label="检查说明"]').element as HTMLTextAreaElement).value).toBe('冷返回仍保留的原检查说明')
  expect(button(wrapper, '取消').attributes('disabled')).toBeDefined()
  repository.hollow.mockResolvedValueOnce(hollowRead([hollowRecord(original)], 'quantity-v2'))
  await button(wrapper, '核对原提交').trigger('click')
  await flushPromises()
  expect(repository.execute.mock.calls[1]![0]).toEqual(original)
  expect(success).toHaveBeenCalledWith('空鼓检查已保存并核对。')
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/subcontract/quantity/project/unit/hollow/record' }))
  wrapper.unmount()
})

it('普通脏稿冷返回不自动采用后来来源，取消确认不丢字段', async () => {
  let wrapper = page()
  await flushPromises()
  await fill(wrapper)
  confirm.mockResolvedValueOnce(false)
  await button(wrapper, '取消').trigger('click')
  await flushPromises()
  expect(push).not.toHaveBeenCalled()
  wrapper.unmount()
  setActivePinia(createPinia())
  repository.hollow.mockResolvedValueOnce(hollowRead([], 'quantity-v2'))
  wrapper = page()
  await flushPromises()
  expect((wrapper.get('textarea[aria-label="检查说明"]').element as HTMLTextAreaElement).value).toBe('冷返回仍保留的原检查说明')
  expect(wrapper.text()).toContain('来源或整改记录已经变化')
  expect(button(wrapper, '保存空鼓检查').attributes('disabled')).toBeDefined()
  await button(wrapper, '采用本次原户依据').trigger('click')
  expect(button(wrapper, '保存空鼓检查').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('没有当前写权限不显示其他身份脏稿也不开放保存', async () => {
  const wrapper = page()
  await flushPromises()
  await fill(wrapper)
  wrapper.unmount()
  setActivePinia(createPinia())
  const read = hollowRead()
  read.context = { ...read.context, actorId: 'other-actor', capabilities: ['quantity:read'] }
  read.capabilities = ['quantity:read']
  read.data.targets[0]!.create = { allowed: false, reasons: ['当前仅可读取'] }
  context.mockResolvedValue(read.context)
  repository.hollow.mockResolvedValue(read)
  const other = page()
  await flushPromises()
  expect((other.get('textarea[aria-label="检查说明"]').element as HTMLTextAreaElement).value).toBe('')
  expect(other.get('textarea[aria-label="检查说明"]').attributes('disabled')).toBeDefined()
  expect(button(other, '保存空鼓检查').attributes('disabled')).toBeDefined()
  expect(repository.execute).not.toHaveBeenCalled()
  other.unmount()
})

it('同户另一动作冷打开只核对原提交，不把检查字段套进修订表单', async () => {
  const wrapper = page()
  await flushPromises()
  await fill(wrapper, '0')
  repository.execute.mockRejectedValueOnce(new Error('回复丢失'))
  await button(wrapper, '保存空鼓检查').trigger('click')
  await flushPromises()
  const original = structuredClone(repository.execute.mock.calls[0]![0]) as QuantityHollowCommand
  wrapper.unmount()
  setActivePinia(createPinia())
  repository.hollow.mockResolvedValue(hollowRead([hollowRecord(original)]))
  route.path = '/subcontract/quantity/project/unit/hollow/form/record'
  const other = mount(QuantityHollowFormPage, { props: { projectId: 'project', unitId: 'unit', recordId: 'record' }, global })
  await flushPromises()
  expect(other.get('[aria-label="原空鼓提交内容"]').text()).toContain('记录空鼓检查')
  expect(other.get('[aria-label="原空鼓提交内容"]').text()).toContain('0 处')
  expect(other.get('[aria-label="原空鼓提交内容"]').text()).toContain('冷返回仍保留的原检查说明')
  expect(other.find('input[aria-label="检查发现总处数"]').exists()).toBe(false)
  repository.hollow.mockResolvedValue(hollowRead([hollowRecord(original)], 'quantity-v2'))
  await button(other, '核对原提交').trigger('click')
  await flushPromises()
  expect(repository.execute.mock.calls[1]![0]).toEqual(original)
  expect(success).toHaveBeenCalledWith('空鼓检查已保存并核对。')
  other.unmount()
})
