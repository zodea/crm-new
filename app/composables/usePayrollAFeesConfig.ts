import type { PayrollAConfigScope, PayrollAPeriodKind } from '~/lib/payroll/central-a-contract'
import type { PayrollABookRef, PayrollAFeeConfigRead, PayrollAFeeDraft, PayrollAFeeRevision, PayrollAFeesCommandResult, PayrollAManagementBookDraft, PayrollAManagementBookRead } from '~/lib/payroll/central-a-fees-contract'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { usePayrollAFeesStore } from '~/stores/payroll-a-fees'

interface DraftRow {
  key: string
  draft: PayrollAFeeDraft
}
interface Removal {
  feeId: string
  baseRevisionId: string
}
export function usePayrollAFeesConfig(options: {
  scope: () => PayrollAConfigScope
  origin: () => string | null
  blocked: () => boolean
}) {
  const route = useRoute()
  const router = useRouter()
  const store = usePayrollAFeesStore()
  const kit = useKitUI()
  const formKey = deriveKey(route.fullPath)
  const book = computed<PayrollABookRef | null>(() => route.query.managementBookId == null || route.query.managementBookId === '' ? { bookPurpose: 'ordinary', managementBookId: null } : isStableRouteIdentity(route.query.managementBookId) ? { bookPurpose: 'management', managementBookId: String(route.query.managementBookId) } : null)
  const scope = computed(() => book.value ? { ...options.scope(), book: book.value } : null)
  const target = () => payrollACanonical([options.origin(), scope.value])
  const read = shallowRef<PayrollAFeeConfigRead | null>(null)
  const latest = shallowRef<PayrollAFeeConfigRead | null>(null)
  const rows = shallowRef<DraftRow[]>([])
  const removed = shallowRef<Removal[]>([])
  const management = shallowRef<PayrollAManagementBookDraft | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const failed = shallowRef(false)
  const active = shallowRef(true)
  const errorPanel = shallowRef<{
    focus: () => void
  } | null>(null)
  const matching = computed(() => read.value && payrollACanonical([read.value.context.origin, read.value.scope]) === target() ? read.value : null)
  const current = computed(() => latest.value ?? matching.value)
  const pending = computed(() => matching.value ? store.getPending(matching.value) : null)
  const busy = computed(() => loading.value || saving.value)
  const dirty = computed(() => rows.value.length > 0 || removed.value.length > 0 || management.value !== null)
  const snapshot = computed(() => payrollACanonical([rows.value, removed.value, management.value]))
  const editable = computed(() => !!current.value && !!matching.value && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write') && !current.value.readonlyReasons.length && !busy.value && !pending.value && !failed.value && !options.blocked())
  const canEditFees = computed(() => editable.value && !!current.value?.eligibility.canSaveFees)
  const canEditManagement = computed(() => editable.value && !!current.value?.eligibility.canSaveManagementBook)
  const canStart = computed(() => editable.value && !!current.value?.eligibility.canStartManagementDraft)
  const cache = new Map<string, {
    read: PayrollAFeeConfigRead
    rows: DraftRow[]
    removed: Removal[]
    management: PayrollAManagementBookDraft | null
  }>()
  const cacheKey = (value: PayrollAFeeConfigRead) => payrollACanonical([value.context.workspaceId, value.context.actorId, value.context.origin, value.scope])
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let sequence = 0
  let started = false
  const same = (requested: string, request: number) => active.value && requested === target() && sequence === request
  function remember() {
    if (read.value)
      cache.set(cacheKey(read.value), { read: read.value, rows: clone(rows.value), removed: clone(removed.value), management: clone(management.value) })
  }
  function discard() {
    if (read.value)
      cache.delete(cacheKey(read.value))
    rows.value = []
    removed.value = []
    management.value = null
  }
  function restorePending(value: PayrollAFeeConfigRead) {
    const pending = store.getPending(value)
    const action = pending?.restoredFromDescriptor ? undefined : pending?.command.action
    if (action?.kind === 'save-a-fees') {
      rows.value = action.fees.map(draft => ({ key: draft.feeId || generateId('fee-input'), draft: clone(draft) }))
      removed.value = clone(action.remove)
    }
    else if (action?.kind === 'save-a-management-book') {
      management.value = clone(action.management)
    }
  }
  async function load() {
    remember()
    const requested = target()
    const request = ++sequence
    started = true
    loading.value = true
    error.value = ''
    failed.value = false
    try {
      if (options.origin() !== 'real' || !scope.value)
        throw new Error('费用来源或管理簿身份无效。')
      if (!scope.value.projectId || !scope.value.month) {
        read.value = null
        latest.value = null
        return
      }
      const value = await store.loadConfig({ origin: 'real' }, { ...scope.value })
      if (!same(requested, request))
        return
      if (payrollACanonical(value.scope) !== payrollACanonical(scope.value) || value.context.origin !== 'real')
        throw new Error('费用读取与当前项目、主体或管理簿不一致。')
      const saved = cache.get(cacheKey(value))
      if (saved) {
        read.value = saved.read
        latest.value = value
        rows.value = clone(saved.rows)
        removed.value = clone(saved.removed)
        management.value = clone(saved.management)
      }
      else {
        read.value = value
        latest.value = null
        rows.value = []
        removed.value = []
        management.value = null
        restorePending(value)
      }
    }
    catch (cause) {
      if (same(requested, request)) {
        failed.value = true
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (same(requested, request))
        loading.value = false
    }
  }
  function addFee() {
    if (!canEditFees.value || !book.value)
      return
    const owner = book.value.bookPurpose === 'management' ? { ...book.value, kind: 'management' as const } : { ...book.value, kind: 'housing' as const }
    rows.value = [...rows.value, { key: generateId('fee-input'), draft: { ...owner, feeId: null, baseRevisionId: null, name: owner.kind === 'management' ? '管理费' : '房补', enabled: false, unitPrice: null, unit: null, basis: { kind: 'completed-field-quantity', itemIds: [], scope: { kind: 'cells', cells: [] } }, effectiveMonth: options.scope().month, adoptedDefault: null } }]
  }
  function editFee(fee: PayrollAFeeRevision) {
    if (!canEditFees.value || fee.removed || rows.value.some(row => row.draft.feeId === fee.feeId))
      return
    const { feeId, id, bookPurpose, managementBookId, kind, name, enabled, unitPrice, unit, basis, effectiveMonth, adoptedDefault } = fee
    const owner = bookPurpose === 'management' ? { bookPurpose, managementBookId: managementBookId!, kind: 'management' as const } : { bookPurpose, managementBookId: null, kind: kind === 'housing' ? 'housing' as const : 'subsidy' as const }
    rows.value = [...rows.value, { key: feeId, draft: clone({ ...owner, feeId, baseRevisionId: id, name, enabled, unitPrice, unit, basis, effectiveMonth, adoptedDefault }) }]
  }
  function changeFee(key: string, draft: PayrollAFeeDraft) {
    if (canEditFees.value)
      rows.value = rows.value.map(row => row.key === key ? { key, draft } : row)
  }
  function removeFee(key: string) {
    if (!canEditFees.value)
      return
    const row = rows.value.find(row => row.key === key)
    if (row?.draft.feeId && row.draft.baseRevisionId)
      removed.value = [...removed.value.filter(item => item.feeId !== row.draft.feeId), { feeId: row.draft.feeId, baseRevisionId: row.draft.baseRevisionId }]
    rows.value = rows.value.filter(row => row.key !== key)
  }
  function editManagement(value: PayrollAManagementBookRead | 'crew-managed' | 'company-managed') {
    if (!canEditManagement.value)
      return
    if (typeof value === 'string')
      management.value = { managementBookId: null, baseRevisionId: null, managerWorkerId: null, effectiveMonth: options.scope().month, managementMode: value, scope: { assignments: [] }, initialPayRatio: null, evidenceNote: '' }
    else if (value.revision)
      management.value = clone({ managementBookId: value.book.id, baseRevisionId: value.revision.id, managerWorkerId: value.book.managerWorkerId, effectiveMonth: options.scope().month, managementMode: value.revision.managementMode, scope: value.revision.scope, initialPayRatio: value.revision.initialPayRatio, evidenceNote: value.revision.evidenceNote })
  }
  async function adoptLatest() {
    const value = current.value
    const before = snapshot.value
    const requested = target()
    if (!value || !editable.value || !await kit.confirm({ variant: 'simple', title: '采用当前费用依据', message: '保留未保存的费用和管理范围，采用本页当前读取的配置版本；已被修改的原修订仍须逐项重新选择核对。', confirmLabel: '保留输入并采用' }))
      return
    if (active.value && requested === target() && value === current.value && before === snapshot.value && !pending.value) {
      read.value = value
      latest.value = null
      remember()
    }
  }
  async function finish(result: PayrollAFeesCommandResult, requested: string, request: number) {
    const operation = pending.value
    if (!operation || !scope.value)
      throw new Error('费用原提交未能核对，请保留输入。')
    if (operation.command.action.kind === 'start-a-management-draft') {
      if (!result.statementId)
        throw new Error('管理草稿回执缺少原单身份。')
      const fresh = await store.loadForm({ origin: 'real' }, result.statementId)
      if (!same(requested, request))
        return
      store.acknowledge(operation, fresh)
      await router.push({ path: `/subcontract/payroll/${encodeURIComponent(result.statementId)}`, query: { origin: 'real', returnTo: typeof route.query.returnTo === 'string' ? route.query.returnTo : '/subcontract/payroll?origin=real' } })
      kit.success(result.locatedExistingDraft ? '已定位本管理簿原草稿。' : '独立管理费草稿已生成。')
      return
    }
    const fresh = await store.loadConfig({ origin: 'real' }, { ...scope.value })
    if (!same(requested, request))
      return
    store.acknowledge(operation, fresh)
    if (operation.command.action.kind === 'save-a-fees') {
      rows.value = []
      removed.value = []
    }
    else {
      management.value = null
    }
    // 另一分区仍有输入时保留其原读取依据，不能借保存本区自动升级另一稿。
    if (!dirty.value) {
      read.value = fresh
      latest.value = null
    }
    else {
      latest.value = fresh
    }
    remember()
    kit.success('费用配置已保存；未发工资需重新核对。')
  }
  async function execute(kind: 'fees' | 'management' | 'start' | 'recover', selected?: PayrollAManagementBookRead, periodKind: PayrollAPeriodKind = 'monthly') {
    const value = matching.value
    if (!value || busy.value || (kind !== 'recover' && !editable.value) || (kind === 'start' && dirty.value))
      return
    if ((kind === 'fees' && !canEditFees.value) || (kind === 'management' && !canEditManagement.value) || (kind === 'start' && !canStart.value))
      return
    const requested = target()
    const request = sequence
    saving.value = true
    error.value = ''
    try {
      const result = kind === 'recover' && pending.value ? await store.recover(pending.value) : kind === 'fees' ? await store.saveFees(value, rows.value.map(row => clone(row.draft)), clone(removed.value)) : kind === 'management' && management.value ? await store.saveManagement(value, clone(management.value)) : kind === 'start' && selected ? await store.startManagement(value, selected, periodKind) : null
      if (result && same(requested, request))
        await finish(result, requested, request)
    }
    catch (cause) {
      if (same(requested, request)) {
        error.value = toErrorMessage(cause)
        await nextTick()
        if (same(requested, request))
          errorPanel.value?.focus()
      }
    }
    finally {
      if (same(requested, request))
        saving.value = false
    }
  }
  watch(target, () => {
    if (active.value && deriveKey(route.fullPath) === formKey)
      void load()
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
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  return { book, scope, matching, current, latest, rows, removed, management, loading, saving, busy, pending, dirty, snapshot, editable, canEditFees, canEditManagement, canStart, error, errorPanel, load, discard, addFee, editFee, changeFee, removeFee, editManagement, adoptLatest, execute }
}
