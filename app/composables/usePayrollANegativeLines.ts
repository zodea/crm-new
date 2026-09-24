import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import type { PayrollAFeeConfigRead, PayrollAFeesFormRead, PayrollANegativeLineDraft } from '~/lib/payroll/central-a-fees-contract'
import type { PayrollActualFact } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { usePayrollAFeesStore } from '~/stores/payroll-a-fees'

interface Row {
  key: string
  draft: PayrollANegativeLineDraft
}
interface Removal {
  lineId: string
  baseRevisionId: string
}
export function usePayrollANegativeLines(options: {
  read: () => PayrollAFormRead | null
  latest: () => PayrollAFormRead | null
  blocked: () => boolean
  active: () => boolean
  saved: () => Promise<void>
}) {
  const store = () => usePayrollAFeesStore()
  const kit = useKitUI()
  const current = computed(() => {
    const read = options.latest() ?? options.read()
    return read && hasPayrollAFeesForm(read) && read.book?.bookPurpose === 'management' ? read : null
  })
  const read = shallowRef<PayrollAFeesFormRead | null>(null)
  const rows = shallowRef<Row[]>([])
  const removed = shallowRef<Removal[]>([])
  const original = shallowRef('[]')
  const scopeRead = shallowRef<PayrollAFeeConfigRead | null>(null)
  const actualFacts = shallowRef<PayrollActualFact[]>([])
  const actualStatements = shallowRef<PayrollStatementRow[]>([])
  const referenceReady = shallowRef(false)
  const referenceLoading = shallowRef(false)
  const referenceError = shallowRef('')
  let referenceRequest = 0
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const failed = shallowRef(false)
  const error = shallowRef('')
  const errorPanel = shallowRef<{
    focus: () => void
  } | null>(null)
  const key = (value: PayrollAFeesFormRead) => payrollACanonical([value.context.workspaceId, value.context.actorId, value.context.origin, value.statementId, value.book])
  const matching = computed(() => current.value && read.value && key(current.value) === key(read.value) ? read.value : null)
  const pending = computed(() => matching.value ? store().getPending(matching.value) : null)
  const snapshot = computed(() => payrollACanonical([rows.value.map(row => row.draft), removed.value]))
  const dirty = computed(() => !!matching.value && (payrollACanonical(rows.value.map(row => row.draft)) !== original.value || removed.value.length > 0))
  const busy = computed(() => loading.value || saving.value)
  const editable = computed(() => !!matching.value && !!current.value?.fees && current.value.bookProof.state === 'proven' && current.value.status !== 'released' && current.value.context.origin === 'real' && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write') && !failed.value && !busy.value && !pending.value && !options.blocked())
  const cache = new Map<string, {
    read: PayrollAFeesFormRead
    rows: Row[]
    removed: Removal[]
    original: string
  }>()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let sequence = 0
  let deactivated = false
  const same = (target: string, request: number) => options.active() && sequence === request && !!current.value && key(current.value) === target
  function remember() {
    if (read.value)
      cache.set(key(read.value), { read: read.value, rows: clone(rows.value), removed: clone(removed.value), original: original.value })
  }
  function adopt(value: PayrollAFeesFormRead) {
    read.value = value
    rows.value = value.negativeLineDrafts.map(draft => ({ key: draft.lineId || generateId('negative-input'), draft: clone(draft) }))
    removed.value = []
    original.value = payrollACanonical(value.negativeLineDrafts)
  }
  async function loadReferences() {
    const value = current.value
    if (!value?.draft.projectId || referenceLoading.value || !editable.value)
      return
    const target = key(value)
    const request = ++referenceRequest
    referenceReady.value = false
    referenceLoading.value = true
    referenceError.value = ''
    try {
      const { ledger, list } = await store().loadActualReferences({ origin: value.context.origin }, value.draft.projectId)
      if (!options.active() || request !== referenceRequest || !current.value || key(current.value) !== target)
        return
      if (ledger.context.workspaceId !== value.context.workspaceId || ledger.context.actorId !== value.context.actorId || ledger.context.origin !== value.context.origin || ledger.scope.projectId !== value.draft.projectId || ['forbidden', 'unavailable'].includes(ledger.status))
        throw new Error('当前项目的实际收付尚未能核对。')
      actualFacts.value = ledger.rows.filter(fact => fact.projectId === value.draft.projectId && fact.qualification === 'proven')
      actualStatements.value = list.rows
      referenceReady.value = true
    }
    catch (cause) {
      if (options.active() && request === referenceRequest)
        referenceError.value = toErrorMessage(cause)
    }
    finally {
      if (request === referenceRequest)
        referenceLoading.value = false
    }
  }
  async function loadScope(value: PayrollAFeesFormRead) {
    const request = ++sequence
    const target = key(value)
    loading.value = true
    failed.value = false
    try {
      if (!value.book || !value.draft.projectId || !value.draft.month)
        throw new Error('管理单范围尚未完整读取。')
      const config = await store().loadConfig({ origin: value.context.origin }, { projectId: value.draft.projectId, month: value.draft.month, crewId: value.draft.crewId ?? null, leaderWorkerId: value.draft.leaderWorkerId ?? null, book: value.book })
      if (same(target, request))
        scopeRead.value = config
    }
    catch (cause) {
      if (same(target, request)) {
        failed.value = true
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (same(target, request))
        loading.value = false
    }
  }
  watch(() => options.read(), (value) => {
    remember()
    referenceRequest += 1
    referenceReady.value = false
    referenceLoading.value = false
    actualFacts.value = []
    actualStatements.value = []
    if (!value || !hasPayrollAFeesForm(value) || value.book?.bookPurpose !== 'management')
      return
    const saved = cache.get(key(value))
    if (saved && (saved.removed.length || payrollACanonical(saved.rows.map(row => row.draft)) !== saved.original || store().getPending(value))) {
      read.value = saved.read
      rows.value = clone(saved.rows)
      removed.value = clone(saved.removed)
      original.value = saved.original
    }
    else {
      adopt(value)
      const action = store().getPending(value)?.command.action
      if (action?.kind === 'save-a-negative-lines') {
        rows.value = action.lines.map(draft => ({ key: draft.lineId || generateId('negative-input'), draft: clone(draft) }))
        removed.value = clone(action.remove)
      }
    }
    void loadScope(value)
  }, { immediate: true })
  function add() {
    if (editable.value)
      rows.value = [...rows.value, { key: generateId('negative-input'), draft: { lineId: null, baseRevisionId: null, label: '', quantity: null, unit: null, unitPrice: null, scope: { assignments: [] }, reason: '', evidenceNote: '', actualRef: null } }]
  }
  function change(key: string, draft: PayrollANegativeLineDraft) {
    if (editable.value)
      rows.value = rows.value.map(row => row.key === key ? { key, draft } : row)
  }
  function remove(key: string) {
    if (!editable.value)
      return
    const row = rows.value.find(row => row.key === key)
    if (row?.draft.lineId && row.draft.baseRevisionId)
      removed.value = [...removed.value.filter(item => item.lineId !== row.draft.lineId), { lineId: row.draft.lineId, baseRevisionId: row.draft.baseRevisionId }]
    rows.value = rows.value.filter(row => row.key !== key)
  }
  function discard() {
    if (read.value)
      cache.delete(key(read.value))
    if (current.value)
      adopt(current.value)
  }
  async function recheck() {
    const value = current.value
    const before = snapshot.value
    if (!value || !editable.value || !await kit.confirm({ variant: 'simple', title: '采用当前管理清单依据', message: '保留当前负价输入，采用已读取的管理单及配置版本；已变化的原负价修订须重新核对。', confirmLabel: '保留输入并采用' }))
      return
    if (options.active() && value === current.value && before === snapshot.value && !pending.value)
      read.value = value
  }
  async function execute(recover = false) {
    const value = matching.value
    if (!value?.statementId || busy.value || (!recover && (!editable.value || !dirty.value)))
      return
    const target = key(value)
    const request = sequence
    saving.value = true
    error.value = ''
    try {
      if (recover && pending.value)
        await store().recover(pending.value)
      else
        await store().saveNegativeLines(value, rows.value.map(row => clone(row.draft)), clone(removed.value))
      const operation = store().getPending(value)
      const fresh = await store().loadForm({ origin: value.context.origin }, value.statementId)
      if (!same(target, request))
        return
      if (!operation)
        throw new Error('原负价提交未能核对，请保留输入。')
      store().acknowledge(operation, fresh)
      adopt(fresh)
      remember()
      saving.value = false
      await options.saved()
      kit.success('管理清单已保存，请重新核对本单后发放。')
    }
    catch (cause) {
      if (same(target, request)) {
        error.value = toErrorMessage(cause)
        await nextTick()
        if (same(target, request))
          errorPanel.value?.focus()
      }
    }
    finally {
      if (same(target, request))
        saving.value = false
    }
  }
  onDeactivated(() => {
    remember()
    deactivated = true
    sequence += 1
    loading.value = false
    saving.value = false
    referenceRequest += 1
    referenceLoading.value = false
  })
  onActivated(() => {
    if (deactivated && current.value) {
      deactivated = false
      void loadScope(current.value)
    }
  })
  onScopeDispose(() => {
    sequence += 1
  })
  return { current, matching, scopeRead, rows, removed, pending, dirty, busy, editable, error, errorPanel, snapshot, actualFacts, actualStatements, referenceReady, referenceLoading, referenceError, loadReferences, add, change, remove, discard, recheck, execute, reload: () => current.value ? loadScope(current.value) : Promise.resolve() }
}
