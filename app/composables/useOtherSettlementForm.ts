import type { ExpenseClearanceAllocationDTO, ExpenseClearanceLink, ExpenseClearanceSourceDTO } from '~/lib/finance/clearance-verification'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { onBeforeRouteLeave } from 'vue-router'
import { clearanceBindingEdit, emptyClearanceBindingInput } from '~/components/other-settlement/clearance-binding-input'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { isConfirmedExpenditureSettlement } from '~/lib/contract/effective-status'
import { commandVersionAtLeast } from '~/lib/forms/command-recovery'
import { createFormCommandActions } from '~/lib/forms/command-session'
import { OTHER_SETTLEMENT_PATH } from '~/lib/other-settlement/contract'
import { bindReadAuthority } from '~/lib/read-model/authority'

export function useOtherSettlementForm() {
  const route = useRoute()
  const router = useRouter()
  const kit = useKitUI()
  const repository = useNuxtApp().$repositories.otherSettlements
  const expectedLinkIds = shallowRef<string[]>([])
  const commandRepository = {
    ...repository,
    execute: async (request: Parameters<typeof repository.execute>[0]) => {
      const result = await repository.execute(request)
      expectedLinkIds.value = result.clearanceLinkIds ?? []
      return result
    },
    resolve: async (commandId: string) => {
      const result = await repository.resolve(commandId)
      if (result.outcome === 'applied')
        expectedLinkIds.value = result.result.clearanceLinkIds ?? []
      return result
    },
  }
  const latestConflict = shallowRef<Awaited<ReturnType<typeof repository.loadForm>> | null>(null)
  const actions = createFormCommandActions({ repository: () => commandRepository, capability: 'other-settlement:write' as const, problemFromUnknown: auxiliaryProblemFromUnknown, versionAtLeast: (current, original, evidence) => {
    if (commandVersionAtLeast(current, original))
      return true
    if (!/^(?:0|[1-9]\d*)$/.test(current) || !/^(?:0|[1-9]\d*)$/.test(original))
      return false
    const result = evidence.result
    if (result?.version === '0' && 'clearanceLinkIds' in result && Array.isArray(result.clearanceLinkIds) && result.clearanceLinkIds.length > 0 && result.clearanceLinkIds.every(id => typeof id === 'string' && id.length > 0))
      return BigInt(current) >= BigInt(original)
    return !result && current === '0' && original === '0' && evidence.form?.version === '0' && Boolean(evidence.form.expenseAllocations?.length)
  }, validateReadContext: (form) => {
    if (expectedLinkIds.value.some(id => !form.clearanceLinks?.some(link => link.id === id)))
      throw new Error('已保存的旧份额关联尚未可靠读取，请保留原编号，只重试读取')
  }, conflict: (latest) => {
    latestConflict.value = latest
    return new Error('结算已有更新；当前输入和原件已保留，请核对版本')
  } })
  const session = actions.createSession()
  const files = useContractFormAttachments()
  const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const context = computed(() => session.context)
  const version = computed(() => session.baseVersion)
  const draft = ref<OtherSettlementDraft>({})
  const expenses = shallowRef<ExpenseClearanceSourceDTO[]>([])
  const expenseAllocations = shallowRef<ExpenseClearanceAllocationDTO[]>([])
  const clearanceLinks = shallowRef<ExpenseClearanceLink[]>([])
  const bindingInput = ref(emptyClearanceBindingInput())
  const bindingDirty = computed(() => JSON.stringify(bindingInput.value) !== JSON.stringify(emptyClearanceBindingInput()))
  const loading = shallowRef(true)
  const loadError = shallowRef('')
  const saveError = shallowRef('')
  const expenseError = shallowRef('')
  const errors = shallowRef<Record<string, string>>({})
  const saved = shallowRef('')
  const hydrated = shallowRef(false)
  const frozen = shallowRef(false)
  const loadingAction = shallowRef<FormFooterAction | null>(null)
  const closeAfterSave = shallowRef(true)
  const ordinaryDirty = computed(() => saved.value !== JSON.stringify(draft.value) || files.dirty.value)
  const dirty = computed(() => hydrated.value && !loading.value && (ordinaryDirty.value || bindingDirty.value))
  const savedId = computed(() => id.value ?? session.targetId)
  const title = computed(() => `${savedId.value ? '编辑' : '新建'} · 其他支出结算`)
  const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo) ?? (savedId.value ? `${OTHER_SETTLEMENT_PATH}/${savedId.value}?origin=real` : OTHER_SETTLEMENT_PATH))
  const selectedContract = computed(() => context.value?.contracts.find(c => c.id === draft.value.contractId && c.projectId === draft.value.projectId))
  const fetchProjects = async (keyword: string) => context.value?.projects.filter(row => row.label.includes(keyword)) ?? []
  const fetchContracts = async (keyword: string) => context.value?.contracts.filter(c => c.projectId === draft.value.projectId && c.name.includes(keyword)).map(c => ({ id: c.id, label: c.name })) ?? []
  const canSave = computed(() => !frozen.value && !session.pending && !session.busy && !files.readingFiles.value && context.value?.capabilities.includes('other-settlement:write') === true)
  let generation = 0
  let allowLeave = false
  let retainRoute = false
  let active = true
  let submitted: string | null = null
  let submittedFiles: ReturnType<typeof files.capture> | null = null
  let submittedBinding: string | null = null
  const inputs = () => JSON.stringify({ draft: draft.value, files: files.capture(), bindingInput: bindingInput.value })
  async function canonicalTarget(target: string) {
    if (id.value === target || session.targetId !== target || dirty.value)
      return
    retainRoute = true
    const previousAllowLeave = allowLeave
    allowLeave = true
    try {
      await router.replace(`${OTHER_SETTLEMENT_PATH}/form/${target}?origin=real`)
    }
    finally {
      allowLeave = previousAllowLeave
    }
  }
  function adopt(form: Awaited<ReturnType<typeof repository.loadForm>>, replace: boolean) {
    frozen.value = isConfirmedExpenditureSettlement(form.draft.status ?? '') || form.version === '0'
    saved.value = JSON.stringify(form.draft)
    expenseAllocations.value = form.expenseAllocations ?? []
    clearanceLinks.value = form.clearanceLinks ?? []
    if (replace) {
      draft.value = form.draft
      files.reset(form.attachments)
    }
    else if (submittedFiles) {
      files.acknowledge(form.attachments, submittedFiles)
    }
    submittedFiles = null
    errors.value = {}
    saveError.value = ''
    hydrated.value = true
  }
  async function reloadExpenses() {
    const current = generation
    try {
      const result = await repository.expenses()
      if (!active || current !== generation)
        return
      if (result.workspaceId !== context.value?.workspaceId || result.actorId !== context.value.actorId)
        throw new Error('原费用目录与当前结算身份不一致')
      expenses.value = result.items
      expenseError.value = ''
    }
    catch (cause) {
      if (!active || current !== generation)
        return
      expenses.value = []
      expenseError.value = auxiliaryProblemFromUnknown(cause).problem.message
    }
  }
  async function initialize(retain = false) {
    const current = ++generation
    loading.value = true
    loadError.value = ''
    if (!retain) {
      bindingInput.value = emptyClearanceBindingInput()
      expectedLinkIds.value = []
    }
    try {
      if (route.query.origin && route.query.origin !== 'real')
        throw new Error('该来源不可编辑')
      const result = retain ? await actions.revalidate(session) : await actions.hydrate(session, id.value)
      if (!active || current !== generation)
        return
      if (result.form) {
        adopt(result.form, !retain)
        if (frozen.value && !retain && (result.form.draft.contractId || !result.form.expenseAllocations?.length)) {
          allowLeave = true
          await router.replace(`${OTHER_SETTLEMENT_PATH}/${result.form.draft.id}?origin=real`)
          allowLeave = false
          return
        }
        if (result.form.draft.id !== id.value)
          await canonicalTarget(result.form.draft.id)
      }
      else if (!retain) {
        frozen.value = false
        const source = result.context.contracts.find(c => c.id === route.query.contractId)
        draft.value = { projectId: source?.projectId ?? null, contractId: source?.id ?? null, supplierId: source?.supplierId ?? null, totalAmount: null, taxRate: null, settlementType: '过程结算', status: 'draft', originalExpenses: [] }
        saved.value = JSON.stringify(draft.value)
        files.reset()
        hydrated.value = true
      }
      await reloadExpenses()
    }
    catch (cause) {
      if (current === generation)
        loadError.value = auxiliaryProblemFromUnknown(cause).problem.message
    }
    finally {
      if (current === generation)
        loading.value = false
    }
  }
  function patch(value: Partial<OtherSettlementDraft>) {
    const next = { ...draft.value, ...value }
    if ('projectId' in value && value.projectId !== draft.value.projectId) {
      next.contractId = null
      next.supplierId = null
      next.originalExpenses = []
      next.payeeSupplierId = null
      next.payeeWorkerId = null
      next.payeeNameSnapshot = null
      next.totalAmount = null
    }
    if ('contractId' in value) {
      next.supplierId = context.value?.contracts.find(c => c.id === value.contractId && c.projectId === next.projectId)?.supplierId ?? null
      next.originalExpenses = []
      next.payeeSupplierId = null
      next.payeeWorkerId = null
      next.payeeNameSnapshot = null
      next.totalAmount = null
    }
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
    if (!canSave.value || loadingAction.value || loading.value)
      return
    const confirming = draft.value.status === 'pending'
    if (action === 'saveSubmit' && !await kit.confirm({ variant: 'simple', title: confirming ? '确认结算' : '提交结算', message: confirming ? '确认后来源、收款身份、金额和原件将冻结。确认结算不会自动产生银行付款。' : '提交后进入待确认状态。', confirmLabel: confirming ? '确认结算' : '提交' }))
      return
    const current = generation
    const input = inputs()
    submitted = input
    submittedFiles = files.capture()
    loadingAction.value = action
    try {
      const result = await actions.saveForm(session, draft.value, action === 'draft' ? 'draft' : action === 'saveSubmit' ? confirming ? 'confirm' : 'submit' : 'save', files.changes())
      if (!active || current !== generation)
        return
      const retained = input !== inputs()
      adopt(result.form, !retained)
      if (retained) {
        kit.success('原提交已保存并读回，后来的输入仍保留')
        return
      }
      kit.success('结算已保存并读取确认')
      const previousAllowLeave = allowLeave
      allowLeave = true
      try {
        if (action === 'saveNew') {
          actions.startNew(session)
          await router.push(`${OTHER_SETTLEMENT_PATH}/form`)
          await initialize()
        }
        else if (closeAfterSave.value || confirming) {
          await router.push(`${OTHER_SETTLEMENT_PATH}/${result.id}?origin=real`)
        }
        else {
          await canonicalTarget(result.id)
        }
      }
      finally {
        allowLeave = previousAllowLeave
      }
    }
    catch (cause) {
      if (active && current === generation) {
        const problem = auxiliaryProblemFromUnknown(cause).problem
        saveError.value = problem.message
        errors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, values]) => [key, values[0] ?? '字段无效']))
        await nextTick()
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      }
    }
    finally {
      if (current === generation)
        loadingAction.value = null
    }
  }
  async function recover() {
    const current = generation
    const input = inputs()
    try {
      const result = await actions.recover(session)
      if (!active || current !== generation)
        return
      if (result.outcome === 'applied' && result.form) {
        const retained = (submitted !== null && input !== submitted) || input !== inputs()
        adopt(result.form, !retained)
        if (submittedBinding === JSON.stringify(bindingInput.value))
          bindingInput.value = emptyClearanceBindingInput()
        submittedBinding = null
        await reloadExpenses()
        if (!active || current !== generation)
          return
        if (!retained)
          await canonicalTarget(result.result.id)
      }
      if (!active || current !== generation)
        return
      saveError.value = ''
      loadError.value = ''
      kit.success(result.outcome === 'applied' ? '原提交已保存并读取确认' : '原编号已封存为未保存，当前输入可重新明确提交')
    }
    catch (cause) {
      if (active && current === generation)
        saveError.value = auxiliaryProblemFromUnknown(cause).problem.message
    }
  }
  async function saveClearanceLink() {
    if (!frozen.value || !savedId.value || ordinaryDirty.value || loading.value || session.pending || session.busy || loadError.value || context.value?.capabilities.includes('other-settlement:write') !== true)
      return
    const edit = clearanceBindingEdit(bindingInput.value)
    if (!edit) {
      kit.warning('请选择真实采用行与已核旧份额，并明确填写正金额；空值和自由编号不能作为关联。')
      return
    }
    const current = generation
    submitted = inputs()
    submittedBinding = JSON.stringify(bindingInput.value)
    submittedFiles = files.capture()
    loadingAction.value = 'save'
    try {
      const result = await actions.saveForm(session, { id: savedId.value, clearanceLinkEdit: edit }, 'save', {})
      if (!active || current !== generation)
        return
      adopt(result.form, false)
      if (submittedBinding === JSON.stringify(bindingInput.value))
        bindingInput.value = emptyClearanceBindingInput()
      submittedBinding = null
      await reloadExpenses()
      if (!active || current !== generation)
        return
      kit.success('旧份额关联已保存并读取确认；原已确认正文和现金保持原事实')
    }
    catch (cause) {
      if (active && current === generation)
        saveError.value = auxiliaryProblemFromUnknown(cause).problem.message
    }
    finally {
      if (active && current === generation)
        loadingAction.value = null
    }
  }
  async function adoptLatest() {
    if (!latestConflict.value || !await kit.confirm({ variant: 'simple', title: '采用最新版本', message: '当前输入和待上传原件将被替换；请先核对新旧资料。', confirmLabel: '采用最新版本', cancelLabel: '保留我的内容' }))
      return
    actions.adoptConflictVersion(session, latestConflict.value)
    adopt(latestConflict.value, true)
    bindingInput.value = emptyClearanceBindingInput()
    latestConflict.value = null
    await reloadExpenses()
  }
  bindReadAuthority((problem) => {
    generation++
    actions.invalidate(session)
    files.invalidatePreparation()
    expenses.value = []
    expenseAllocations.value = []
    clearanceLinks.value = []
    latestConflict.value = null
    loadError.value = problem.message
    loading.value = false
  })
  onBeforeRouteLeave(async () => allowLeave || !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前结算尚未保存，确认离开？', confirmLabel: '放弃修改' }))
  watch(() => `${id.value}:${route.query.origin}`, () => {
    if (retainRoute) {
      retainRoute = false
      return
    }
    void initialize()
  }, { immediate: true })
  onBeforeUnmount(() => {
    active = false
    generation++
    actions.invalidate(session)
    files.invalidatePreparation()
  })
  useTabCloseGuard(async () => allowLeave || !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前结算尚未保存，确认关闭？', confirmLabel: '放弃修改' }))
  useTabTitle(title)
  return { draft, context, title, files, version, loading, loadError, saveError, expenseError, expenses, reloadExpenses, errors, loadingAction, closeAfterSave, dirty, ordinaryDirty, bindingInput, expenseAllocations, clearanceLinks, saveClearanceLink, selectedContract, fetchProjects, fetchContracts, patch, initialize, leave, save, session, canSave, frozen, recover, latestConflict, adoptLatest }
}
