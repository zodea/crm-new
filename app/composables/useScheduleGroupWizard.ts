import type { ScheduleOverlapMode } from '~/lib/schedule/planning'
import type {
  ScheduleProvisionalBuildingPreview,
  ScheduleProvisionalScopePreview,
} from '~/stores/schedule'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { formatQuantityValue } from '~/lib/quantity/format'
import { addCalendarDays, calendarDays, planTemplateTasks } from '~/lib/schedule/planning'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

interface TaskDraft {
  templateKey: string
  enabled: boolean
  durationDays: number
  anchorStart: string | null
  predecessorKey: string | null
  predecessorDisabled: boolean
}

interface ScheduleWizardDraft {
  projectId: string
  contractId: string
  scopeBasis: 'contract' | 'provisional'
  processLibraryId: string
  name: string
  startDate: string
  overlapMode: ScheduleOverlapMode
  buildingIds: string[]
  tasks: TaskDraft[]
}

type WizardStep = 1 | 2 | 3
const regionDraftMemory = new WeakMap<object, Map<string, ScheduleWizardDraft>>()

export function useScheduleGroupWizard() {
  const route = useRoute()
  const router = useRouter()
  const store = useScheduleStore()
  const regionDrafts = regionDraftMemory.get(store) ?? new Map<string, ScheduleWizardDraft>()
  regionDraftMemory.set(store, regionDrafts)
  const { confirm, error, success, warning } = useKitUI()
  const projectId = shallowRef('')
  const contractId = shallowRef('')
  const scopeBasis = shallowRef<'contract' | 'provisional'>('contract')
  const processLibraryId = shallowRef('')
  const name = shallowRef('精装修楼栋组')
  const startDate = shallowRef(toLocalDateInputValue())
  const overlapMode = shallowRef<ScheduleOverlapMode>('half')
  const buildingIds = ref<string[]>([])
  const tasks = ref<TaskDraft[]>([])
  const initialized = shallowRef(false)
  const loadingRange = shallowRef(false)
  const loadError = shallowRef('')
  const currentStep = shallowRef<WizardStep>(1)
  const libraryOrigin = computed(() => route.query.origin === undefined || route.query.origin === 'real' ? 'real' : route.query.origin === 'demo' ? 'demo' : null)
  const active = shallowRef(true)
  let initializeSequence = 0
  let rangeSequence = 0
  let recheckSequence = 0
  const submitError = shallowRef('')
  const confirming = shallowRef(false)
  const draftNotice = shallowRef('')
  const canWrite = computed(() => store.canWrite && !store.pendingCommand && !confirming.value)
  const savedDrafts = shallowRef<Record<string, ScheduleWizardDraft>>(Object.fromEntries(regionDrafts))
  const libraryReturnTo = computed(() => projectId.value ? `/schedule/new?${new URLSearchParams({ project: projectId.value, origin: libraryOrigin.value ?? 'real' })}` : null)
  const provisionalPreview = shallowRef<ScheduleProvisionalScopePreview | null>(null)

  const initialDraft = shallowRef('')
  let allowLeave = false
  const formTabKey = deriveKey(route.fullPath || '/schedule/new')
  const dirty = computed(() => initialized.value && JSON.stringify(snapshotDraft()) !== initialDraft.value)
  async function mayLeave() {
    if (store.saving || store.pendingCommand || confirming.value)
      return false
    if (allowLeave || !dirty.value)
      return true
    const generation = initializeSequence
    const draft = JSON.stringify(snapshotDraft())
    const approved = await confirm({ variant: 'simple', title: '放弃新建排程？', message: '楼栋范围和工序调整尚未保存。放弃后需要重新填写。', confirmLabel: '放弃修改' })
    return approved && generation === initializeSequence && draft === JSON.stringify(snapshotDraft())
  }
  useTabCloseGuard(mayLeave)
  async function cancel() {
    const generation = initializeSequence
    if (!await mayLeave() || !active.value || generation !== initializeSequence)
      return
    allowLeave = true
    clearRegionDraft(projectId.value)
    useTabsStore().close(formTabKey)
    await router.push({ path: '/schedule', query: { project: projectId.value || undefined, origin: libraryOrigin.value } })
  }

  const templateByKey = computed(() => new Map(store.processTasks.map(template => [template.key, template])))
  const plannedRows = computed(() => planTemplateTasks(startDate.value, overlapMode.value, tasks.value.map(task => ({
    key: task.templateKey,
    enabled: task.enabled,
    durationDays: task.durationDays,
    anchorStart: task.anchorStart,
  }))))
  const planByKey = computed(() => new Map(plannedRows.value.map(row => [row.key, row])))
  const ganttRows = computed(() => plannedRows.value.map(row => ({
    key: row.key,
    name: templateByKey.value.get(row.key)?.name ?? row.key,
    trade: templateByKey.value.get(row.key)?.trade ?? '',
    color: templateByKey.value.get(row.key)?.color ?? '#64748b',
    plannedStart: row.plannedStart,
    plannedFinish: row.plannedFinish,
  })))
  const enabledCount = computed(() => tasks.value.filter(task => task.enabled).length)
  const finishDate = computed(() => plannedRows.value.map(row => row.plannedFinish).sort().at(-1) ?? '—')
  const projectOptions = computed(() => store.catalog.filter(project => project.origin === libraryOrigin.value).map(project => ({
    key: project.id,
    label: `${project.name}${project.code ? ` · ${project.code}` : ''}`,
  })))
  const contractOptions = computed(() => store.contracts.map(contract => ({
    key: contract.id,
    label: `${contract.name}${contract.no ? ` · ${contract.no}` : ''} · ${contract.lineCount} 条清单`,
  })))
  const processLibraryOptions = computed(() => store.processLibraries.map(library => ({
    key: library.id,
    label: `${library.name} · v${library.version} · ${library.taskCount} 道`,
  })))
  const activeProcessLibrary = computed(() =>
    store.processLibraries.find(library => library.id === processLibraryId.value),
  )
  const coverageSummary = computed(() => ({
    contract: store.buildingCoverage.filter(building => building.inContract).length,
    scheduled: store.buildingCoverage.filter(building => building.inContract && building.scheduled).length,
    available: store.buildingCoverage.filter(building => building.inContract && !building.scheduled).length,
    outside: store.buildingCoverage.filter(building => !building.inContract).length,
  }))
  const outsideBuildingNames = computed(() => store.buildingCoverage
    .filter(building => !building.inContract)
    .map(building => building.name)
    .join('、'))
  const provisionalBuildingPreviewById = computed(() => new Map(
    (provisionalPreview.value?.buildings ?? []).map(building => [building.buildingId, building]),
  ))
  const selectedProvisionalBuildings = computed(() => buildingIds.value
    .map(id => provisionalBuildingPreviewById.value.get(id))
    .filter((building): building is ScheduleProvisionalBuildingPreview => Boolean(building)))
  const disabledConflictCount = computed(() => tasks.value
    .filter(task => task.enabled && task.predecessorDisabled)
    .length)
  const wizardSteps = [
    { step: 1, label: '确定范围', hint: '项目、依据与楼栋' },
    { step: 2, label: '调整工序', hint: '工序库、工期与日期' },
    { step: 3, label: '预览生成', hint: '核对范围与计划' },
  ] as const

  function rangeValidationMessage(): string | null {
    if (!projectId.value || !name.value.trim())
      return '请选择项目并填写分组名称'
    if (scopeBasis.value === 'contract' && !contractId.value)
      return '合同清单排程必须选择一份施工合同'
    if (!buildingIds.value.length)
      return '请至少选择一栋楼'
    return null
  }

  function processValidationMessage(): string | null {
    if (!processLibraryId.value)
      return '请选择标准工序库'
    if (!startDate.value)
      return '请选择计划开始日期'
    if (!enabledCount.value)
      return '请至少启用一道工序'
    return null
  }

  const provisionalRangeBlockers = computed(() => {
    if (scopeBasis.value !== 'provisional')
      return []
    return buildingIds.value.flatMap((id) => {
      const preview = provisionalBuildingPreviewById.value.get(id)
      const name = store.buildings.find(building => building.id === id)?.name ?? id
      return preview ? preview.blockers.map(reason => `${name}：${reason}`) : [`${name}：暂估来源尚未核对`]
    })
  })
  const provisionalTaskBlockers = computed(() => {
    if (scopeBasis.value !== 'provisional' || !provisionalPreview.value)
      return []
    const blockers: string[] = []
    for (const buildingId of buildingIds.value) {
      const building = store.buildings.find(candidate => candidate.id === buildingId)
      const label = building?.name ?? buildingId
      const preview = provisionalBuildingPreviewById.value.get(buildingId)
      if (
        !preview?.floorCount
        || !preview.unitCount
        || preview.typedUnitCount < preview.unitCount
        || !preview.itemCount
        || preview.blockers.length > 0
      ) {
        continue
      }
      const availableCodes = new Set(preview.itemCodes)
      for (const task of tasks.value.filter(candidate => candidate.enabled)) {
        const template = templateByKey.value.get(task.templateKey)
        const itemCodes = template?.itemCodes ?? []
        if (itemCodes.length && !itemCodes.some(code => availableCodes.has(code)))
          blockers.push(`${label}缺少「${template?.name ?? task.templateKey}」暂估量`)
      }
    }
    return blockers
  })
  const confirmationBlockers = computed(() => {
    const blockers = [
      rangeValidationMessage(),
      processValidationMessage(),
    ].filter((message): message is string => Boolean(message))
    blockers.push(...provisionalRangeBlockers.value, ...provisionalTaskBlockers.value)
    return blockers
  })
  const coverageReview = computed(() => {
    if (scopeBasis.value === 'contract') {
      return `合同 ${coverageSummary.value.contract} 栋 · 已纳入 ${coverageSummary.value.scheduled} 栋 · 本次 ${buildingIds.value.length} 栋 · 超范围 ${coverageSummary.value.outside} 栋`
    }
    const preview = provisionalPreview.value
    if (!preview)
      return `本次 ${buildingIds.value.length} 栋 · 暂估量待核对`
    const itemCodes = new Set(selectedProvisionalBuildings.value.flatMap(building => building.itemCodes))
    const unitCount = selectedProvisionalBuildings.value
      .reduce((sum, building) => sum + building.unitCount, 0)
    return `${buildingIds.value.length} 栋 · ${unitCount} 户 · ${itemCodes.size} 个有效分项 · ${selectedProvisionalBuildings.value.map(building => quantitySummary(building)).join('；')}`
  })

  async function nextStep() {
    if (currentStep.value === 1 && (!initialized.value || loadingRange.value))
      return
    const blockers = currentStep.value === 1
      ? [rangeValidationMessage(), ...provisionalRangeBlockers.value]
      : [
          processValidationMessage(),
          ...provisionalRangeBlockers.value,
          ...provisionalTaskBlockers.value,
        ]
    const blocker = blockers.find((message): message is string => Boolean(message))
    if (blocker) {
      error(blocker)
      return
    }
    if (currentStep.value === 2 && scopeBasis.value === 'provisional') {
      const generation = initializeSequence
      const range = rangeSequence
      const draft = JSON.stringify(snapshotDraft())
      try {
        const preview = await store.previewProvisionalScope(
          store.buildings.map(building => building.id),
        )
        if (!active.value || generation !== initializeSequence || range !== rangeSequence || draft !== JSON.stringify(snapshotDraft()))
          return
        provisionalPreview.value = preview
      }
      catch (cause) {
        if (!active.value || generation !== initializeSequence || range !== rangeSequence)
          return
        loadError.value = `内部暂估范围核对失败：${toErrorMessage(cause)}`
        error(loadError.value)
        return
      }
    }
    else if (currentStep.value === 2) {
      provisionalPreview.value = null
    }
    if (currentStep.value < 3)
      currentStep.value = (currentStep.value + 1) as WizardStep
  }

  function previousStep() {
    if (currentStep.value > 1)
      currentStep.value = (currentStep.value - 1) as WizardStep
  }

  function predecessorLabel(templateKey: string): string {
    const task = tasks.value.find(candidate => candidate.templateKey === templateKey)
    if (!task?.predecessorKey)
      return '—'
    if (task.predecessorDisabled) {
      const predecessorName = templateByKey.value.get(task.predecessorKey)?.name ?? '原前置工序'
      return `${predecessorName} · 已置灰`
    }
    const predecessor = planByKey.value.get(task.predecessorKey)
    const successor = planByKey.value.get(templateKey)
    if (!predecessor || !successor)
      return '—'
    const predecessorName = templateByKey.value.get(predecessor.key)?.name ?? '前置工序'
    const lag = calendarDays(predecessor.plannedFinish, successor.plannedStart)
    return `${predecessorName} · FS${lag ? `${lag > 0 ? '+' : ''}${lag}天` : ''}`
  }

  async function loadRange(reset = true, resetBuildings = false) {
    const request = ++rangeSequence
    const requestedProject = projectId.value
    const requestedOrigin = libraryOrigin.value
    loadingRange.value = true
    loadError.value = ''
    await nextTick()
    try {
      await store.loadContracts(requestedProject, requestedOrigin ?? undefined)
      if (request !== rangeSequence || !active.value)
        return false
      if (reset) {
        contractId.value = store.contracts.find(contract => contract.lineCount > 0)?.id
          ?? store.contracts[0]?.id
          ?? ''
        scopeBasis.value = contractId.value ? 'contract' : 'provisional'
      }
      await store.loadBuildings(
        projectId.value,
        scopeBasis.value === 'contract' ? contractId.value : '',
        requestedOrigin ?? undefined,
      )
      if (request !== rangeSequence || !active.value)
        return false
      if (reset || resetBuildings)
        buildingIds.value = store.buildings.map(building => building.id)
      const preview = scopeBasis.value === 'provisional'
        ? await store.previewProvisionalScope(store.buildings.map(building => building.id))
        : null
      if (request !== rangeSequence || !active.value)
        return false
      provisionalPreview.value = preview
      return true
    }
    catch (cause) {
      if (request !== rangeSequence || !active.value)
        return false
      loadError.value = `排程范围加载失败：${toErrorMessage(cause)}`
      error(loadError.value)
      return false
    }
    finally {
      if (request === rangeSequence && active.value)
        loadingRange.value = false
    }
  }

  function resetProcessTasks(
    sourceTasks = store.processTasks,
  ) {
    tasks.value = sourceTasks.map(template => ({
      templateKey: template.key,
      enabled: true,
      durationDays: template.durationDays,
      anchorStart: null,
      predecessorKey: template.predecessorKey,
      predecessorDisabled: template.predecessorDisabled,
    }))
  }

  async function updateTaskWindow(payload: {
    key: string
    plannedStart: string
    plannedFinish: string
  }) {
    if (!canWrite.value)
      return false
    const target = JSON.stringify([projectId.value, libraryOrigin.value, processLibraryId.value, tasks.value])
    const task = tasks.value.find(candidate => candidate.templateKey === payload.key)
    if (!task)
      return false
    const currentPlan = planByKey.value.get(payload.key)
    const nextAnchorStart = currentPlan?.plannedStart === payload.plannedStart
      ? task.anchorStart
      : payload.plannedStart
    const patchedTasks = tasks.value.map(candidate => candidate.templateKey === payload.key
      ? {
          ...candidate,
          anchorStart: nextAnchorStart,
          durationDays: calendarDays(payload.plannedStart, payload.plannedFinish) + 1,
        }
      : candidate)
    const nextPlanByKey = new Map(planTemplateTasks(
      startDate.value,
      overlapMode.value,
      patchedTasks.map(candidate => ({
        key: candidate.templateKey,
        enabled: candidate.enabled,
        durationDays: candidate.durationDays,
        anchorStart: candidate.anchorStart,
      })),
    ).map(row => [row.key, row]))
    const conflictedSuccessorKeys = patchedTasks
      .filter(candidate => candidate.enabled && candidate.predecessorKey && !candidate.predecessorDisabled)
      .filter((candidate) => {
        const predecessor = nextPlanByKey.get(candidate.predecessorKey!)
        const successor = nextPlanByKey.get(candidate.templateKey)
        return Boolean(
          predecessor
          && successor
          && calendarDays(predecessor.plannedStart, successor.plannedStart) < 0,
        )
      })
      .map(candidate => candidate.templateKey)
    if (conflictedSuccessorKeys.length) {
      const approved = await confirm({
        variant: 'simple',
        title: `本次调期会冲突 ${conflictedSuccessorKeys.length} 条前置关系`,
        message: '继续后只把冲突关系置灰并保留；生成排程后仍可在依赖设置中恢复。',
        confirmLabel: '调期并置灰冲突',
      })
      if (!approved || !active.value || target !== JSON.stringify([projectId.value, libraryOrigin.value, processLibraryId.value, tasks.value]))
        return false
      const conflictSet = new Set(conflictedSuccessorKeys)
      tasks.value = patchedTasks.map(candidate => conflictSet.has(candidate.templateKey)
        ? { ...candidate, predecessorDisabled: true }
        : candidate)
      return true
    }
    tasks.value = patchedTasks
    return true
  }

  async function updateTaskDuration(task: TaskDraft, event: Event) {
    const input = event.target as HTMLInputElement
    const durationDays = Math.max(1, Math.trunc(Number(input.value) || 1))
    const currentPlan = planByKey.value.get(task.templateKey)
    if (!currentPlan)
      return
    const accepted = await updateTaskWindow({
      key: task.templateKey,
      plannedStart: currentPlan.plannedStart,
      plannedFinish: addCalendarDays(currentPlan.plannedStart, durationDays - 1),
    })
    if (!accepted)
      input.value = String(task.durationDays)
  }

  async function updateTaskAnchor(task: TaskDraft, event: Event) {
    const input = event.target as HTMLInputElement
    if (!input.value) {
      tasks.value = tasks.value.map(candidate => candidate.templateKey === task.templateKey
        ? { ...candidate, anchorStart: null }
        : candidate)
      return
    }
    const accepted = await updateTaskWindow({
      key: task.templateKey,
      plannedStart: input.value,
      plannedFinish: addCalendarDays(input.value, task.durationDays - 1),
    })
    if (!accepted)
      input.value = task.anchorStart ?? ''
  }

  watch(projectId, async (next, previous) => {
    if (!initialized.value || !active.value || !next || next === previous)
      return
    currentStep.value = 1
    await loadRange(true)
  })
  watch([contractId, scopeBasis], async ([contract, basis], [previousContract, previousBasis]) => {
    if (!initialized.value || !active.value || loadingRange.value || (contract === previousContract && basis === previousBasis))
      return
    if (basis === 'contract' && !contractId.value)
      contractId.value = store.contracts[0]?.id ?? ''
    await loadRange(false, true)
  })

  watch(processLibraryId, async (next, previous) => {
    if (!initialized.value || !next || next === previous)
      return
    try {
      const loaded = await store.loadProcessLibraryTasks(next)
      if (processLibraryId.value !== next || store.processTasksLibraryId !== next)
        return
      resetProcessTasks(loaded)
    }
    catch (cause) {
      loadError.value = `标准工序加载失败：${toErrorMessage(cause)}`
      error(loadError.value)
    }
  })

  function toggleBuilding(id: string) {
    buildingIds.value = buildingIds.value.includes(id)
      ? buildingIds.value.filter(candidate => candidate !== id)
      : [...buildingIds.value, id]
  }

  function quantitySummary(preview: ScheduleProvisionalBuildingPreview) {
    return preview.quantities.map(total => `${total.missingCount ? '已知 ' : ''}${formatQuantityValue(total.knownValue)} ${total.unit || '单位待核对'}${total.missingCount ? `，缺 ${total.missingCount} 项` : ''}`).join(' / ') || '暂无有效暂估分项'
  }
  function provisionalBuildingStatus(id: string) {
    const preview = provisionalBuildingPreviewById.value.get(id)
    if (!preview)
      return { label: '暂估量核对中', blocked: true }
    return { label: preview.blockers.length ? preview.blockers.join('；') : `${preview.floorCount} 层 · ${preview.unitCount} 户 · ${preview.itemCount} 项 · ${quantitySummary(preview)}`, blocked: preview.blockers.length > 0 }
  }
  function draftStorageKey(id: string) {
    return `${store.sessionKey}:${libraryOrigin.value}:${id}`
  }
  function snapshotDraft(): ScheduleWizardDraft {
    return { projectId: projectId.value, contractId: contractId.value, scopeBasis: scopeBasis.value, processLibraryId: processLibraryId.value, name: name.value, startDate: startDate.value, overlapMode: overlapMode.value, buildingIds: [...buildingIds.value], tasks: tasks.value.map(task => ({ ...task })) }
  }
  function saveDraftForRegion() {
    if (projectId.value) {
      const key = draftStorageKey(projectId.value)
      regionDrafts.set(key, snapshotDraft())
      savedDrafts.value = Object.fromEntries(regionDrafts)
    }
  }
  function readRegionDraft(id: string): ScheduleWizardDraft | null {
    if (route.query.resume !== 'region')
      return null
    const draft = savedDrafts.value[draftStorageKey(id)]
    return draft?.projectId === id ? draft : null
  }
  function clearRegionDraft(id: string) {
    const copy = { ...savedDrafts.value }
    delete copy[draftStorageKey(id)]
    savedDrafts.value = copy
    regionDrafts.delete(draftStorageKey(id))
  }

  function toggleAllTasks(enabled: boolean) {
    tasks.value = tasks.value.map(task => ({ ...task, enabled }))
  }

  async function submit() {
    if (!canWrite.value || store.saving)
      return
    const validation = confirmationBlockers.value[0]
    if (validation) {
      submitError.value = validation
      return
    }
    const draft = snapshotDraft()
    const generation = initializeSequence
    const selectedOrigin = libraryOrigin.value
    const version = store.sourceVersion
    const librarySourceVersion = activeProcessLibrary.value?.sourceVersion
    confirming.value = true
    const approved = await confirm({ variant: 'batch', title: '生成楼栋 WBS 排程？', message: `${name.value} · ${buildingIds.value.length} 栋楼 · ${enabledCount.value} 道工序，计划完成 ${finishDate.value}。`, confirmLabel: '生成排程' })
    confirming.value = false
    if (!approved || !active.value || generation !== initializeSequence || selectedOrigin !== libraryOrigin.value || draft.projectId !== projectId.value || version !== store.sourceVersion)
      return
    submitError.value = ''
    try {
      const groupId = await store.createGroup({ ...draft, contractId: draft.scopeBasis === 'contract' ? draft.contractId : null, librarySourceVersion })
      if (!active.value || generation !== initializeSequence || selectedOrigin !== libraryOrigin.value || draft.projectId !== projectId.value)
        return
      clearRegionDraft(draft.projectId)
      allowLeave = true
      useTabsStore().close(formTabKey)
      success('楼栋排程已生成')
      await router.push({ path: '/schedule', query: { project: draft.projectId, group: groupId, origin: selectedOrigin } })
    }
    catch (cause) {
      if (active.value && draft.projectId === projectId.value)
        submitError.value = toErrorMessage(cause)
    }
  }
  async function recheck() {
    const request = ++recheckSequence
    const generation = initializeSequence
    const requestedProject = projectId.value
    const requestedOrigin = libraryOrigin.value
    const requestedSession = store.sessionKey
    const isCurrent = () => active.value && request === recheckSequence && generation === initializeSequence
      && requestedProject === projectId.value && requestedOrigin === libraryOrigin.value && requestedSession === store.sessionKey
    try {
      await Promise.all([store.recheck(), store.loadProcessLibraries()])
      if (!isCurrent())
        return
      if (await loadRange(false) && isCurrent())
        submitError.value = ''
    }
    catch (cause) {
      if (isCurrent())
        submitError.value = toErrorMessage(cause)
    }
  }
  async function recoverPending() {
    try {
      const target = { projectId: projectId.value, origin: libraryOrigin.value }
      const result = await store.recoverPending()
      if (typeof result === 'string' && active.value && target.projectId === projectId.value && target.origin === libraryOrigin.value) {
        allowLeave = true
        clearRegionDraft(target.projectId)
        useTabsStore().close(formTabKey)
        await router.push({ path: '/schedule', query: { project: target.projectId, group: result, origin: target.origin } })
      }
    }
    catch (cause) { submitError.value = toErrorMessage(cause) }
  }

  async function initialize() {
    const request = ++initializeSequence
    rangeSequence++
    initialized.value = false
    loadError.value = ''
    try {
      const legacy = sessionStorage.getItem('ruihang:schedule-region-drafts')
      if (legacy !== null) {
        const rows = JSON.parse(legacy)
        if (!rows || typeof rows !== 'object' || Array.isArray(rows))
          throw new Error('旧区域返回草稿损坏，已保留原存储供核对')
        for (const [key, value] of Object.entries(rows)) {
          const draft = value as ScheduleWizardDraft
          if (!draft || typeof draft.projectId !== 'string' || !Array.isArray(draft.tasks) || !Array.isArray(draft.buildingIds))
            throw new Error('旧区域返回草稿无法完整核验，已保留原存储')
          regionDrafts.set(key, structuredClone(draft))
        }
        savedDrafts.value = Object.fromEntries(regionDrafts)
        sessionStorage.removeItem('ruihang:schedule-region-drafts')
        if (sessionStorage.getItem('ruihang:schedule-region-drafts') !== null)
          throw new Error('旧区域草稿尚未可靠迁到当前页面内存')
      }
      if (!libraryOrigin.value)
        throw new Error('排程来源无效，请从当前项目重新打开')
      store.setOrigin(libraryOrigin.value)
      await Promise.all([store.loadCatalog(), store.loadProcessLibraries()])
      const requested = String(route.query.project ?? '')
      if (request !== initializeSequence || !active.value)
        return
      const choices = store.catalog.filter(project => project.origin === libraryOrigin.value)
      const requestedProjectId = (requested ? choices.find(project => project.id === requested) : choices[0])?.id ?? ''
      if (requested && !requestedProjectId)
        throw new Error('当前来源的项目不可用或身份不匹配，请重新选择项目')
      projectId.value = requestedProjectId
      if (requestedProjectId)
        await store.loadContracts(requestedProjectId, libraryOrigin.value)
      if (request !== initializeSequence || !active.value)
        return
      const restoredDraft = readRegionDraft(requestedProjectId)
      processLibraryId.value = restoredDraft
        && store.processLibraries.some(library => library.id === restoredDraft.processLibraryId)
        ? restoredDraft.processLibraryId
        : store.processLibraries.find(library => library.isDefault)?.id
          ?? store.processLibraries[0]?.id
          ?? ''
      if (processLibraryId.value) {
        const loaded = await store.loadProcessLibraryTasks(processLibraryId.value)
        if (request !== initializeSequence || !active.value)
          return
        resetProcessTasks(loaded)
        if (restoredDraft) {
          const restoredTasks = new Map(restoredDraft.tasks.map(task => [task.templateKey, task]))
          tasks.value = tasks.value.map(task => ({ ...task, ...restoredTasks.get(task.templateKey) }))
        }
      }
      projectId.value = requestedProjectId
      if (projectId.value) {
        if (!await loadRange(true))
          return
      }
      if (request !== initializeSequence || !active.value)
        return
      if (restoredDraft) {
        name.value = restoredDraft.name
        startDate.value = restoredDraft.startDate
        overlapMode.value = restoredDraft.overlapMode
        scopeBasis.value = restoredDraft.scopeBasis
        contractId.value = restoredDraft.contractId
        if (!await loadRange(false))
          return
        if (request !== initializeSequence || !active.value)
          return
        const availableIds = new Set(store.buildings.map(building => building.id))
        const restoredBuildingIds = restoredDraft.buildingIds.filter(id => availableIds.has(id))
        const removedBuildingCount = restoredDraft.buildingIds.length - restoredBuildingIds.length
        buildingIds.value = restoredBuildingIds.length || restoredDraft.buildingIds.length
          ? restoredBuildingIds
          : store.buildings.map(building => building.id)
        if (removedBuildingCount) {
          draftNotice.value = `区域配置已变化，已从排程范围移除 ${removedBuildingCount} 栋失效楼栋，请重新核对范围`
          warning(draftNotice.value)
        }
        clearRegionDraft(requestedProjectId)
      }
    }
    catch (cause) {
      if (request !== initializeSequence || !active.value)
        return
      loadError.value = `排程向导加载失败：${toErrorMessage(cause)}`
      error(loadError.value)
    }
    finally {
      if (request === initializeSequence && active.value)
        initialized.value = true
      if (request === initializeSequence && active.value && !initialDraft.value)
        initialDraft.value = JSON.stringify(snapshotDraft())
    }
  }

  onMounted(initialize)
  onDeactivated(() => {
    active.value = false
    rangeSequence++
    initializeSequence++
  })
  onBeforeUnmount(() => {
    active.value = false
    rangeSequence++
    initializeSequence++
  })
  onActivated(() => {
    if (!active.value) {
      active.value = true
      if (route.query.resume === 'region')
        void initialize()
      else void recheck()
    }
  })
  watch(() => [route.query.project, route.query.origin, route.query.resume], () => {
    if (active.value)
      void initialize()
  })
  return { store, cancel, mayLeave, dirty, projectId, contractId, scopeBasis, processLibraryId, name, startDate, overlapMode, buildingIds, tasks, initialized, loadingRange, loadError, currentStep, libraryOrigin, libraryReturnTo, templateByKey, plannedRows, planByKey, ganttRows, enabledCount, finishDate, projectOptions, contractOptions, processLibraryOptions, activeProcessLibrary, coverageSummary, outsideBuildingNames, disabledConflictCount, wizardSteps, confirmationBlockers, provisionalRangeBlockers, coverageReview, nextStep, previousStep, predecessorLabel, updateTaskWindow, updateTaskDuration, updateTaskAnchor, toggleBuilding, provisionalBuildingStatus, saveDraftForRegion, toggleAllTasks, submit, initialize, canWrite, submitError, draftNotice, confirming, recheck, recoverPending }
}
