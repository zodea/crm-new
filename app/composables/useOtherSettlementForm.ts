import type { FormFooterAction } from '~/lib/master-data/page'
import type { OtherSettlementContext, OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { onBeforeRouteLeave } from 'vue-router'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { OTHER_SETTLEMENT_PATH } from '~/lib/other-settlement/contract'

export function useOtherSettlementForm() {
  const route = useRoute()
  const repository = useNuxtApp().$repositories.otherSettlements
  const store = useOtherSettlementCommandStore()
  const kit = useKitUI()
  const files = useContractFormAttachments()
  const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const context = shallowRef<OtherSettlementContext | null>(null)
  const draft = ref<OtherSettlementDraft>({})
  const version = shallowRef<string | null>(null)
  const loading = shallowRef(true)
  const loadError = shallowRef('')
  const saveError = shallowRef('')
  const errors = shallowRef<Record<string, string>>({})
  const saved = shallowRef('')
  const loadingAction = shallowRef<FormFooterAction | null>(null)
  const closeAfterSave = shallowRef(true)
  const dirty = computed(() => !loading.value && (saved.value !== JSON.stringify(draft.value) || files.dirty.value))
  const title = computed(() => `${id.value ? '编辑' : '新建'} · 其他支出结算`)
  const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo) ?? (id.value ? `${OTHER_SETTLEMENT_PATH}/${id.value}?origin=real` : OTHER_SETTLEMENT_PATH))
  const selectedContract = computed(() => context.value?.contracts.find(c => c.id === draft.value.contractId && c.projectId === draft.value.projectId))
  const fetchProjects = async (keyword: string) => context.value?.projects.filter(row => row.label.includes(keyword)) ?? []
  const fetchContracts = async (keyword: string) => context.value?.contracts.filter(c => c.projectId === draft.value.projectId && c.name.includes(keyword)).map(c => ({ id: c.id, label: c.name })) ?? []
  let generation = 0
  let allowLeave = false
  async function initialize() {
    const current = ++generation
    loading.value = true
    loadError.value = ''
    try {
      if (route.query.origin && route.query.origin !== 'real')
        throw new Error('该来源不可编辑')
      const [business, detail] = await Promise.all([repository.context(), id.value ? repository.detail(id.value, { origin: 'real', includeDeleted: 'true' }) : null])
      if (generation !== current)
        return
      if (detail?.settlement.draft.status === 'confirmed')
        throw new Error('已确认结算只读，不可编辑')
      context.value = business
      const source = business.contracts.find(c => c.id === route.query.contractId)
      draft.value = detail?.settlement.draft ?? { projectId: source?.projectId ?? null, contractId: source?.id ?? null, supplierId: source?.supplierId ?? null, totalAmount: null, taxRate: null, settlementType: '过程结算', status: 'draft' }
      version.value = detail?.settlement.version ?? null
      files.reset(detail?.attachments ?? [])
      saved.value = JSON.stringify(draft.value)
      errors.value = {}
      saveError.value = ''
    }
    catch (cause) {
      if (generation === current)
        loadError.value = cause instanceof Error ? cause.message : '读取失败'
    }
    finally {
      if (generation === current)
        loading.value = false
    }
  }
  function patch(value: Partial<OtherSettlementDraft>) {
    const next = { ...draft.value, ...value }
    if ('projectId' in value && value.projectId !== draft.value.projectId) {
      next.contractId = null
      next.supplierId = null
    }
    if ('contractId' in value)
      next.supplierId = context.value?.contracts.find(c => c.id === value.contractId && c.projectId === next.projectId)?.supplierId ?? null
    draft.value = next
    errors.value = {}
    saveError.value = ''
  }
  async function leave() {
    if (dirty.value && !await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前结算尚未保存，确认离开？', confirmLabel: '放弃修改' }))
      return
    allowLeave = true
    await navigateTo(backTo.value)
  }
  async function save(action: FormFooterAction) {
    if (action === 'cancel')
      return leave()
    if (!context.value || loadingAction.value)
      return
    const confirming = draft.value.status === 'pending'
    if (action === 'saveSubmit' && !await kit.confirm({ variant: 'simple', title: confirming ? '确认结算' : '提交结算', message: confirming ? '确认后结算将锁定，不能继续修改。' : '提交后进入待确认状态，确认后将锁定结算。', confirmLabel: confirming ? '确认结算' : '提交' }))
      return
    loadingAction.value = action
    try {
      const result = await store.save(route.fullPath, { ...(id.value ? { id: id.value } : {}), workspaceId: context.value.workspaceId, actorId: context.value.actorId, requiredCapability: 'other-settlement:write', baseVersion: version.value, action: action === 'draft' ? 'draft' : action === 'saveSubmit' ? confirming ? 'confirm' : 'submit' : 'save', draft: draft.value, attachments: files.changes() })
      saved.value = JSON.stringify(draft.value)
      files.clearPending()
      allowLeave = true
      kit.success('结算已保存')
      await navigateTo(id.value && backTo.value.startsWith(`${OTHER_SETTLEMENT_PATH}/${id.value}?`) ? backTo.value : `${OTHER_SETTLEMENT_PATH}/${result.id}?origin=real&returnTo=${encodeURIComponent(backTo.value)}`)
      allowLeave = false
    }
    catch (cause) {
      const problem = auxiliaryProblemFromUnknown(cause).problem
      saveError.value = problem.message
      errors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, values]) => [key, values[0] ?? '字段无效']))
      if (problem.code === 'conflict' && await kit.confirm({ variant: 'simple', title: '结算已有更新', message: '载入最新版将替换当前输入；尚未覆盖服务器内容。', confirmLabel: '载入最新版', cancelLabel: '保留我的内容' }))
        await initialize()
      await nextTick()
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
    finally {
      loadingAction.value = null
    }
  }
  onBeforeRouteLeave(async () => allowLeave || !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前结算尚未保存，确认离开？', confirmLabel: '放弃修改' }))
  watch(() => `${id.value}:${route.query.origin}`, initialize, { immediate: true })
  onBeforeUnmount(() => generation++)
  useTabTitle(title)
  return { draft, context, title, files, version, loading, loadError, saveError, errors, loadingAction, closeAfterSave, dirty, selectedContract, fetchProjects, fetchContracts, patch, initialize, leave, save }
}
