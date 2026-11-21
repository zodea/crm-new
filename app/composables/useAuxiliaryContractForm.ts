import type { AuxiliaryContractDraft, AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'
import type { AuxiliaryContractContext, AuxiliaryContractFormRead } from '~/lib/auxiliary-contract/repository'
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { FormFooterAction } from '~/lib/master-data/page'
import { onBeforeRouteLeave } from 'vue-router'
import { AUXILIARY_LABELS, auxiliaryDetailPath, auxiliaryListPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { signatorySnapshot } from '~/lib/our-signatory/contract'
import { bindReadAuthority } from '~/lib/read-model/authority'

/** Keep subsequent edits, while identity and lifecycle always come from the acknowledged owner. */
export function mergeAuxiliaryAcknowledgedDraft(current: AuxiliaryContractDraft, sent: AuxiliaryContractDraft, stored: AuxiliaryContractFormRead['draft']) {
  const result: AuxiliaryContractDraft & { id: string } = { ...stored }
  for (const key of new Set([...Object.keys(current), ...Object.keys(sent)])) {
    if (['id', 'kind', 'status'].includes(key))
      continue
    const field = key as keyof AuxiliaryContractDraft
    if (JSON.stringify(current[field]) !== JSON.stringify(sent[field]))
      Object.assign(result, { [field]: current[field] })
  }
  return result
}

export function useAuxiliaryContractForm(kind: () => AuxiliaryContractKind) {
  const route = useRoute()
  const store = useAuxiliaryContractCommandStore()
  const commands = store.forKind(kind())
  const session = commands.createSession()
  const kit = useKitUI()
  const files = useContractFormAttachments()
  const targetId = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const defaults = (): AuxiliaryContractDraft => ({ kind: kind(), name: '', category: kind() === 'company_expense' ? '房租' : '其他', paymentCycle: '一次性', status: '草稿', amount: null, taxRate: null })
  const draft = ref(defaults())
  const context = shallowRef<AuxiliaryContractContext | null>(null)
  const usesConstructionMain = computed(() => context.value?.constructionMains !== undefined)
  const version = shallowRef<string | null>(null)
  const constructionMain = shallowRef<ConstructionMainSelection | null>(null)
  const errors = shallowRef<Record<string, string>>({})
  const loadError = shallowRef('')
  const saveError = shallowRef('')
  const loading = ref(true)
  const loadingAction = shallowRef<FormFooterAction | null>(null)
  const saved = shallowRef('')
  const savedMain = shallowRef('null')
  const closeAfterSave = ref(true)
  const title = computed(() => `${targetId.value ? '编辑' : '新建'} · ${AUXILIARY_LABELS[kind()]}`)
  const dirty = computed(() => !loading.value && (JSON.stringify(draft.value) !== saved.value || JSON.stringify(constructionMain.value) !== savedMain.value || files.dirty.value))
  const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo, 'real') ?? (targetId.value ? auxiliaryDetailPath(kind(), targetId.value) : auxiliaryListPath(kind())))
  let allowLeave = false
  let generation = 0
  let submitted: { draft: AuxiliaryContractDraft, main: ConstructionMainSelection | null, attachments: ReturnType<typeof files.capture> } | null = null
  const pending = computed(() => session.pending !== null)
  const pendingCommandId = computed(() => session.pending?.id ?? null)
  function adoptForm(form: AuxiliaryContractFormRead) {
    draft.value = form.draft
    constructionMain.value = form.constructionMain ?? null
    version.value = form.version
    files.reset(form.attachments)
    saved.value = JSON.stringify(draft.value)
    savedMain.value = JSON.stringify(constructionMain.value)
  }
  function acknowledgeForm(form: AuxiliaryContractFormRead) {
    if (!submitted) {
      adoptForm(form)
      return
    }
    const retainedMain = JSON.stringify(constructionMain.value) !== JSON.stringify(submitted.main)
    draft.value = mergeAuxiliaryAcknowledgedDraft(draft.value, submitted.draft, form.draft)
    if (!retainedMain)
      constructionMain.value = form.constructionMain ?? null
    version.value = form.version
    files.acknowledge(form.attachments, submitted.attachments)
    saved.value = JSON.stringify(form.draft)
    savedMain.value = JSON.stringify(form.constructionMain ?? null)
    submitted = null
  }
  bindReadAuthority((problem) => {
    generation++
    commands.invalidate(session)
    context.value = null
    loadError.value = problem.message
    loading.value = false
  })
  async function initialize() {
    const current = ++generation
    loading.value = true
    loadError.value = ''
    saveError.value = ''
    try {
      if (route.query.origin && route.query.origin !== 'real')
        throw new Error('演示合同不可编辑')
      const read = await commands.hydrate(session, targetId.value)
      if (current !== generation)
        return
      context.value = read.context
      if (read.form) {
        if (submitted && read.recoveryOutcome === 'applied')
          acknowledgeForm(read.form)
        else if (!submitted)
          adoptForm(read.form)
      }
      else if (!submitted) {
        draft.value = defaults()
        constructionMain.value = null
        version.value = null
        files.reset()
      }
      if (!submitted && !read.recovered) {
        saved.value = JSON.stringify(draft.value)
        savedMain.value = JSON.stringify(constructionMain.value)
      }
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
  const fetchMains = async (keyword: string) => (context.value?.constructionMains ?? []).map(row => ({ id: row.id, label: `${row.projectName} · ${row.name}${row.no ? ` · ${row.no}` : ''}`, hint: row.no || '主合同编号未记录' })).filter(row => row.id === keyword || row.label.includes(keyword.trim()))
  const fetchSignatories = async (keyword: string) => {
    const values = (context.value?.ourSignatories ?? []).filter(row => row.draft.status === 'active').map(row => ({ id: row.id, label: row.draft.name, hint: `核实版本 ${row.version}` }))
    const snapshot = draft.value.ourSignatorySnapshot
    if (snapshot && !values.some(row => row.id === snapshot.id))
      values.push({ id: snapshot.id, label: snapshot.name, hint: `原文书版本 ${snapshot.version}` })
    return values.filter(row => row.id === keyword || row.label.includes(keyword.trim()))
  }
  function selectMain(id: string | null) {
    if (pending.value)
      return
    const selected = (context.value?.constructionMains ?? []).find(row => row.id === id)
    constructionMain.value = selected ? { id: selected.id, projectId: selected.projectId, basis: selected.basis } : null
    patch({ projectId: selected?.projectId ?? null })
  }
  function selectSignatory(id: string | null) {
    if (pending.value)
      return
    if (id && draft.value.ourSignatorySnapshot?.id === id)
      return
    const selected = (context.value?.ourSignatories ?? []).find(row => row.id === id && row.draft.status === 'active')
    patch({ ourSignatoryId: selected?.id ?? null, ourSignatoryVersion: selected?.version ?? null, ourSignatorySnapshot: selected ? signatorySnapshot(selected) : null })
  }
  function patch(value: Partial<AuxiliaryContractDraft>) {
    if (pending.value)
      return
    draft.value = { ...draft.value, ...value }
    errors.value = {}
    saveError.value = ''
  }
  async function leave() {
    if ((dirty.value || pending.value) && !await kit.confirm({ variant: 'simple', title: '放弃修改', message: pending.value ? '原提交仍需核对，编号会保留；离开会丢失本页输入。确认离开？' : '当前内容尚未保存，确认离开？', confirmLabel: '放弃修改' }))
      return
    allowLeave = true
    await navigateTo(backTo.value)
  }
  async function save(action: FormFooterAction) {
    if (action === 'cancel')
      return leave()
    if (!context.value || loadingAction.value || pending.value || files.readingFiles.value)
      return
    if (action === 'saveSubmit' && !await kit.confirm({ variant: 'simple', title: '提交合同', message: '确认提交当前合同？', confirmLabel: '提交' }))
      return
    loadingAction.value = action
    submitted = { draft: JSON.parse(JSON.stringify(draft.value)) as AuxiliaryContractDraft, main: constructionMain.value ? { ...constructionMain.value } : null, attachments: files.capture() }
    try {
      const result = await commands.saveForm(session, draft.value, action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save', files.changes(), constructionMain.value ? { constructionMain: constructionMain.value } : {})
      acknowledgeForm(result.form)
      if (dirty.value || result.retainedInput) {
        kit.warning('原提交已保存，后续输入已保留；核对后继续编辑')
        return
      }
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
      saveError.value = session.pending?.result ? '合同已保存待刷新；请仅核对原目标读取' : problem.message
      errors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, values]) => [key, values[0] || '字段无效']))
      if (problem.code === 'conflict') {
        if (!pending.value && await kit.confirm({ variant: 'simple', title: '合同已有更新', message: '当前修改尚未覆盖服务器。载入最新版将替换当前内容。', confirmLabel: '载入最新版', cancelLabel: '保留我的内容' })) {
          submitted = null
          await initialize()
        }
      }
      else {
        kit.error(problem.message)
        await nextTick()
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      }
    }
    finally { loadingAction.value = null }
  }
  async function recover() {
    loadingAction.value = 'save'
    saveError.value = ''
    try {
      const read = await commands.recover(session)
      if (!read)
        return
      context.value = read.context
      if (read.outcome === 'applied' && read.form) {
        acknowledgeForm(read.form)
        kit.success('原提交已保存并已读取')
        if (dirty.value)
          kit.warning('后续输入和附件已保留，可核对后继续编辑')
      }
      else {
        submitted = null
        kit.success('原编号已封存为未应用，当前输入保留')
      }
    }
    catch (cause) { saveError.value = cause instanceof Error ? cause.message : '原号核对失败，请保留编号和输入' }
    finally { loadingAction.value = null }
  }
  onBeforeRouteLeave(async () => allowLeave || (!dirty.value && !pending.value) || await kit.confirm({ variant: 'simple', title: '放弃修改', message: pending.value ? '原提交仍需核对，编号会保留；离开会丢失本页输入。确认离开？' : '当前内容尚未保存，确认离开？', confirmLabel: '放弃修改' }))
  watch(() => `${kind()}:${targetId.value}:${route.query.origin}`, () => void initialize(), { immediate: true })
  onBeforeUnmount(() => generation++)
  useTabTitle(title)
  return { draft, title, files, errors, loading, loadError, saveError, loadingAction, closeAfterSave, dirty, initialize, save, leave, patch, pending, pendingCommandId, recover, constructionMain, usesConstructionMain, selectMain, fetchMains, fetchSignatories, selectSignatory, fetchProjects: lookup('projects'), fetchSuppliers: lookup('suppliers') }
}
