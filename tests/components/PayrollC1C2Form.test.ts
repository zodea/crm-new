import type { PayrollC1FormInput, PayrollC1FormRead } from '~/lib/payroll/central-c1-contract'
import type { PayrollC2FormInput, PayrollC2FormRead } from '~/lib/payroll/central-c2-contract'
import { fireEvent, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import PayrollC1FormFields from '~/components/payroll/PayrollC1FormFields.vue'
import PayrollC2FormFields from '~/components/payroll/PayrollC2FormFields.vue'
import { usePayrollC1Form } from '~/composables/usePayrollC1Form'
import { usePayrollC2Form } from '~/composables/usePayrollC2Form'
import { c1Form } from '../helpers/payroll-c1-ui'
import { c2Form } from '../helpers/payroll-c2-ui'

type FormInput = PayrollC1FormInput | PayrollC2FormInput
type FormRead = PayrollC1FormRead | PayrollC2FormRead
type FormUi = ReturnType<typeof usePayrollC1Form> | ReturnType<typeof usePayrollC2Form>

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ params: {} as Record<string, string>, path: '/subcontract/payroll/new', fullPath: '', query: {} as Record<string, string> })
const load = vi.fn()
const save = vi.fn()
const push = vi.fn()
const values: FormUi[] = []

describe.each([
  { format: 'C1', source: '考勤', formula: '按本月考勤与每人正常、加班标准核算', useForm: usePayrollC1Form as () => FormUi, Fields: PayrollC1FormFields, baseRead: c1Form as () => FormRead, store: ['usePayrollC1Store', { loadC1Form: load, saveC1Draft: save, getC1Pending: () => null }] },
  { format: 'C2', source: '签工', formula: '按本月已确认签工与本请款主体单价核算', useForm: usePayrollC2Form as () => FormUi, Fields: PayrollC2FormFields, baseRead: c2Form as () => FormRead, store: ['usePayrollC2Store', { loadC2Form: load, saveC2Draft: save, getC2Pending: () => null }] },
] as const)('$format 页面固定草稿', ({ format, source, formula, useForm, Fields, baseRead, store: [storeName, store] }) => {
  function at(draftKey: string) {
    route.query = { origin: 'real', format, draftKey }
    route.fullPath = `${route.path}?origin=real&format=${format}&draftKey=${draftKey}`
  }
  function form(input: FormInput): FormRead {
    const read = baseRead()
    return { ...read, statementId: input.statementId, draftKey: input.draftKey ?? null, status: 'new', draft: { ...read.draft, ...input.draft }, eligibility: { ...read.eligibility, canSaveDraft: true } } as FormRead
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
    at('a')
    load.mockImplementation(async (_query, input: FormInput) => form(input))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
    vi.stubGlobal(storeName, () => store)
    vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(false), success: vi.fn() }))
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => { } }))
    vi.stubGlobal('useEventListener', vi.fn())
  })
  it('draftKey 切换读取失败，旧稿不能保存到新目标；返回旧key仍保原稿', async () => {
    const view = mount(Harness)
    await flushPromises()
    await view.get('input').setValue('A 的原稿')
    load.mockRejectedValueOnce(new Error('B 不可读取'))
    at('b')
    await flushPromises()
    expect(values[0]!.matchingRead.value).toBeNull()
    expect(values[0]!.canSave.value).toBe(false)
    await values[0]!.save()
    expect(save).not.toHaveBeenCalled()
    at('a')
    await flushPromises()
    expect(values[0]!.draft.value.note).toBe('A 的原稿')
    view.unmount()
  })
  it('选负责人显式采用其真实班组，另一组成员不混入工资主体', async () => {
    vi.useFakeTimers()
    const read = baseRead()
    const other = { ...read.members[0]!, id: 'other', crewId: 'crew-other', name: '另一组负责人' }
    const view = mount(Fields, { props: { draft: { projectId: 'p', crewId: null, leaderWorkerId: '', memberWorkerIds: ['w'], month: '2026-08', note: '' }, options: { ...read.options, workers: [...read.members, other] }, disabled: false, fieldErrors: {} }, global: { stubs: { SectionHeader: true } } })
    expect(view.get('#section-basic').attributes('aria-label')).toBe(`${format}工资基本资料`)
    expect(view.text()).toContain(`${format} ${formula}`)
    expect(view.get('legend').text()).toBe(`全部请款成员（包含无${source}与零收款成员）`)
    expect(view.get('fieldset > div').classes().includes('lg:grid-cols-3')).toBe(format === 'C1')
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
