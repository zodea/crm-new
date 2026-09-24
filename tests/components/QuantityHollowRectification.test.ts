import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import QuantityHollowRectification from '~/components/quantity/QuantityHollowRectification.vue'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
const confirm = vi.fn()
const success = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  confirm.mockResolvedValue(true)
  vi.stubGlobal('useKitUI', () => ({ confirm, success }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function setup() {
  const f = await createQuantityHollowFixture()
  const initial = await f.service.hollow(f.scope)
  const created = await f.service.executeHollow(f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-01', count: 19, note: '原厨房墙砖检查' } }))
  let loseReply = false
  const sent: unknown[] = []
  const repository = createQuantityRepository(async (path, options) => {
    if (path === '/api/read/quantity/hollow')
      return f.service.hollow(f.scope)
    sent.push(structuredClone(options!.body))
    const result = await f.service.executeHollow(options!.body as Parameters<typeof f.service.executeHollow>[0])
    if (loseReply) {
      loseReply = false
      throw new Error('整改回复丢失')
    }
    return result
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { quantity: repository, projectCommands: { context: async () => f.session() } } }))
  const wrapper = mount(QuantityHollowRectification, { props: { query: f.scope, recordId: created.hollow.recordId }, attachTo: document.body })
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.find('input[aria-label="整改日期"]').exists()).toBe(true))
  async function fill(count: string) {
    await wrapper.get('input[aria-label="整改日期"]').setValue('2026-09-15')
    await wrapper.get('input[aria-label="本次整改处数"]').setValue(count)
    await wrapper.get('textarea[aria-label="整改说明"]').setValue('已经逐处复核，登记本次修复')
  }
  return { f, wrapper, fill, sent, loseNextReply: () => loseReply = true }
}

it('真实公开来源 19 处取消小确认保输入，确认整改 4 处后仍保原检查且余 15', async () => {
  const { f, wrapper, fill, sent } = await setup()
  try {
    await fill('4')
    confirm.mockResolvedValueOnce(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(sent).toHaveLength(0)
    expect((wrapper.get('input[aria-label="本次整改处数"]').element as HTMLInputElement).value).toBe('4')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('未整改 19 处，本次登记整改 4 处') }))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(success).toHaveBeenCalled())
    const read = await f.service.hollow(f.scope)
    expect(read.data.records[0]).toMatchObject({ inspection: { input: { count: 19, note: '原厨房墙砖检查' } }, rectifiedCount: 4, remainingCount: 15, rectifications: [{ count: 4 }] })
    expect(wrapper.text()).toContain('当前未整改 15 处')
    expect(success).toHaveBeenCalledWith('整改销记已保存并核对。')
    expect(wrapper.find('[aria-label="空鼓提交核对"]').exists()).toBe(false)
  }
  finally {
    wrapper.unmount()
    await f.close()
  }
})

it('真实整改已保存但回复丢失时聚焦原提交，原键重试只增加一条整改', async () => {
  const { f, wrapper, fill, sent, loseNextReply } = await setup()
  try {
    await fill('4')
    loseNextReply()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('空鼓提交核对'))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('空鼓提交核对')
    expect(wrapper.get('input[aria-label="本次整改处数"]').attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(success).toHaveBeenCalled())
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    const current = (await f.service.hollow(f.scope)).data.records[0]!
    expect(current.rectifications).toHaveLength(1)
    expect(current.remainingCount).toBe(15)
    expect(success).toHaveBeenCalledWith('整改销记已保存并核对。')
  }
  finally {
    wrapper.unmount()
    await f.close()
  }
})
