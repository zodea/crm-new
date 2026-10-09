import type { PayrollAFormRead, PayrollAOutputRead, PayrollAReleaseDraft, PayrollAStatementCommandResult } from '~/lib/payroll/central-a-contract'
import type { PayrollReleaseAdjustmentApplication } from '~/lib/payroll/central-release-adjustment-contract'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { payrollReleaseDefault } from '~/lib/payroll/a-presentation'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { payrollNeedsRecheckMessage } from '~/lib/payroll/release-recheck-message'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollAFeesStore } from '~/stores/payroll-a-fees'

export function usePayrollAStatement(options: { id: () => string, origin: () => 'real' | 'demo', changed: () => void }) {
  const store = usePayrollStore()
  const kit = useKitUI()
  const read = shallowRef<PayrollAFormRead | null>(null)
  const latest = shallowRef<PayrollAFormRead | null>(null)
  const output = shallowRef<PayrollAOutputRead | null>(null)
  const active = shallowRef(true)
  const loading = shallowRef(false)
  const readFailed = shallowRef(false)
  const working = shallowRef(false)
  const error = shallowRef('')
  const releaseOpen = shallowRef(false)
  const releaseRead = shallowRef<PayrollAFormRead | null>(null)
  const releaseDraft = shallowRef<PayrollAReleaseDraft | null>(null)
  const ratio = shallowRef<number | null>(null)
  const target = () => JSON.stringify([options.id(), options.origin()])
  const matching = computed(() => read.value?.statementId === options.id() && read.value.context.origin === options.origin() ? read.value : null)
  const pending = computed(() => matching.value ? store.getAPending(matching.value) : null)
  const feesPending = computed(() => matching.value && hasPayrollAFeesForm(matching.value) ? usePayrollAFeesStore().getPending(matching.value) : null)
  const busy = computed(() => loading.value || working.value)
  const writable = computed(() => {
    const value = latest.value ?? matching.value
    return !!matching.value && !!value && (!hasPayrollAFeesForm(value) || (!!value.fees && value.bookProof.state === 'proven')) && !value.context.readonly && value.status !== 'released' && value.context.capabilities.includes('payroll:write') && options.origin() === 'real' && !readFailed.value && !pending.value && !feesPending.value && !busy.value
  })
  let sequence = 0
  let started = false
  const same = (requested: string, request: number) => active.value && requested === target() && request === sequence
  async function load(replace = false) {
    const requested = target()
    const request = ++sequence
    started = true
    loading.value = true
    readFailed.value = false
    output.value = null
    error.value = ''
    try {
      const value = await store.loadAForm({ origin: options.origin() }, { statementId: options.id() })
      if (!same(requested, request))
        return
      if (value.statementId !== options.id() || value.context.origin !== options.origin())
        throw new Error('工资核对目标与当前来源不一致。')
      if (matching.value && (pending.value || releaseOpen.value || ratio.value !== matching.value.draft.payRatio) && !replace) {
        latest.value = value
      }
      else {
        read.value = value
        latest.value = null
        ratio.value = value.draft.payRatio ?? null
      }
      const operation = store.getAPending(value)
      if (!operation?.restoredFromDescriptor && operation?.command.action.kind === 'release-a' && !releaseOpen.value) {
        releaseRead.value = matching.value ?? value
        releaseDraft.value = operation.command.action.release
        releaseOpen.value = true
      }
      if (value.status === 'released') {
        const result = await store.loadAOutput({ origin: options.origin() }, options.id())
        if (same(requested, request) && result.statementId === options.id() && result.context.origin === options.origin())
          output.value = result
      }
      else {
        output.value = null
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
  async function completed(result: PayrollAStatementCommandResult, requested: string, request: number) {
    if (!same(requested, request) || result.statementId !== options.id())
      return
    const operation = pending.value
    const nextRequest = sequence + 1
    await load(true)
    if (!same(requested, nextRequest) || readFailed.value || !matching.value)
      return
    try {
      if (!operation)
        throw new Error('原提交未能核对，请保留输入并重新读取。')
      store.acknowledgeA(operation, matching.value, output.value ?? undefined)
    }
    catch (cause) {
      error.value = toErrorMessage(cause)
      return
    }
    releaseOpen.value = false
    releaseRead.value = null
    if (result.outcome === 'released')
      releaseDraft.value = null
    options.changed()
    if (result.outcome === 'needs-recheck')
      error.value = payrollNeedsRecheckMessage('来源或此前已付', matching.value)
    else
      kit.success(result.outcome === 'released' ? '实际发放已保存，工资资料已冻结。' : '工资核对结果已保存。')
  }
  async function execute(kind: 'check' | 'ratio' | 'release', release?: PayrollAReleaseDraft) {
    const value = kind === 'release' ? releaseRead.value : matching.value
    if (!value || !writable.value || (kind === 'check' && !value.eligibility.canCheck) || (kind === 'release' && !value.eligibility.canRelease))
      return
    const requested = target()
    const request = sequence
    working.value = true
    error.value = ''
    if (release)
      releaseDraft.value = release
    try {
      const result = kind === 'check' ? await store.checkA(value) : kind === 'ratio' ? await store.setAPayRatio(value, ratio.value) : await store.releaseA(value, release!)
      if (same(requested, request)) {
        working.value = false
        await completed(result, requested, request)
      }
    }
    catch (cause) {
      if (same(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (same(requested, request))
        working.value = false
    }
  }
  function setReleaseApplications(applications: PayrollReleaseAdjustmentApplication[]) {
    if (!matching.value || !writable.value || releaseOpen.value)
      return
    const value = releaseDraft.value ?? payrollReleaseDefault(matching.value)
    releaseDraft.value = { ...value, adjustmentApplications: applications }
  }
  function openRelease() {
    if (!matching.value?.eligibility.canRelease || !writable.value)
      return
    releaseRead.value = matching.value
    releaseDraft.value ??= payrollReleaseDefault(matching.value)
    releaseOpen.value = true
  }
  async function recover() {
    const operation = pending.value
    if (!operation || busy.value)
      return
    const requested = target()
    const request = sequence
    working.value = true
    try {
      const result = await store.recoverA(operation)
      if (same(requested, request) && result.statementId === options.id() && result.projectId === operation.command.projectId && operation.command.origin === options.origin()) {
        working.value = false
        await completed({ ...result, statementId: result.statementId }, requested, request)
      }
    }
    catch (cause) {
      if (same(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (same(requested, request))
        working.value = false
    }
  }
  watch(target, () => {
    if (active.value) {
      read.value = null
      latest.value = null
      output.value = null
      releaseRead.value = null
      releaseDraft.value = null
      releaseOpen.value = false
      void load()
    }
  }, { immediate: true })
  onDeactivated(() => {
    active.value = false
    sequence += 1
    loading.value = false
    working.value = false
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
  return { read, matching, latest, output, active, loading, working, busy, error, writable, pending, feesPending, ratio, releaseOpen, releaseRead, releaseDraft, load, execute, openRelease, setReleaseApplications, recover }
}
