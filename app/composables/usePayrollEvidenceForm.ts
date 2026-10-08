import type { PayrollAdjustmentCommand, PayrollAdjustmentCommandResult } from '~/lib/payroll/central-adjustment-contract'
import type { PayrollWritableContext } from '~/lib/payroll/central-contract'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollActualLocation, payrollAdjustmentLocation, payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

interface Pending { restoredFromDescriptor?: boolean, command: PayrollAdjustmentCommand, state: 'sending' | 'unknown' | 'awaiting-read' }
interface FormRead<D> { context: PayrollWritableContext, draft: D }

/** 三种独立事实共用保稿/原键/后读流程；每种领域仍由自己的封闭读取和命令判断资格。 */
export function usePayrollEvidenceForm<D, R extends FormRead<D>>(options: {
  target: (draftKey: string) => unknown
  load: (draftKey: string, draft?: D) => Promise<R>
  pending: (read: R) => Pending | null
  restoredDraft: (pending: Pending, read: R) => D
  canEdit: (read: R) => boolean
  canConfirm: (read: R) => boolean
  save?: (read: R, draft: D) => Promise<PayrollAdjustmentCommandResult>
  confirm: (read: R) => Promise<PayrollAdjustmentCommandResult>
  confirmation: (read: R) => { title: string, message: string }
}) {
  const route = useRoute()
  const router = useRouter()
  const tabs = useTabsStore()
  const kit = useKitUI()
  const store = usePayrollAdjustmentsStore()
  const formKey = deriveKey(route.fullPath)
  const generatedKey = generateId('payroll-evidence-draft')
  const draftKey = computed(() => typeof route.query.draftKey === 'string' ? route.query.draftKey : generatedKey)
  const origin = computed(() => route.query.origin == null || route.query.origin === 'real' ? 'real' : route.query.origin === 'demo' ? 'demo' : null)
  const target = () => JSON.stringify([origin.value, options.target(draftKey.value)])
  const read = shallowRef<R | null>(null)
  const latest = shallowRef<R | null>(null)
  const draft = shallowRef<D | null>(null)
  const adoptedTarget = shallowRef('')
  const original = shallowRef('')
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const readFailed = shallowRef(false)
  const active = shallowRef(true)
  const error = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const formElement = shallowRef<HTMLFormElement | null>(null)
  const errorPanel = shallowRef<{ focus: () => void } | null>(null)
  const matching = computed(() => adoptedTarget.value === target() ? read.value : null)
  const pending = computed(() => matching.value ? options.pending(matching.value) : null)
  const busy = computed(() => loading.value || saving.value)
  const writable = computed(() => {
    const authority = latest.value ?? matching.value
    return !!matching.value && !!authority && origin.value === 'real' && !isDesktopRuntime() && !authority.context.readonly && authority.context.capabilities.includes('payroll:write') && !busy.value && !pending.value && !readFailed.value
  })
  const editable = computed(() => writable.value && options.canEdit((latest.value ?? matching.value)!))
  const dirty = computed(() => !!matching.value && JSON.stringify(draft.value) !== original.value)
  const previewed = computed(() => !!matching.value && JSON.stringify(draft.value) === JSON.stringify(matching.value.draft))
  const canSave = computed(() => !!options.save && editable.value && previewed.value)
  const canConfirm = computed(() => writable.value && previewed.value && !!matching.value && options.canConfirm(matching.value) && (!options.save || !dirty.value))
  const returnTo = computed(() => origin.value ? payrollAdjustmentReturn(route.query.returnTo, origin.value) || `/subcontract/payroll?origin=${origin.value}` : '/subcontract/payroll')
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const cache = new Map<string, { read: R, draft: D, original: string }>()
  const cacheKey = (requested: string, value: R) => JSON.stringify([requested, value.context.workspaceId, value.context.actorId, value.context.origin])
  let sequence = 0
  let started = false
  let allowLeave = false
  const same = (requested: string, request: number) => active.value && target() === requested && sequence === request
  function remember() {
    if (read.value && draft.value !== null)
      cache.set(cacheKey(adoptedTarget.value, read.value), { read: read.value, draft: clone(draft.value), original: original.value })
  }
  function capture(cause: unknown) {
    error.value = toErrorMessage(cause)
    fieldErrors.value = Object.fromEntries(Object.entries(projectProblemFromUnknown(cause).problem.fieldErrors ?? {}).map(([key, messages]) => [key, messages.join('；')]))
  }
  async function load(preview = false) {
    if (preview && (pending.value || saving.value))
      return
    remember()
    const requested = target()
    const request = ++sequence
    started = true
    loading.value = true
    error.value = ''
    readFailed.value = false
    try {
      if (origin.value !== 'real' || isDesktopRuntime())
        throw new Error('本页需要从浏览器正式工资记录进入；当前来源仅可阅读原工资资料。')
      if (route.path.endsWith('/new') && route.query.draftKey !== draftKey.value)
        await router.replace({ path: route.path, query: { ...route.query, draftKey: draftKey.value, origin: 'real' } })
      if (!same(requested, request))
        return
      const value = await options.load(draftKey.value, preview && draft.value !== null ? clone(draft.value) : undefined)
      if (!same(requested, request))
        return
      if (value.context.origin !== origin.value)
        throw new Error('读取的工资来源与本页不一致，请保留输入。')
      if (preview && matching.value && (matching.value.context.workspaceId !== value.context.workspaceId || matching.value.context.actorId !== value.context.actorId))
        throw new Error('工作区或经办人已变化，请重新读取原目标后继续。')
      const saved = cache.get(cacheKey(requested, value))
      if (!preview && saved) {
        read.value = saved.read
        draft.value = clone(saved.draft)
        original.value = saved.original
        latest.value = value
      }
      else {
        read.value = value
        latest.value = null
        draft.value = clone(value.draft)
        if (!preview)
          original.value = JSON.stringify(value.draft)
        const operation = options.pending(value)
        if (operation)
          draft.value = clone(operation.restoredFromDescriptor ? value.draft : options.restoredDraft(operation, value))
      }
      adoptedTarget.value = requested
    }
    catch (cause) {
      if (same(requested, request)) {
        readFailed.value = true
        capture(cause)
      }
    }
    finally {
      if (same(requested, request))
        loading.value = false
    }
  }
  function change(value: D) {
    if (editable.value) {
      draft.value = clone(value)
      fieldErrors.value = {}
    }
  }
  async function mayLeave() {
    if (allowLeave)
      return true
    if (pending.value || saving.value) {
      error.value = '请先核对原提交结果，当前输入仍保留。'
      return false
    }
    if (!dirty.value)
      return true
    const before = JSON.stringify(draft.value)
    const accepted = await kit.confirm({ variant: 'simple', title: '放弃未保存的修改', message: '当前更正或收付输入尚未保存，确认放弃？', confirmLabel: '放弃修改' })
    return accepted && before === JSON.stringify(draft.value) && !pending.value && !saving.value
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value || saving.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate(async (to, from) => (to.path === from.path && to.query.draftKey === from.query.draftKey && JSON.stringify({ ...to.query, returnTo: undefined }) === JSON.stringify({ ...from.query, returnTo: undefined })) || await mayLeave())
  async function leave() {
    const requested = target()
    if (!await mayLeave() || !active.value || target() !== requested)
      return
    if (read.value)
      cache.delete(cacheKey(requested, read.value))
    allowLeave = true
    tabs.close(formKey)
    await router.push(returnTo.value)
  }
  async function finish(result: PayrollAdjustmentCommandResult, requested: string, request: number) {
    const operation = matching.value ? options.pending(matching.value) : null
    if (!operation)
      throw new Error('原提交尚未核实，请保留当前输入。')
    const refreshed = result.actualEventId ? await store.loadActualPaymentDetail({ origin: 'real' }, result.actualEventId) : result.adjustmentId ? await store.loadAdjustmentDetail({ origin: 'real' }, result.adjustmentId) : null
    if (!same(requested, request))
      return
    if (!refreshed)
      throw new Error('原提交未提供可核实的记录身份。')
    store.acknowledgeAdjustment(operation, refreshed)
    if (read.value)
      cache.delete(cacheKey(requested, read.value))
    original.value = JSON.stringify(draft.value)
    allowLeave = true
    tabs.close(formKey)
    await router.push(result.actualEventId ? payrollActualLocation({ kind: 'actual-event', eventId: result.actualEventId }, 'real', returnTo.value) : payrollAdjustmentLocation(result.adjustmentId!, 'real', returnTo.value))
    kit.success(result.outcome === 'saved' ? '独立更正草稿已保存，请继续核对并确认。' : '确认记录已保存，原工资签名金额保持冻结。')
  }
  async function execute(kind: 'save' | 'confirm' | 'recover') {
    const value = matching.value
    if (!value || busy.value || (kind === 'save' && !canSave.value) || (kind === 'confirm' && !canConfirm.value))
      return
    const requested = target()
    const request = sequence
    const before = JSON.stringify(draft.value)
    if (kind === 'confirm') {
      const summary = options.confirmation(value)
      const accepted = await kit.confirm({ variant: 'simple', ...summary, confirmLabel: '确认并保存记录' })
      if (!accepted || !same(requested, request) || !canConfirm.value || before !== JSON.stringify(draft.value))
        return
    }
    saving.value = true
    error.value = ''
    try {
      const operation = pending.value
      const result = kind === 'recover' ? operation ? await store.recoverAdjustment(operation) : null : kind === 'save' ? await options.save!(value, clone(draft.value!)) : await options.confirm(value)
      if (result && same(requested, request))
        await finish(result, requested, request)
    }
    catch (cause) {
      if (same(requested, request)) {
        capture(cause)
        await nextTick()
        if (same(requested, request)) {
          const field = formElement.value?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"][tabindex]')
          if (field)
            field.focus()
          else
            errorPanel.value?.focus()
        }
      }
    }
    finally {
      if (same(requested, request))
        saving.value = false
    }
  }
  watch(target, () => {
    if (active.value && deriveKey(route.fullPath) === formKey) {
      allowLeave = false
      void load()
    }
  }, { immediate: true })
  onDeactivated(() => {
    remember()
    active.value = false
    sequence += 1
    loading.value = false
    saving.value = false
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    allowLeave = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  return { read: matching, latest, draft, origin, draftKey, active, loading, saving, busy, readFailed, error, fieldErrors, formElement, errorPanel, pending, editable, dirty, previewed, canSave, canConfirm, returnTo, change, load, leave, execute }
}
