import type { AuxiliaryContractDraft, AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'
import type { AuxiliaryContractContext } from '~/lib/auxiliary-contract/repository'
import type { FormFooterAction } from '~/lib/master-data/page'
import { onBeforeRouteLeave } from 'vue-router'
import { AUXILIARY_LABELS, auxiliaryDetailPath, auxiliaryListPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'

export function useAuxiliaryContractForm(kind: () => AuxiliaryContractKind) {
  const route = useRoute()
  const repository = useNuxtApp().$repositories.auxiliaryContracts
  const store = useAuxiliaryContractCommandStore()
  const kit = useKitUI()
  const files = useContractFormAttachments()
  const key = route.fullPath
  const targetId = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const defaults = (): AuxiliaryContractDraft => ({ kind: kind(), name: '', category: kind() === 'company_expense' ? '房租' : '其他', paymentCycle: '一次性', status: '草稿', amount: null, taxRate: null })
  const draft = ref(defaults())
  const context = shallowRef<AuxiliaryContractContext | null>(null)
  const version = shallowRef<string | null>(null)
  const errors = shallowRef<Record<string, string>>({})
  const loadError = shallowRef('')
  const saveError = shallowRef('')
  const loading = ref(true)
  const loadingAction = shallowRef<FormFooterAction | null>(null)
  const saved = shallowRef('')
  const closeAfterSave = ref(true)
  const title = computed(() => `${targetId.value ? '编辑' : '新建'} · ${AUXILIARY_LABELS[kind()]}`)
  const dirty = computed(() => !loading.value && (JSON.stringify(draft.value) !== saved.value || files.dirty.value))
  const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo, 'real') ?? (targetId.value ? auxiliaryDetailPath(kind(), targetId.value) : auxiliaryListPath(kind())))
  let allowLeave = false
  let generation = 0
  async function initialize() {
    const current = ++generation
    loading.value = true
    loadError.value = ''
    saveError.value = ''
    try {
      if (route.query.origin && route.query.origin !== 'real')
        throw new Error('演示合同不可编辑')
      const [business, detail] = await Promise.all([repository.context(), targetId.value ? repository.detail(targetId.value, { kind: kind(), origin: 'real', includeDeleted: 'true' }) : null])
      if (current !== generation)
        return
      context.value = business
      draft.value = detail?.contract.draft ?? defaults()
      version.value = detail?.contract.version ?? null
      files.reset(detail?.attachments ?? [])
      saved.value = JSON.stringify(draft.value)
      errors.value = {}
    }
    catch (cause) {
      if (current === generation)
        loadError.value = cause instanceof Error ? cause.message : '读取失败'
    }
    finally {
      if (current === generation)
        loading.value = false
    }
  }
  const lookup = (field: 'projects' | 'suppliers') => async (keyword: string) => (context.value?.[field] ?? []).filter(row => row.label.includes(keyword.trim()))
  function patch(value: Partial<AuxiliaryContractDraft>) {
    draft.value = { ...draft.value, ...value }
    errors.value = {}
    saveError.value = ''
  }
  async function leave() {
    if (dirty.value && !await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前内容尚未保存，确认离开？', confirmLabel: '放弃修改' }))
      return
    allowLeave = true
    await navigateTo(backTo.value)
  }
  async function save(action: FormFooterAction) {
    if (action === 'cancel')
      return leave()
    if (!context.value || loadingAction.value)
      return
    if (action === 'saveSubmit' && !await kit.confirm({ variant: 'simple', title: '提交合同', message: '确认提交当前合同？', confirmLabel: '提交' }))
      return
    loadingAction.value = action
    try {
      const result = await store.save(key, { ...(targetId.value ? { id: targetId.value } : {}), workspaceId: context.value.workspaceId, actorId: context.value.actorId, requiredCapability: 'auxiliary-contract:write', baseVersion: version.value, action: action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save', draft: draft.value, attachments: files.changes() })
      saved.value = JSON.stringify(draft.value)
      files.clearPending()
      allowLeave = true
      kit.success('合同已保存')
      const detailReturn = targetId.value && backTo.value.startsWith(`${auxiliaryListPath(kind())}/${targetId.value}?`) ? backTo.value : `${auxiliaryDetailPath(kind(), result.id)}&returnTo=${encodeURIComponent(backTo.value)}`
      if (action === 'saveNew') {
        await navigateTo(`${auxiliaryListPath(kind())}/form`)
        await initialize()
      }
      else if (closeAfterSave.value) {
        await navigateTo(detailReturn)
      }
      else {
        await navigateTo(`${auxiliaryListPath(kind())}/form/${result.id}?returnTo=${encodeURIComponent(detailReturn)}`, { replace: true })
        await initialize()
      }
      allowLeave = false
    }
    catch (cause) {
      const problem = auxiliaryProblemFromUnknown(cause).problem
      saveError.value = problem.message
      errors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, values]) => [key, values[0] || '字段无效']))
      if (problem.code === 'conflict') {
        if (await kit.confirm({ variant: 'simple', title: '合同已有更新', message: '当前修改尚未覆盖服务器。载入最新版将替换当前内容。', confirmLabel: '载入最新版', cancelLabel: '保留我的内容' }))
          await initialize()
      }
      else {
        kit.error(problem.message)
        await nextTick()
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      }
    }
    finally { loadingAction.value = null }
  }
  onBeforeRouteLeave(async () => allowLeave || !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前内容尚未保存，确认离开？', confirmLabel: '放弃修改' }))
  watch(() => `${kind()}:${targetId.value}:${route.query.origin}`, () => void initialize(), { immediate: true })
  onBeforeUnmount(() => generation++)
  useTabTitle(title)
  return { draft, title, files, errors, loading, loadError, saveError, loadingAction, closeAfterSave, dirty, initialize, save, leave, patch, fetchProjects: lookup('projects'), fetchSuppliers: lookup('suppliers') }
}
