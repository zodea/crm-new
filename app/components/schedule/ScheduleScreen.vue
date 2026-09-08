<script setup lang="ts">
import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { Button } from '~/components/ui/button'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import { buildQuantityDrillLocation } from '~/lib/schedule/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const props = withDefaults(defineProps<{ projectId?: string }>(), { projectId: '' })
const route = useRoute()
const router = useRouter()
const store = useScheduleStore()
const { confirm, error, formModal, success, warning } = useKitUI()

const today = toLocalDateInputValue()
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

const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
})))

async function initialize() {
  await store.loadCatalog()
  const requested = props.projectId || String(route.query.project ?? '')
  const preferred = store.catalog.find(project => project.id === requested)
    ?? store.catalog.find(project => project.groupCount > 0)
    ?? store.catalog[0]
  selectedProjectId.value = preferred?.id ?? ''
  if (selectedProjectId.value)
    await store.loadProject(selectedProjectId.value, today)
  initialized.value = true
  restoreTaskFromRoute(route.query.task, route.query.boqLine)
}

watch(selectedProjectId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  await router.replace({
    query: {
      ...route.query,
      project: next,
      group: undefined,
      task: undefined,
      boqLine: undefined,
    },
  })
  await store.loadProject(next, today)
})

function restoreTaskFromRoute(taskId: unknown, boqLineId: unknown = route.query.boqLine) {
  if (!store.snapshot)
    return
  const tasks = store.snapshot.groups.flatMap(group => group.tasks)
  const task = taskId
    ? tasks.find(candidate => candidate.id === taskId)
    : tasks.find(candidate => candidate.boqLineIds.includes(String(boqLineId ?? '')))
  if (task) {
    selectedTask.value = task
    taskDialogOpen.value = true
  }
}

watch(
  () => [route.query.task, route.query.boqLine] as const,
  ([taskId, boqLineId]) => restoreTaskFromRoute(taskId, boqLineId),
)

function openTask(task: ScheduleTaskView) {
  selectedTask.value = task
  dependencyDialogOpen.value = false
  taskDialogOpen.value = true
}

async function openDependencyEditor() {
  taskDialogOpen.value = false
  await nextTick()
  dependencyDialogOpen.value = true
}

async function returnToTaskDetail() {
  const taskId = selectedTask.value?.id
  dependencyDialogOpen.value = false
  if (taskId) {
    selectedTask.value = store.snapshot?.groups
      .flatMap(group => group.tasks)
      .find(task => task.id === taskId) ?? selectedTask.value
  }
  await nextTick()
  taskDialogOpen.value = Boolean(selectedTask.value)
}

async function closeDependencyEditor(dirty: boolean) {
  if (dirty) {
    const approved = await confirm({
      variant: 'simple',
      title: '放弃依赖设置修改？',
      message: '前置工序或 Lag 尚未保存，关闭后本次修改不会保留。',
      confirmLabel: '放弃修改',
    })
    if (!approved)
      return
  }
  await returnToTaskDetail()
}

async function setBaseline() {
  if (!store.snapshot?.groups.length)
    return
  const approved = await confirm({
    variant: 'simple',
    title: '设置当前计划为基准？',
    message: '全部工序会保存当前开始与完成日期。后续调整仍可与这条基准对照。',
    confirmLabel: '设置基准',
  })
  if (!approved)
    return
  try {
    await store.setBaseline(store.snapshot.id, today)
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
  if (!selectedTask.value)
    return
  try {
    const taskId = selectedTask.value.id
    const result = await store.saveTaskPlan(taskId, payload, today)
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
  if (!selectedTask.value)
    return
  const approved = await confirm({
    variant: 'simple',
    title: `删除工序「${selectedTask.value.name}」？`,
    message: '对应前后置关系会随工序一并软删除，可通过操作日志恢复。',
    confirmLabel: '删除工序',
  })
  if (!approved)
    return
  try {
    await store.removeTask(selectedTask.value.id, today)
    taskDialogOpen.value = false
    success('工序已删除')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function saveDependency(payload: { predecessorId: string, lagDays: number }) {
  if (!selectedTask.value)
    return
  try {
    const result = await store.updateDependency(
      selectedTask.value.id,
      payload.predecessorId,
      payload.lagDays,
      today,
    )
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
  const approved = await confirm({
    variant: 'simple',
    title: '移除当前前后置依赖？',
    message: '这是主动移除：关系会软删除并保留操作日志，但不会显示为“调期冲突待恢复”。',
    confirmLabel: '移除依赖',
  })
  if (!approved)
    return
  try {
    await store.removeDependency(dependencyId, today)
    await returnToTaskDetail()
    success('前后置依赖已移除')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function restoreDependency(dependencyId: string) {
  try {
    await store.restoreDependency(dependencyId, today)
    success('前后置依赖已恢复')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function rescheduleTask(payload: {
  task: ScheduleTaskView
  plannedStart: string
  plannedFinish: string
}) {
  try {
    const patch = {
      plannedStart: payload.plannedStart,
      plannedFinish: payload.plannedFinish,
    }
    const preview = store.previewTaskReschedule(payload.task.id, patch)
    const conflictIds = [...new Set(preview.conflicts.map(conflict => conflict.dependencyId))]
    if (conflictIds.length) {
      const conflictLines = preview.conflicts
        .slice(0, 3)
        .map(conflict => `${conflict.predecessorName} → ${conflict.successorName}（至少 ${conflict.requiredDate}）`)
      const approved = await confirm({
        variant: 'simple',
        title: `本次调期会冲突 ${conflictIds.length} 条依赖`,
        message: `${conflictLines.join('；')}${preview.conflicts.length > 3 ? '；…' : ''}。继续后只置灰这些关系，不会清除记录。`,
        confirmLabel: '调期并置灰冲突',
      })
      if (!approved)
        return
    }
    await store.rescheduleTask(payload.task.id, patch, conflictIds, today)
    success(conflictIds.length ? '计划已调整，冲突依赖已置灰' : '计划日期已调整')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function addTask(group: ScheduleGroupView) {
  await store.loadProcessLibraryTasks(group.processLibraryId)
  const options = store.processTasks
    .filter(template => !group.tasks.some(task =>
      task.sourceLibraryTaskId === template.id || task.name === template.name,
    ))
  if (!options.length) {
    warning('标准工序已全部加入当前分组')
    return
  }
  const values = await formModal({
    title: `向「${group.name}」追加工序`,
    saveText: '添加工序',
    fields: [
      { key: 'task', label: '标准工序', type: 'select', options: options.map(option => option.name), value: options[0]!.name, required: true },
      { key: 'start', label: '计划开始', type: 'date', value: group.plannedFinish ?? today, required: true },
    ],
  })
  if (!values)
    return
  const template = options.find(option => option.name === values.task)
  if (!template)
    return
  try {
    await store.addTask(group.id, { templateKey: template.key, plannedStart: String(values.start ?? '') }, today)
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
  router.push(buildQuantityDrillLocation('schedule', group, task))
}

onMounted(initialize)
</script>

<template>
  <div class="schedule-screen flex min-w-0 flex-col gap-4">
    <section class="panel p-4">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-52 flex-1">
          <div class="text-11px font-700 tracking-wide text-brand">
            施工进度
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <h1 class="text-20px font-850 text-ink">
              WBS 排程与实际进度
            </h1>
            <ContextHelp label="施工排程" text="在同一行查看计划日期与实际完成进度。前置工序完成后，后续工序按设定的间隔开始。" />
          </div>
        </div>
        <div class="min-w-52">
          <span class="field-label block">项目</span>
          <ProjectSwitcher
            v-model="selectedProjectId"
            :projects="projectOptions"
            :loading="!initialized && store.loading"
            :error="store.error"
            aria-label="选择施工进度项目"
          />
        </div>
        <div class="flex flex-wrap gap-2 self-end">
          <Button as-child>
            <NuxtLink to="/schedule/process-library">
              <span class="i-lucide-library" aria-hidden="true" />
              标准工序库
            </NuxtLink>
          </Button>
          <button type="button" class="btn-secondary" :disabled="!store.snapshot?.groups.length" @click="setBaseline">
            <span class="i-lucide-git-commit-horizontal mr-1" /> 设置基准
          </button>
          <NuxtLink :to="{ path: '/schedule/new', query: { project: selectedProjectId } }" class="btn-accent">
            <span class="i-lucide-plus mr-1" /> 新建楼栋分组
          </NuxtLink>
        </div>
      </div>

      <div v-if="store.snapshot" class="mt-4 grid grid-cols-4 gap-2 text-11px">
        <div class="summary-cell">
          <span>计划周期</span><strong>{{ store.snapshot.plannedStart ?? '—' }} — {{ store.snapshot.plannedFinish ?? '—' }}</strong>
        </div>
        <div class="summary-cell">
          <span>楼栋分组</span><strong>{{ store.snapshot.groups.length }} 组</strong>
        </div>
        <div class="summary-cell">
          <span>计划进度</span><strong>{{ Math.round(store.snapshot.plannedProgress * 100) }}%</strong>
        </div>
        <div class="summary-cell">
          <span>实际进度</span><strong>{{ Math.round(store.snapshot.actualProgress * 100) }}%</strong>
        </div>
      </div>
    </section>

    <section v-if="(!initialized || store.loading) && !store.snapshot" class="panel grid min-h-64 gap-3 p-4" role="status" aria-label="正在读取施工排程">
      <span class="sr-only">正在读取施工排程…</span>
      <div class="h-7 w-56 animate-pulse rounded bg-surface-3" />
      <div class="grid grid-cols-4 gap-2">
        <div v-for="index in 4" :key="index" class="h-14 animate-pulse rounded-lg bg-surface-2" />
      </div>
      <div class="h-36 animate-pulse rounded-lg bg-surface-2" />
    </section>
    <section v-else-if="store.error" class="panel grid min-h-64 place-items-center p-5 text-center text-12px text-danger" role="alert">
      {{ store.error }}
    </section>
    <section v-else-if="!store.catalog.length" class="panel grid min-h-64 place-items-center p-5 text-center">
      <div>
        <span class="i-lucide-building-2 text-24px text-ink-faint" /><p class="mt-2 text-13px font-700">
          尚无可排程项目
        </p>
      </div>
    </section>
    <section v-else-if="store.snapshot && !store.snapshot.groups.length" class="panel flex min-h-64 flex-col items-center justify-center gap-2 p-5 text-center">
      <span class="i-lucide-calendar-plus text-24px text-brand" />
      <p class="text-14px font-800 text-ink">
        当前项目还没有楼栋排程分组
      </p>
      <p class="text-12px text-ink-soft">
        从 22 道标准工序生成第一份计划，再按现场情况调整。
      </p>
      <NuxtLink :to="{ path: '/schedule/new', query: { project: selectedProjectId } }" class="btn-accent mt-1">
        新建楼栋分组
      </NuxtLink>
    </section>
    <ScheduleBoard
      v-else-if="store.snapshot"
      :snapshot="store.snapshot"
      :today="today"
      :highlighted-group-id="highlightedGroupId"
      @select-task="openTask"
      @add-task="addTask"
      @reschedule-task="rescheduleTask"
    />

    <ScheduleTaskDialog
      v-model:open="taskDialogOpen"
      :task="selectedTask"
      :group-name="selectedGroupName"
      :dependency="selectedDependency"
      :predecessor-tasks="predecessorTasks"
      :busy="store.saving"
      @save="saveTask"
      @remove="removeTask"
      @drill="drillQuantity"
      @edit-dependency="openDependencyEditor"
    />

    <ScheduleDependencyDialog
      v-model:open="dependencyDialogOpen"
      :task="selectedTask"
      :group-name="selectedGroupName"
      :group-tasks="selectedGroupTasks"
      :dependencies="store.snapshot?.dependencies ?? []"
      :dependency="selectedDependency"
      :disabled-dependencies="selectedDisabledDependencies"
      :busy="store.saving"
      @save="saveDependency"
      @remove="removeDependency"
      @restore="restoreDependency"
      @request-close="closeDependencyEditor"
    />
  </div>
</template>

<style scoped>
.schedule-screen { container-type: inline-size; overflow: hidden; }
.summary-cell { display: flex; min-width: 0; flex-direction: column; gap: 2px; border-radius: 8px; background: var(--surface-2); padding: 8px 10px; color: var(--ink-faint); }
.summary-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 12px; }
.summary-cell strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
@container (max-width: 48rem) { .schedule-screen .grid-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 26rem) { .schedule-screen .grid-cols-4 { grid-template-columns: minmax(0, 1fr); } }
</style>
