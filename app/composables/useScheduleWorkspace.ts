import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { useNow } from '@vueuse/core'

import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { buildQuantityDrillLocation, scheduleFilterQuery } from '~/lib/schedule/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

export function useScheduleWorkspace(props: { projectId?: string }) {
  const route = useRoute()
  const router = useRouter()
  const store = useScheduleStore()
  const { confirm, error, formModal, success, warning } = useKitUI()

  const now = useNow({ interval: 60_000 })
  const today = computed(() => toLocalDateInputValue(now.value))
  const origin = computed(() => route.query.origin === undefined || route.query.origin === 'real' ? 'real' : route.query.origin === 'demo' ? 'demo' : null)
  const sourceError = shallowRef('')
  const active = shallowRef(true)
  let sequence = 0
  const canWrite = computed(() => store.canWrite && !store.pendingCommand && !sourceError.value && active.value && !route.query.bindingContract)
  const busy = computed(() => store.saving || Boolean(store.pendingCommand))
  const selectedProjectId = shallowRef('')
  const initialized = shallowRef(false)
  const selectedTask = shallowRef<ScheduleTaskView | null>(null)
  const taskDialogOpen = shallowRef(false)
  const dependencyDialogOpen = shallowRef(false)
  const highlightedGroupId = computed(() => String(route.query.group ?? ''))

  const selectedGroupName = computed(() => {
    if (!selectedTask.value)
      return ''
    return store.snapshot?.groups.find(group => group.id === selectedTask.value?.groupId)?.name ?? ''
  })
  const selectedDependency = computed(() => selectedTask.value
    ? store.snapshot?.dependencies.find(dependency => dependency.succId === selectedTask.value?.id) ?? null
    : null)
  const selectedGroupTasks = computed(() => {
    const task = selectedTask.value
    if (!task)
      return []
    return store.snapshot?.groups.find(candidate => candidate.id === task.groupId)?.tasks ?? []
  })
  const predecessorTasks = computed(() => {
    const task = selectedTask.value
    if (!task)
      return []
    return selectedGroupTasks.value.filter(candidate =>
      candidate.id !== task.id
      && candidate.plannedStart < task.plannedStart,
    )
  })
  const selectedDisabledDependencies = computed(() => {
    const task = selectedTask.value
    return task
      ? store.snapshot?.disabledDependencies.filter(dependency => dependency.succId === task.id) ?? []
      : []
  })

  const projectOptions = computed(() => store.catalog.filter(project => project.origin === origin.value).map(project => ({
    id: project.id,
    name: project.name,
    code: project.code,
    status: project.status,
  })))

  async function initialize() {
    const request = ++sequence
    initialized.value = false
    sourceError.value = ''
    const requestedProject = props.projectId || (typeof route.query.project === 'string' ? route.query.project : '')
    if (!store.pendingCommand || selectedTask.value?.projectId !== requestedProject || store.origin !== origin.value) {
      selectedTask.value = null
      taskDialogOpen.value = false
      dependencyDialogOpen.value = false
    }
    if (!origin.value) {
      sourceError.value = '排程来源无效，请从当前项目重新打开'
      initialized.value = true
      return
    }
    const requestedOrigin = origin.value
    try {
      store.setOrigin(requestedOrigin)
      await store.loadCatalog()
      if (request !== sequence || !active.value)
        return
      const requested = props.projectId || (typeof route.query.project === 'string' ? route.query.project : '')
      const choices = store.catalog.filter(project => project.origin === requestedOrigin)
      const preferred = requested ? choices.find(project => project.id === requested) : choices[0]
      if (requested && !preferred)
        throw new Error('当前来源的项目已删除、无权访问或身份不匹配，请重新选择项目')
      selectedProjectId.value = preferred?.id ?? ''
      if (preferred)
        await store.loadProject(preferred.id, today.value, requestedOrigin)
      if (request !== sequence || !active.value)
        return
      if (!store.pendingCommand)
        restoreTaskFromRoute()
    }
    catch (cause) {
      if (request === sequence && active.value)
        sourceError.value = toErrorMessage(cause)
    }
    finally {
      if (request === sequence && active.value)
        initialized.value = true
    }
  }
  watch(selectedProjectId, async (next, previous) => {
    if (!initialized.value || !next || next === previous || !active.value)
      return
    await router.replace({ path: '/schedule', query: { project: next, origin: origin.value ?? undefined } })
  })
  function restoreTaskFromRoute() {
    const snapshot = store.snapshot
    if (!snapshot)
      return
    const groupId = typeof route.query.group === 'string' ? route.query.group : ''
    const taskId = typeof route.query.task === 'string' ? route.query.task : ''
    const boqLineId = typeof route.query.boqLine === 'string' ? route.query.boqLine : ''
    const floorPlanId = typeof route.query.floorPlan === 'string' ? route.query.floorPlan : ''
    const bindingContractId = typeof route.query.bindingContract === 'string' ? route.query.bindingContract : ''
    const group = groupId ? snapshot.groups.find(candidate => candidate.id === groupId) : null
    if (groupId && !group) {
      sourceError.value = '来源分组已删除或不属于当前项目'
      return
    }
    const tasks = (group ? [group] : snapshot.groups).flatMap(candidate => candidate.tasks)
    if ((route.query.floorPlan || route.query.bindingContract) && (!floorPlanId || !bindingContractId || !group || group.contractId !== bindingContractId)) {
      sourceError.value = '绑定合同或原楼层计划身份不匹配，请返回合同依据重新选择'
      return
    }
    const task = floorPlanId ? tasks.find(candidate => candidate.floorPlans.some(plan => plan.id === floorPlanId)) : taskId ? tasks.find(candidate => candidate.id === taskId) : boqLineId ? tasks.find(candidate => candidate.boqLineIds.includes(boqLineId)) : null
    if ((taskId || boqLineId || floorPlanId) && !task) {
      sourceError.value = '来源工序或清单分项已失效，请从当前项目重新选择'
      return
    }
    if (task) {
      selectedTask.value = task
      taskDialogOpen.value = true
    }
  }
  function captureTarget() {
    return { generation: sequence, projectId: store.snapshot?.id, origin: origin.value, version: store.sourceVersion, taskId: selectedTask.value?.id }
  }
  watch(() => store.snapshot, (snapshot) => {
    if (!active.value || !selectedTask.value || snapshot?.id !== selectedTask.value.projectId)
      return
    const current = snapshot.groups.flatMap(group => group.tasks).find(task => task.id === selectedTask.value?.id)
    if (current)
      selectedTask.value = current
  })
  function targetCurrent(target: ReturnType<typeof captureTarget>) {
    return sameTarget(target) && target.version === store.sourceVersion
  }
  function sameTarget(target: ReturnType<typeof captureTarget>) {
    return active.value && target.generation === sequence && target.projectId === store.snapshot?.id && target.origin === origin.value && target.taskId === selectedTask.value?.id
  }
  async function confirmConflicts(taskId: string, patch: { plannedStart?: string, plannedFinish?: string }) {
    const preview = store.previewTaskReschedule(taskId, patch)
    const ids = [...new Set(preview.conflicts.map(conflict => conflict.dependencyId))]
    if (!ids.length)
      return ids
    const approved = await confirm({ variant: 'simple', title: `本次调期会冲突 ${ids.length} 条依赖`, message: `${preview.conflicts.map(conflict => `${conflict.predecessorName} → ${conflict.successorName}（至少 ${conflict.requiredDate}）`).join('；')}。继续后只置灰这些关系，记录与恢复入口保留。`, confirmLabel: '调期并置灰冲突' })
    return approved ? ids : null
  }
  async function recheck() {
    try {
      await store.recheck()
      sourceError.value = ''
    }
    catch (cause) { sourceError.value = toErrorMessage(cause) }
  }
  async function recoverPending() {
    const target = captureTarget()
    try {
      await store.recoverPending()
      if (sameTarget(target)) {
        sourceError.value = ''
        taskDialogOpen.value = false
        dependencyDialogOpen.value = false
        success('原提交结果已核对')
      }
    }
    catch (cause) { error(toErrorMessage(cause)) }
  }
  const taskDraftKey = shallowRef(0)
  function openTask(task: ScheduleTaskView) {
    if (store.pendingCommand || store.saving)
      return
    taskDraftKey.value++
    selectedTask.value = task
    dependencyDialogOpen.value = false
    taskDialogOpen.value = true
  }

  async function openDependencyEditor() {
    if (!canWrite.value)
      return
    const target = captureTarget()
    taskDialogOpen.value = false
    await nextTick()
    if (sameTarget(target))
      dependencyDialogOpen.value = true
  }

  async function returnToTaskDetail() {
    const target = captureTarget()
    const taskId = selectedTask.value?.id
    dependencyDialogOpen.value = false
    if (taskId) {
      selectedTask.value = store.snapshot?.groups
        .flatMap(group => group.tasks)
        .find(task => task.id === taskId) ?? selectedTask.value
    }
    await nextTick()
    if (sameTarget(target))
      taskDialogOpen.value = Boolean(selectedTask.value)
  }

  async function closeDependencyEditor(dirty: boolean) {
    if (store.pendingCommand || store.saving)
      return
    const target = captureTarget()
    if (dirty) {
      const approved = await confirm({
        variant: 'simple',
        title: '放弃依赖设置修改？',
        message: '前置工序或 Lag 尚未保存，关闭后本次修改不会保留。',
        confirmLabel: '放弃修改',
      })
      if (!approved || !sameTarget(target))
        return
    }
    await returnToTaskDetail()
  }

  async function setBaseline() {
    if (!canWrite.value)
      return
    const target = captureTarget()
    if (!store.snapshot?.groups.length)
      return
    const approved = await confirm({
      variant: 'simple',
      title: '设置当前计划为基准？',
      message: '全部工序会保存当前开始与完成日期。后续调整仍可与这条基准对照。',
      confirmLabel: '设置基准',
    })
    if (!approved || !targetCurrent(target))
      return
    try {
      await store.setBaseline(store.snapshot.id, today.value)
      if (!sameTarget(target))
        return
      success('排程基准已保存')
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function saveTask(payload: {
    task: { plannedStart: string, plannedFinish: string, manualProgress?: number }
    dependency: { predecessorId: string, lagDays: number } | null
    floorPlans: { id: string, plannedStart: string, plannedFinish: string }[]
  }) {
    if (!selectedTask.value || !canWrite.value)
      return
    const target = captureTarget()
    const taskId = selectedTask.value.id
    try {
      const disableDependencyIds = await confirmConflicts(taskId, payload.task)
      if (!disableDependencyIds || !targetCurrent(target))
        return
      const result = await store.saveTaskPlan(taskId, { ...payload, disableDependencyIds }, today.value)
      if (!sameTarget(target))
        return
      taskDialogOpen.value = false
      success('工序计划已更新')
      if (result.conflicts.length)
        warning(`存在 ${result.conflicts.length} 条前后置日期冲突，请检查工序衔接关系`)
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function removeTask() {
    if (!canWrite.value)
      return
    const target = captureTarget()
    if (!selectedTask.value)
      return
    const approved = await confirm({
      variant: 'simple',
      title: `删除工序「${selectedTask.value.name}」？`,
      message: '对应前后置关系会随工序一并软删除，原工序和关系记录会保留在计划历史中。',
      confirmLabel: '删除工序',
    })
    if (!approved || !targetCurrent(target))
      return
    try {
      await store.removeTask(selectedTask.value.id, today.value)
      if (!sameTarget(target))
        return
      taskDialogOpen.value = false
      success('工序已删除')
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function saveDependency(payload: { predecessorId: string, lagDays: number }) {
    if (!canWrite.value)
      return
    if (!selectedTask.value)
      return
    const target = captureTarget()
    try {
      const result = await store.updateDependency(
        selectedTask.value.id,
        payload.predecessorId,
        payload.lagDays,
        today.value,
      )
      if (!sameTarget(target))
        return
      await returnToTaskDetail()
      success('前后置依赖已保存')
      if (result.conflicts.length)
        warning(`当前计划存在 ${result.conflicts.length} 条日期冲突，关系已保留供排程核对`)
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function removeDependency(dependencyId: string) {
    if (!canWrite.value)
      return
    const target = captureTarget()
    const approved = await confirm({
      variant: 'simple',
      title: '移除当前前后置依赖？',
      message: '这是主动移除：关系会软删除并保留操作日志，但不会显示为“调期冲突待恢复”。',
      confirmLabel: '移除依赖',
    })
    if (!approved || !targetCurrent(target))
      return
    try {
      await store.removeDependency(dependencyId, today.value)
      if (!sameTarget(target))
        return
      await returnToTaskDetail()
      success('前后置依赖已移除')
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function restoreDependency(dependencyId: string) {
    if (!canWrite.value)
      return
    const target = captureTarget()
    try {
      await store.restoreDependency(dependencyId, today.value)
      if (!sameTarget(target))
        return
      success('前后置依赖已恢复')
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  async function rescheduleTask(payload: { task: ScheduleTaskView, plannedStart: string, plannedFinish: string }) {
    if (!canWrite.value)
      return
    const target = captureTarget()
    try {
      const patch = { plannedStart: payload.plannedStart, plannedFinish: payload.plannedFinish }
      const conflictIds = await confirmConflicts(payload.task.id, patch)
      if (!conflictIds || !targetCurrent(target))
        return
      await store.rescheduleTask(payload.task.id, patch, conflictIds, today.value)
      if (!sameTarget(target))
        return
      success(conflictIds.length ? '计划已调整，冲突依赖已置灰' : '计划日期已调整')
    }
    catch (cause) { error(toErrorMessage(cause)) }
  }
  async function addTask(group: ScheduleGroupView) {
    if (!canWrite.value)
      return
    const target = captureTarget()
    await store.loadProcessLibraryTasks(group.processLibraryId)
    if (!sameTarget(target))
      return
    const options = store.processTasks
      .filter(template => !group.tasks.some(task =>
        task.sourceLibraryTaskId === template.id,
      ))
    if (!options.length) {
      warning('标准工序已全部加入当前分组')
      return
    }
    const values = await formModal({
      title: `向「${group.name}」追加工序`,
      saveText: '添加工序',
      fields: [
        { key: 'task', label: '标准工序', type: 'select', options: options.map(option => `${option.name} · ${option.key}`), value: `${options[0]!.name} · ${options[0]!.key}`, required: true },
        { key: 'start', label: '计划开始', type: 'date', value: group.plannedFinish ?? today.value, required: true },
      ],
    })
    if (!values || !targetCurrent(target))
      return
    const template = options.find(option => `${option.name} · ${option.key}` === values.task)
    if (!template)
      return
    try {
      await store.addTask(group.id, { templateKey: template.key, plannedStart: String(values.start ?? '') }, today.value)
      if (!sameTarget(target))
        return
      success('工序已追加')
    }
    catch (cause) {
      error(toErrorMessage(cause))
    }
  }

  function drillQuantity() {
    const task = selectedTask.value
    if (!task)
      return
    const group = store.snapshot?.groups.find(candidate => candidate.id === task.groupId)
    if (!group)
      return
    taskDialogOpen.value = false
    router.push(buildQuantityDrillLocation('schedule', group, task, origin.value ?? undefined, scheduleFilterQuery(route.query)))
  }

  watch(() => [props.projectId, route.query.project, route.query.origin], () => {
    if (active.value)
      void initialize()
  }, { immediate: true })
  watch(() => [route.query.group, route.query.task, route.query.boqLine, route.query.floorPlan, route.query.bindingContract], () => {
    if (initialized.value && active.value)
      restoreTaskFromRoute()
  })
  onDeactivated(() => {
    active.value = false
    sequence++
  })
  onActivated(() => {
    if (!active.value) {
      active.value = true
      void initialize()
    }
  })
  onBeforeUnmount(() => {
    active.value = false
    sequence++
  })
  return { store, today, origin, canWrite, busy, sourceError, selectedProjectId, initialized, taskDraftKey, selectedTask, taskDialogOpen, dependencyDialogOpen, highlightedGroupId, selectedGroupName, selectedDependency, selectedGroupTasks, predecessorTasks, selectedDisabledDependencies, projectOptions, initialize, openTask, openDependencyEditor, closeDependencyEditor, setBaseline, saveTask, removeTask, saveDependency, removeDependency, restoreDependency, rescheduleTask, addTask, drillQuantity, recheck, recoverPending }
}
