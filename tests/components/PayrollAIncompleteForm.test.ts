import type { ProjectHttpFetchOptions } from '~/lib/project/http-repository'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import PayrollAFormFields from '~/components/payroll/PayrollAFormFields.vue'
import { usePayrollAForm } from '~/composables/usePayrollAForm'
import { encodePayrollAWire, parsePayrollAFormInput } from '~/lib/payroll/central-a-codec'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { usePayrollAStore } from '~/stores/payroll-a'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())

it('真实不完整费用与空鼓诊断可补选原稿范围，未证核算始终不能保存', async () => {
  const f = await createPayrollHollowFixture()
  let wrapper: ReturnType<typeof mount> | undefined
  try {
    sessionStorage.clear()
    setActivePinia(createPinia())
    const fetcher = vi.fn(async (path: string, options?: ProjectHttpFetchOptions) => {
      if (path !== '/api/read/payroll/a-form')
        throw new Error(`此场景不应写入：${path}`)
      return encodePayrollAWire(await f.service.aForm({ origin: 'real' }, parsePayrollAFormInput(options?.body?.input)))
    })
    const repository = createPayrollRepository(fetcher)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository } }))
    const store = usePayrollAStore()
    const save = vi.spyOn(store, 'saveADraft')
    vi.stubGlobal('usePayrollStore', () => store)
    const query = { origin: 'real', project: f.draft.projectId, month: f.draft.month, draftKey: 'incomplete-original' }
    const route = reactive({ params: {}, query, path: '/subcontract/payroll/new', fullPath: `/subcontract/payroll/new?${new URLSearchParams(query)}` })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }))
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
    vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(), success: vi.fn() }))
    vi.stubGlobal('useEventListener', vi.fn())
    let ui!: ReturnType<typeof usePayrollAForm>
    const harness = defineComponent({ setup() {
      ui = usePayrollAForm()
      return () => ui.matchingRead.value
        ? h(PayrollAFormFields, { draft: ui.draft.value, options: ui.matchingRead.value.options, ratioDefault: ui.matchingRead.value.ratioDefault, disabled: !ui.editable.value, fieldErrors: ui.fieldErrors.value, onPatch: async (patch) => {
            ui.change(patch)
            await ui.load(true)
          } })
        : h('p', ui.error.value)
    } })
    wrapper = mount(harness, { global: { stubs: { SectionHeader: true } } })
    await flushPromises()
    await expect.poll(() => ui.loading.value).toBe(false)
    const initial = ui.matchingRead.value!
    expect(hasPayrollAFeesForm(initial) && initial.bookProof.state).toBe('unproven')
    expect(initial.hollow).toMatchObject({ state: 'unavailable', scope: null, eligibility: { canStart: false } })
    const leader = wrapper.get('select[aria-label="请款负责人"]')
    expect(leader.attributes('disabled')).toBeUndefined()
    expect(ui.canSave.value).toBe(false)
    await ui.save()
    expect(save).not.toHaveBeenCalled()
    await leader.setValue(f.draft.leaderWorkerId)
    await flushPromises()
    await expect.poll(() => ui.loading.value).toBe(false)
    ui.change({ payRatio: f.draft.payRatio })
    await ui.load(true)
    expect(ui.canSave.value).toBe(false)
    expect(ui.matchingRead.value!.draft.ratioPlan?.itemRatios).toEqual([{ itemId: f.target.itemId, ratio: null }])
    ui.change({ ratioPlan: f.draft.ratioPlan })
    await ui.load(true)
    expect(ui.canSave.value).toBe(true)
    expect(ui.matchingRead.value!.totals.grossAmount.value).toBe(1000)
    await wrapper.get('input[aria-label="工资月份"]').setValue('')
    await flushPromises()
    await expect.poll(() => ui.loading.value).toBe(false)
    expect(wrapper.get('input[aria-label="工资月份"]').attributes('disabled')).toBeUndefined()
    expect(ui.canSave.value).toBe(false)
    await ui.save()
    expect(save).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="工资月份"]').setValue(f.draft.month)
    await flushPromises()
    await expect.poll(() => ui.loading.value).toBe(false)
    f.setSession({ ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'payroll:write') })
    await ui.load(true)
    expect(wrapper.get('select[aria-label="请款负责人"]').attributes('disabled')).toBeDefined()
    expect(ui.canSave.value).toBe(false)
    await ui.save()
    expect(save).not.toHaveBeenCalled()
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)
