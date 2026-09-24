import type { PayrollC2FormInput, PayrollC2FormRead } from '~/lib/payroll/central-c2-contract'
import { fireEvent, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import PayrollC2FormFields from '~/components/payroll/PayrollC2FormFields.vue'
import { usePayrollC2Form } from '~/composables/usePayrollC2Form'
import { c2Form } from '../helpers/payroll-c2-ui'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ params: {} as Record<string, string>, path: '/subcontract/payroll/new', fullPath: '/subcontract/payroll/new?origin=real&format=C2&draftKey=a', query: { origin: 'real', format: 'C2', draftKey: 'a' } as Record<string, string> })
const load = vi.fn()
const save = vi.fn()
const push = vi.fn()
const values: ReturnType<typeof usePayrollC2Form>[] = []
function form(input: PayrollC2FormInput): PayrollC2FormRead {
  const read = c2Form()
  return { ...read, statementId: input.statementId, draftKey: input.draftKey ?? null, status: 'new', draft: { ...read.draft, ...input.draft }, eligibility: { ...read.eligibility, canSaveDraft: true } }
}
const Harness = defineComponent({ setup() {
  const ui = usePayrollC2Form()
  values.push(ui)
  return () => h('div', [h('input', { value: ui.draft.value.note, onInput: (event: Event) => ui.change({ note: (event.target as HTMLInputElement).value }) }), h('button', { disabled: !ui.canSave.value, onClick: ui.save }, '保存')])
} })
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  values.length = 0
  route.params = {}
  route.path = '/subcontract/payroll/new'
  route.query = { origin: 'real', format: 'C2', draftKey: 'a' }
  route.fullPath = `${route.path}?origin=real&format=C2&draftKey=a`
  load.mockImplementation(async (_query, input: PayrollC2FormInput) => form(input))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
  vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Form: load, saveC2Draft: save, getC2Pending: () => null }))
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(false), success: vi.fn() }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => { } }))
  vi.stubGlobal('useEventListener', vi.fn())
})
describe('c2 页面固定草稿', () => {
  it('draftKey 切换读取失败，旧稿不能保存到新目标；返回旧key仍保原稿', async () => {
    const view = mount(Harness)
    await flushPromises()
    await view.get('input').setValue('A 的原稿')
    load.mockRejectedValueOnce(new Error('B 不可读取'))
    route.query = { origin: 'real', format: 'C2', draftKey: 'b' }
    route.fullPath = `${route.path}?origin=real&format=C2&draftKey=b`
    await flushPromises()
    expect(values[0]!.matchingRead.value).toBeNull()
    expect(values[0]!.canSave.value).toBe(false)
    await values[0]!.save()
    expect(save).not.toHaveBeenCalled()
    route.query = { origin: 'real', format: 'C2', draftKey: 'a' }
    route.fullPath = `${route.path}?origin=real&format=C2&draftKey=a`
    await flushPromises()
    expect(values[0]!.draft.value.note).toBe('A 的原稿')
    view.unmount()
  })
  it('选负责人显式采用其真实班组，另一组成员不混入工资主体', async () => {
    vi.useFakeTimers()
    const read = c2Form()
    const other = { ...read.members[0]!, id: 'other', crewId: 'crew-other', name: '另一组负责人' }
    const view = mount(PayrollC2FormFields, { props: { draft: { projectId: 'p', crewId: null, leaderWorkerId: '', memberWorkerIds: ['w'], month: '2026-08', note: '' }, options: { ...read.options, workers: [...read.members, other] }, disabled: false, fieldErrors: {} }, global: { stubs: { SectionHeader: true } } })
    await view.get('[aria-label="请款负责人"]').trigger('focus')
    await view.get('[aria-label="请款负责人"]').setValue('另一组')
    await vi.advanceTimersByTimeAsync(310)
    await fireEvent.click(screen.getByRole('option', { name: '另一组负责人' }))
    expect(view.emitted().patch?.[0]?.[0]).toEqual({ leaderWorkerId: 'other', crewId: 'crew-other', memberWorkerIds: ['other'] })
    expect(view.text()).not.toContain('全部班组 / 未关联班组')
    view.unmount()
    vi.useRealTimers()
  })
})
