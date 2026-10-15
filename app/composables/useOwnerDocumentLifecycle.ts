import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import type { FileRefChanges } from '~/lib/forms/file-refs'
import type {
  AcceptanceLifecycleTarget,
  OwnerDocumentDraft,
  OwnerDocumentKind,
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
  acceptanceAttachments?: () => FileRefChanges
  clearAcceptanceAttachments?: () => void
}

export function useOwnerDocumentLifecycle(options: OwnerDocumentLifecycleOptions) {
  const store = useOwnerDocumentStore()
  const { confirm, success, warning, error } = useKitUI()
  const loading = shallowRef(false)

  const kind = computed(() => toValue(options.kind))
  const status = computed(() => String(options.draft.value.status ?? 'draft'))
  const auditMode = computed(() =>
    kind.value === 'owner_report' && status.value === 'reported',
  )
  const canApproveChange = computed(() =>
    kind.value === 'owner_change' && status.value === 'submitted',
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
    const requiredFields: Record<AcceptanceLifecycleTarget, Array<[keyof OwnerDocumentDraft, string]>> = {
      accepted: [
        ['acceptanceOrganization', '验收单位'],
        ['acceptancePerson', '验收人'],
        ['acceptanceDate', '验收日期'],
        ['acceptanceConclusion', '验收结论'],
      ],
      warranty: [
        ['warrantyOwner', '保修责任单位'],
        ['warrantyStartDate', '保修开始日期'],
        ['warrantyEndDate', '保修结束日期'],
      ],
      expired: [
        ['warrantyConfirmationOrganization', '到期验收单位'],
        ['warrantyConfirmationDate', '到期确认日期'],
        ['warrantyConfirmationNote', '到期确认结论'],
      ],
    }
    const missing = requiredFields[action.target]
      .find(([field]) => !String(options.draft.value[field] ?? '').trim())
    if (missing) {
      warning(`请先填写${missing[1]}`)
      return
    }
    if (action.target === 'warranty'
      && String(options.draft.value.warrantyEndDate) < String(options.draft.value.warrantyStartDate)) {
      warning('保修结束日期不能早于开始日期')
      return
    }
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
      await store.transitionAcceptance(
        id,
        action.target,
        options.draft.value,
        options.acceptanceAttachments?.() ?? {},
      )
      options.clearAcceptanceAttachments?.()
      success(`${action.label}成功`)
      await (options.complete?.() ?? options.refresh())
    }
    catch (cause) {
      if (await options.recoverConflict?.(cause))
        return
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

  return {
    loading,
    auditMode,
    canApproveChange,
    acceptanceAction,
    approveChange,
    moveAcceptance,
    auditReport,
  }
}
