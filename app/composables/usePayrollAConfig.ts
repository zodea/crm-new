import type { PayrollAConfigRead, PayrollAConfigScope, PayrollAPriceDraft, PayrollASubjectConfigDraft } from '~/lib/payroll/central-a-contract'
import type { PayrollProjectOption } from '~/lib/payroll/central-contract'
import { computed, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollAWorkspaceReturn } from '~/lib/payroll/a-navigation'
import { payrollViewScope } from '~/lib/payroll/central-navigation'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export function usePayrollAConfig() {
  const route = useRoute()
  const router = useRouter()
  const store = usePayrollStore()
  const tabs = useTabsStore()
  const kit = useKitUI()
  const formKey = deriveKey(route.fullPath)
  const viewScope = computed(() => payrollViewScope(route.query))
  const scope = computed<PayrollAConfigScope>(() => ({ projectId: viewScope.value.projectId, month: viewScope.value.month, crewId: viewScope.value.crewId || null, leaderWorkerId: typeof route.query.leader === 'string' && route.query.leader ? route.query.leader : null }))
  const scopeKey = (value: PayrollAConfigScope | null) => value ? JSON.stringify([value.projectId, value.month, value.crewId, value.leaderWorkerId]) : ''
  const target = () => JSON.stringify([viewScope.value.origin, scopeKey(scope.value)])
  const current = shallowRef<PayrollAConfigRead | null>(null)
  const subjectRead = shallowRef<PayrollAConfigRead | null>(null)
  const priceRead = shallowRef<PayrollAConfigRead | null>(null)
  const projects = shallowRef<PayrollProjectOption[]>([])
  const subject = ref<PayrollASubjectConfigDraft>({ crewId: null, leaderWorkerId: '', initialPayRatio: null })
  const prices = ref<PayrollAPriceDraft[]>([])
  const subjectOriginal = shallowRef('')
  const priceOriginal = shallowRef('[]')
  const active = shallowRef(true)
  const loading = shallowRef(false)
  const readFailed = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const busy = computed(() => loading.value || saving.value)
  const matching = computed(() => current.value && current.value.context.origin === viewScope.value.origin && scopeKey(current.value.scope) === scopeKey(scope.value) ? current.value : null)
  const pending = computed(() => matching.value ? store.getAPending(matching.value) : null)
  const editable = computed(() => !!matching.value && !matching.value.context.readonly && matching.value.context.capabilities.includes('payroll:write') && !matching.value.readonlyReasons.length && !readFailed.value && !busy.value && !pending.value)
  const subjectDirty = computed(() => JSON.stringify(subject.value) !== subjectOriginal.value)
  const priceDirty = computed(() => JSON.stringify(prices.value) !== priceOriginal.value)
  const dirty = computed(() => !!matching.value && (subjectDirty.value || priceDirty.value))
  const back = computed(() => payrollAWorkspaceReturn(route.query.returnTo, viewScope.value.origin) || '/subcontract/payroll?origin=real')
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const cache = new Map<string, { read: PayrollAConfigRead, subjectRead: PayrollAConfigRead | null, priceRead: PayrollAConfigRead | null, subject: PayrollASubjectConfigDraft, prices: PayrollAPriceDraft[], subjectOriginal: string, priceOriginal: string }>()
  const key = (value: PayrollAConfigRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, scopeKey(value.scope)])
  let sequence = 0
  let started = false
  let allowLeave = false
  let browserBack = false
  const same = (requested: string, request: number) => active.value && target() === requested && request === sequence
  function remember() {
    if (current.value)
      cache.set(key(current.value), { read: current.value, subjectRead: subjectRead.value, priceRead: priceRead.value, subject: clone(subject.value), prices: clone(prices.value), subjectOriginal: subjectOriginal.value, priceOriginal: priceOriginal.value })
  }
  function adopt(value: PayrollAConfigRead, section: 'all' | 'subject' | 'prices' = 'all') {
    current.value = value
    if (section !== 'prices') {
      subjectRead.value = value
      subject.value = { crewId: value.scope.crewId, leaderWorkerId: value.scope.leaderWorkerId || '', initialPayRatio: value.subject?.initialPayRatio ?? null }
      subjectOriginal.value = JSON.stringify(subject.value)
    }
    if (section !== 'subject') {
      priceRead.value = value
      prices.value = []
      priceOriginal.value = '[]'
    }
  }
  async function load() {
    if (matching.value)
      remember()
    const requested = target()
    const request = ++sequence
    started = true
    loading.value = true
    readFailed.value = false
    error.value = ''
    try {
      if (viewScope.value.origin !== 'real' || viewScope.value.error || (route.query.leader != null && route.query.leader !== '' && !isStableRouteIdentity(route.query.leader)))
        throw new Error(viewScope.value.error || '工资配置来源或负责人身份无效，请从正式工资重新进入。')
      const list = await store.loadRead({ origin: 'real' })
      if (!same(requested, request))
        return
      projects.value = list.projects
      if (!scope.value.projectId || !scope.value.month) {
        current.value = null
        return
      }
      const value = await store.loadAConfig({ origin: 'real' }, { ...scope.value })
      if (!same(requested, request))
        return
      if (scopeKey(value.scope) !== scopeKey(scope.value) || value.context.origin !== 'real')
        throw new Error('配置返回的项目、月份和负责人不一致。')
      const saved = cache.get(key(value))
      if (saved) {
        current.value = value
        subjectRead.value = saved.subjectRead
        priceRead.value = saved.priceRead
        subject.value = clone(saved.subject)
        prices.value = clone(saved.prices)
        subjectOriginal.value = saved.subjectOriginal
        priceOriginal.value = saved.priceOriginal
      }
      else {
        adopt(value)
        const operation = store.getAPending(value)
        if (operation?.command.action.kind === 'save-a-subject-config')
          subject.value = clone(operation.command.action.config)
        else if (operation?.command.action.kind === 'save-a-prices')
          prices.value = clone(operation.command.action.prices)
      }
    }
    catch (cause) {
      if (same(requested, request)) {
        readFailed.value = true
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (same(requested, request))
        loading.value = false
    }
  }
  async function mayLeave() {
    if (allowLeave)
      return true
    if (saving.value || (current.value && store.getAPending(current.value))) {
      error.value = '请先核对配置原提交，再离开当前修改。'
      return false
    }
    if (!dirty.value)
      return true
    const before = JSON.stringify([subject.value, prices.value])
    return await kit.confirm({ variant: 'simple', title: '放弃工资配置修改', message: '未保存的首月比例或单价会被放弃，确认继续？', confirmLabel: '放弃修改' }) && before === JSON.stringify([subject.value, prices.value]) && !pending.value
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  useEventListener('popstate', () => browserBack = true)
  onBeforeRouteLeave(async () => {
    const back = browserBack
    browserBack = false
    return !back || await mayLeave()
  })
  async function changeScope(patch: Partial<PayrollAConfigScope>) {
    const requested = target()
    if (!await mayLeave() || requested !== target() || !active.value)
      return
    if (matching.value)
      cache.delete(key(matching.value))
    current.value = null
    const next = { ...scope.value, ...patch }
    await router.replace({ path: '/subcontract/payroll/config', query: { ...route.query, origin: 'real', project: next.projectId, month: next.month, crew: next.crewId || '', leader: next.leaderWorkerId || '' } })
  }
  async function save(section: 'subject' | 'prices') {
    const value = section === 'subject' ? subjectRead.value : priceRead.value
    if (!value || !editable.value || (section === 'subject' ? !subjectDirty.value : !priceDirty.value))
      return
    const requested = target()
    const request = sequence
    const preserveOther = section === 'subject' ? priceDirty.value : subjectDirty.value
    saving.value = true
    error.value = ''
    try {
      if (section === 'subject')
        await store.saveASubjectConfig(value, clone(subject.value))
      else
        await store.saveAPrices(value, clone(prices.value))
      if (!same(requested, request))
        return
      const operation = store.getAPending(value)
      const fresh = await store.loadAConfig({ origin: 'real' }, { ...scope.value })
      if (!same(requested, request))
        return
      if (!operation)
        throw new Error('原配置提交未能核对，请保留输入。')
      store.acknowledgeA(operation, fresh)
      adopt(fresh, preserveOther ? section : 'all')
      remember()
      kit.success(section === 'subject' ? '首月比例已保存。' : '工资单价已保存；未发工资需要重新核对。')
    }
    catch (cause) {
      if (same(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (same(requested, request))
        saving.value = false
    }
  }
  async function recover() {
    const operation = pending.value
    if (!operation || busy.value)
      return
    const requested = target()
    const request = sequence
    saving.value = true
    try {
      const result = await store.recoverA(operation)
      if (!same(requested, request) || result.projectId !== scope.value.projectId || scopeKey(operation.command.configScope) !== scopeKey(scope.value))
        return
      const value = await store.loadAConfig({ origin: 'real' }, { ...scope.value })
      if (!same(requested, request))
        return
      store.acknowledgeA(operation, value)
      adopt(value, operation.command.action.kind === 'save-a-subject-config' ? 'subject' : 'prices')
      remember()
      error.value = ''
      kit.success('原配置提交已核实。')
    }
    catch (cause) {
      if (same(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (same(requested, request))
        saving.value = false
    }
  }
  async function recheck(section: 'subject' | 'prices') {
    const value = matching.value
    if (!value || !editable.value)
      return
    const requested = target()
    const before = JSON.stringify([subject.value, prices.value])
    if (!await kit.confirm({ variant: 'simple', title: '采用当前配置依据', message: '请核对本页当前已保存的比例和单价。保留本区未保存输入，按本页已读取的资料继续保存；提交时仍会核验变化。', confirmLabel: '保留输入并采用' }))
      return
    if (!active.value || target() !== requested || value !== matching.value || before !== JSON.stringify([subject.value, prices.value]) || pending.value)
      return
    if (section === 'subject')
      subjectRead.value = value
    else
      priceRead.value = value
  }
  async function leave() {
    const requested = target()
    if (!await mayLeave() || requested !== target() || !active.value)
      return
    if (current.value)
      cache.delete(key(current.value))
    allowLeave = true
    tabs.close(formKey)
    await router.push(back.value)
  }
  watch(target, () => {
    if (active.value && deriveKey(route.fullPath) === formKey) {
      remember()
      allowLeave = false
      void load()
    }
  }, { immediate: true })
  onDeactivated(() => {
    remember()
    active.value = false
    sequence += 1
    saving.value = false
    loading.value = false
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    allowLeave = false
    browserBack = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  return { scope, current, matching, projects, subject, prices, subjectRead, priceRead, subjectDirty, priceDirty, editable, dirty, busy, loading, error, pending, back, changeScope, load, save, recover, recheck, leave }
}
