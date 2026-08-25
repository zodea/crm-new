import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import type {
  AcceptanceLifecycleTarget,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  PenaltyDeductionView,
} from '~/lib/owner-document/forms'
import { computed, shallowRef, toValue } from 'vue'
import { ownerDocumentLocalDate } from '~/lib/owner-document/page'
import { toErrorMessage } from '~/lib/util/error'

interface OwnerDocumentLifecycleOptions {
  kind: MaybeRefOrGetter<OwnerDocumentKind>
  draft: Ref<OwnerDocumentDraft>
  routeId: ComputedRef<string | undefined>
  label: ComputedRef<string>
  refresh: () => Promise<void>
  complete?: () => Promise<void>
  recoverConflict?: (cause: unknown) => Promise<boolean>
}

export function useOwnerDocumentLifecycle(options: OwnerDocumentLifecycleOptions) {
  const store = useOwnerDocumentStore()
  const { confirm, success, warning, error } = useKitUI()
  const loading = shallowRef(false)
  const penaltyDeductions = shallowRef<PenaltyDeductionView[]>([])
  const deductionSettlementId = shallowRef<string | null>(null)
  const deductionAmount = shallowRef<number | null>(null)
  const deductionNote = shallowRef('')

  const kind = computed(() => toValue(options.kind))
  const status = computed(() => String(options.draft.value.status ?? 'draft'))
  const auditMode = computed(() =>
    kind.value === 'owner_report' && status.value === 'reported',
  )
  const canApproveChange = computed(() =>
    kind.value === 'owner_change' && status.value === 'submitted',
  )
  const canDeductPenalty = computed(() =>
    kind.value === 'project_penalty'
    && ['pending', 'repairing', 'repaired_self', 'repaired_other'].includes(status.value)
    && Number(
      options.draft.value.remainingDeductionAmount
      ?? options.draft.value.amount
      ?? 0,
    ) > 0,
  )
  const acceptanceAction = computed<{
    label: string
    message: string
    target: AcceptanceLifecycleTarget
  } | null>(() => {
    if (kind.value !== 'acceptance')
      return null
    if (status.value === 'submitted') {
      return {
        label: '确认验收',
        message: '确认验收结论后，单据进入已验收状态。',
        target: 'accepted',
      }
    }
    if (status.value === 'accepted') {
      return {
        label: '进入保修',
        message: '进入保修后，单据类型切换为保修并开始履约跟踪。',
        target: 'warranty',
      }
    }
    if (status.value === 'warranty') {
      return {
        label: '确认保修到期',
        message: '确认后将结束本单据的保修生命周期。',
        target: 'expired',
      }
    }
    return null
  })

  async function refreshDeductions(id?: string) {
    penaltyDeductions.value = id && kind.value === 'project_penalty'
      ? await store.loadDeductions(id)
      : []
  }

  async function fetchSettlements(keyword: string) {
    const projectId = typeof options.draft.value.projectId === 'string'
      ? options.draft.value.projectId
      : ''
    if (!projectId)
      return []
    return store.loadSettlementOptions(
      projectId,
      String(options.draft.value.supplierId ?? ''),
      String(options.draft.value.contractId ?? ''),
      keyword,
    )
  }

  async function approveChange() {
    const id = options.routeId.value
    if (!id)
      return
    const accepted = await confirm({
      variant: 'cascade',
      title: '确认甲方签证',
      message: '签证后将生成并锁定收入变更台账，量价事实不可直接回退。',
      requireTyping: String(
        options.draft.value.name
        ?? options.draft.value.no
        ?? options.label.value,
      ),
      impact: [
        { label: '锁定收入变更台账', n: 1 },
        { label: '变更明细', n: options.draft.value.lines?.length ?? 0 },
      ],
      confirmLabel: '确认签证',
    })
    if (!accepted)
      return
    loading.value = true
    try {
      const today = ownerDocumentLocalDate()
      await store.approveOwnerChange(id, today, options.draft.value)
      success('甲方签证已生效，收入变更台账已锁定')
      await (options.complete?.() ?? options.refresh())
    }
    catch (cause) {
      if (await options.recoverConflict?.(cause))
        return
      error(`签证失败：${toErrorMessage(cause)}`)
    }
    finally {
      loading.value = false
    }
  }

  async function moveAcceptance() {
    const id = options.routeId.value
    const action = acceptanceAction.value
    if (!id || !action)
      return
    const accepted = await confirm({
      variant: 'simple',
      title: action.label,
      message: action.message,
      confirmLabel: action.label,
    })
    if (!accepted)
      return
    loading.value = true
    try {
      await store.transitionAcceptance(id, action.target)
      success(`${action.label}成功`)
      await options.refresh()
    }
    catch (cause) {
      error(`${action.label}失败：${toErrorMessage(cause)}`)
    }
    finally {
      loading.value = false
    }
  }

  async function auditReport() {
    const id = options.routeId.value
    if (!id)
      return
    const sourceLines = options.draft.value.lines ?? []
    if (sourceLines.some(line => line.auditedQty == null
      || (typeof line.auditedQty === 'string' && !line.auditedQty.trim()))) {
      warning('请为每条报量明细填写有效的审定量')
      return
    }
    const lines = sourceLines.map(line => ({
      boqLineId: String(line.boqLineId ?? ''),
      auditedQty: Number(line.auditedQty),
      auditedAmount: (Number(line.auditedQty) || 0) * (Number(line.unitPrice) || 0),
    }))
    if (lines.some(line =>
      !line.boqLineId
      || !Number.isFinite(line.auditedQty)
      || line.auditedQty < 0,
    )) {
      warning('请为每条报量明细填写有效的审定量')
      return
    }
    const auditedAmount = lines.reduce((sum, line) => sum + line.auditedAmount, 0)
    const accepted = await confirm({
      variant: 'simple',
      title: '确认甲方审定',
      message: `本次审定金额 ¥${auditedAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}，确认后锁定审定量。`,
      confirmLabel: '确认审定',
    })
    if (!accepted)
      return
    loading.value = true
    try {
      await store.auditOwnerReport(id, { auditedAmount, lines }, options.draft.value)
      success('甲方报量已审定')
      await (options.complete?.() ?? options.refresh())
    }
    catch (cause) {
      if (await options.recoverConflict?.(cause))
        return
      error(`审定失败：${toErrorMessage(cause)}`)
    }
    finally {
      loading.value = false
    }
  }

  async function deductPenalty() {
    const id = options.routeId.value
    if (!id || !deductionSettlementId.value || !(Number(deductionAmount.value) > 0)) {
      warning('请选择结算单并填写大于 0 的抵扣金额')
      return
    }
    const accepted = await confirm({
      variant: 'cascade',
      title: '确认结算抵扣',
      message: `将在所选分包结算中抵扣 ¥${Number(deductionAmount.value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}，并保存独立抵扣关系。`,
      requireTyping: String(options.draft.value.no ?? options.label.value),
      impact: [
        { label: '项目罚扣记录', n: 1 },
        { label: '分包结算抵扣', n: 1 },
      ],
      confirmLabel: '执行抵扣',
    })
    if (!accepted)
      return
    loading.value = true
    try {
      await store.deductProjectPenalty(
        id,
        deductionSettlementId.value,
        Number(deductionAmount.value),
        deductionNote.value,
      )
      success('项目罚扣已写入结算抵扣')
      deductionSettlementId.value = null
      deductionAmount.value = null
      deductionNote.value = ''
      await options.refresh()
    }
    catch (cause) {
      error(`抵扣失败：${toErrorMessage(cause)}`)
    }
    finally {
      loading.value = false
    }
  }

  return {
    loading,
    penaltyDeductions,
    deductionSettlementId,
    deductionAmount,
    deductionNote,
    auditMode,
    canApproveChange,
    canDeductPenalty,
    acceptanceAction,
    refreshDeductions,
    fetchSettlements,
    approveChange,
    moveAcceptance,
    auditReport,
    deductPenalty,
  }
}
