<script setup lang="ts">
import type { ScheduleGroupView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { SCHEDULE_TASK_TEMPLATES } from '~/lib/schedule/template'
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

const selectedGroupName = computed(() => {
  if (!selectedTask.value)
    return ''
  return store.snapshot?.groups.find(group => group.id === selectedTask.value?.groupId)?.name ?? ''
})
const selectedDependency = computed(() => selectedTask.value
  ? store.snapshot?.dependencies.find(dependency => dependency.succId === selectedTask.value?.id) ?? null
  : null)
const predecessorTasks = computed(() => {
  const task = selectedTask.value
  if (!task)
    return []
  const group = store.snapshot?.groups.find(candidate => candidate.id === task.groupId)
  return group?.tasks.filter(candidate => candidate.sortOrder < task.sortOrder) ?? []
})

const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.id,
  label: project.code ? `${project.name} · ${project.code}` : project.name,
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
}

watch(selectedProjectId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  await router.replace({ query: { ...route.query, project: next, group: undefined, task: undefined } })
  await store.loadProject(next, today)
})

watch(() => route.query.task, (taskId) => {
  if (!taskId || !store.snapshot)
    return
  const task = store.snapshot.groups.flatMap(group => group.tasks).find(candidate => candidate.id === taskId)
  if (task) {
    selectedTask.value = task
    taskDialogOpen.value = true
  }
})

function openTask(task: ScheduleTaskView) {
  selectedTask.value = task
  taskDialogOpen.value = true
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
}) {
  if (!selectedTask.value)
    return
  try {
    const taskId = selectedTask.value.id
    const result = await store.updateTask(taskId, payload.task, today)
    if (payload.dependency)
      await store.updateDependency(taskId, payload.dependency.predecessorId, payload.dependency.lagDays, today)
    taskDialogOpen.value = false
    success('工序计划已更新')
    if (result.conflicts.length)
      warning(`存在 ${result.conflicts.length} 条前后置日期冲突，请检查 FS 关系`)
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

async function addTask(group: ScheduleGroupView) {
  const options = SCHEDULE_TASK_TEMPLATES.filter(template => !group.tasks.some(task => task.name === template.name))
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
  taskDialogOpen.value = false
  router.push({
    path: '/subcontract/quantity',
    query: {
      project: task.projectId,
      group: task.groupId,
      building: group?.buildingIds[0] ?? undefined,
      task: task.id,
      groupName: group?.name ?? undefined,
      taskName: task.name,
      stage: task.stageId ?? undefined,
      item: task.itemIds[0] ?? undefined,
      from: 'schedule',
    },
  })
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
          <h1 class="mt-0.5 text-20px font-850 text-ink">
            WBS 排程与实际进度
          </h1>
          <p class="mt-1 text-12px text-ink-soft">
            计划日期、工程量完成事实与 FS 前后置关系在同一行对齐。
          </p>
        </div>
        <label class="min-w-52">
          <span class="field-label block">项目</span>
          <select v-model="selectedProjectId" class="field-input w-full" aria-label="选择项目">
            <option v-for="project in projectOptions" :key="project.id" :value="project.id">{{ project.label }}</option>
          </select>
        </label>
        <div class="flex flex-wrap gap-2 self-end">
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

    <section v-if="(!initialized || store.loading) && !store.snapshot" class="panel grid min-h-64 place-items-center text-12px text-ink-soft" role="status">
      <span><span class="i-lucide-loader-circle mr-2 animate-spin text-brand" />正在读取施工排程…</span>
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
      @select-task="openTask"
      @add-task="addTask"
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
    />
  </div>
</template>

<style scoped>
.schedule-screen { container-type: inline-size; overflow: hidden; }
.summary-cell { display: flex; min-width: 0; flex-direction: column; gap: 2px; border-radius: 8px; background: var(--surface-2); padding: 8px 10px; color: var(--ink-faint); }
.summary-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 12px; }
@container (max-width: 48rem) { .schedule-screen .grid-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 26rem) { .schedule-screen .grid-cols-4 { grid-template-columns: minmax(0, 1fr); } }
</style>
