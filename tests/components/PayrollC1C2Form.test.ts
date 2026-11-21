import type { PayrollC1FormInput } from '~/lib/payroll/central-c1-contract'
import type { PayrollC2FormInput } from '~/lib/payroll/central-c2-contract'
import { fireEvent, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import PayrollC1FormFields from '~/components/payroll/PayrollC1FormFields.vue'
import PayrollC2FormFields from '~/components/payroll/PayrollC2FormFields.vue'
import { usePayrollC1Form } from '~/composables/usePayrollC1Form'
import { usePayrollC2Form } from '~/composables/usePayrollC2Form'
import { c1Form } from '../helpers/payroll-c1-ui'
import { c2Form } from '../helpers/payroll-c2-ui'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
describe.each([
  { family: 'C1', useForm: usePayrollC1Form, fixture: c1Form },
  { family: 'C2', useForm: usePayrollC2Form, fixture: c2Form },
] as const)('$family 页面固定草稿', ({ family, useForm, fixture }) => {
  const route = reactive({ params: {} as Record<string, string>, path: '/subcontract/payroll/new', fullPath: `/subcontract/payroll/new?origin=real&format=${family}&draftKey=a`, query: { origin: 'real', format: family, draftKey: 'a' } as Record<string, string> })
  const load = vi.fn()
  const save = vi.fn()
  const push = vi.fn()
  const values: ReturnType<typeof useForm>[] = []
  function form(input: PayrollC1FormInput | PayrollC2FormInput) {
    const read = fixture()
    return { ...read, statementId: input.statementId, draftKey: input.draftKey ?? null, status: 'new', draft: { ...read.draft, ...input.draft }, eligibility: { ...read.eligibility, canSaveDraft: true } }
  }
  const Harness = defineComponent({ setup() {
    const ui = useForm()
    values.push(ui)
    return () => h('div', [h('input', { value: ui.draft.value.note, onInput: (event: Event) => ui.change({ note: (event.target as HTMLInputElement).value }) }), h('button', { disabled: !ui.canSave.value, onClick: ui.save }, '保存')])
  } })
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    values.length = 0
    route.params = {}
    route.path = '/subcontract/payroll/new'
    route.query = { origin: 'real', format: family, draftKey: 'a' }
    route.fullPath = `${route.path}?origin=real&format=${family}&draftKey=a`
    load.mockImplementation(async (_query, input: PayrollC1FormInput | PayrollC2FormInput) => form(input))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
    vi.stubGlobal(`usePayroll${family}Store`, () => ({ [`load${family}Form`]: load, [`save${family}Draft`]: save, [`get${family}Pending`]: () => null }))
    vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(false), success: vi.fn() }))
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => { } }))
    vi.stubGlobal('useEventListener', vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('draftKey 切换读取失败，旧稿不能保存到新目标；返回旧key仍保原稿', async () => {
    const view = mount(Harness)
    await flushPromises()
    await view.get('input').setValue('A 的原稿')
    load.mockRejectedValueOnce(new Error('B 不可读取'))
    route.query = { origin: 'real', format: family, draftKey: 'b' }
    route.fullPath = `${route.path}?origin=real&format=${family}&draftKey=b`
    await flushPromises()
    expect(values[0]!.matchingRead.value).toBeNull()
    expect(values[0]!.canSave.value).toBe(false)
    await values[0]!.save()
    expect(save).not.toHaveBeenCalled()
    route.query = { origin: 'real', format: family, draftKey: 'a' }
    route.fullPath = `${route.path}?origin=real&format=${family}&draftKey=a`
    await flushPromises()
    expect(values[0]!.draft.value.note).toBe('A 的原稿')
    view.unmount()
  })
  it('选负责人显式采用其真实班组，另一组成员不混入工资主体', async () => {
    vi.useFakeTimers()
    const read = fixture()
    const other = { ...read.members[0]!, id: 'other', crewId: 'crew-other', name: '另一组负责人' }
    const props = {
      draft: { projectId: 'p', crewId: null, leaderWorkerId: '', memberWorkerIds: ['w'], month: '2026-08', note: '' },
      options: { ...read.options, workers: [...read.members, other] },
      disabled: false,
      fieldErrors: {},
    }
    const options = { props, global: { stubs: { SectionHeader: true } } }
    const view = family === 'C1' ? mount(PayrollC1FormFields, options) : mount(PayrollC2FormFields, options)
    await view.get('[aria-label="请款负责人"]').trigger('focus')
    await view.get('[aria-label="请款负责人"]').setValue('另一组')
    await vi.advanceTimersByTimeAsync(310)
    await fireEvent.click(screen.getByRole('option', { name: '另一组负责人' }))
    expect(view.emitted('patch')?.[0]).toEqual([{ leaderWorkerId: 'other', crewId: 'crew-other', memberWorkerIds: ['other'] }])
    expect(view.text()).not.toContain('全部班组 / 未关联班组')
    view.unmount()
  })
})
