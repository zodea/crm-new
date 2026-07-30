<script setup lang="ts">
import type { ScheduleProcessLibraryTaskDraft } from '~/lib/schedule/process-library'
import { storeToRefs } from 'pinia'
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import StatePanel from '~/components/ui/StatePanel.vue'
import { calendarDays, planTemplateTasks } from '~/lib/schedule/planning'
import { toErrorMessage } from '~/lib/util/error'

const route = useRoute()
const router = useRouter()
const store = useScheduleProcessLibraryStore()
const { error: storeError, loading, saving } = storeToRefs(store)
const { confirm, error, success } = useKitUI()

const sourceLibraryId = shallowRef<string | null>(null)
const sourceLabel = shallowRef('')
const code = ref('')
const name = ref('')
const description = ref('')
const tasks = ref<ScheduleProcessLibraryTaskDraft[]>([])
const initialized = shallowRef(false)
const lastInitializedSource = shallowRef<string | null>()
let initializationGeneration = 0
let initializingSource: string | null | undefined

const previewRows = computed(() => planTemplateTasks(
  '2026-01-05',
  'seq',
  tasks.value.map(task => ({
    key: task.key,
    enabled: true,
    durationDays: task.durationDays,
    anchorStart: null,
  })),
))
const ganttRows = computed(() => previewRows.value.map((row) => {
  const task = tasks.value.find(candidate => candidate.key === row.key)!
  return {
    key: task.key,
    name: task.name || task.key,
    trade: task.trade,
    color: task.color,
    plannedStart: row.plannedStart,
    plannedFinish: row.plannedFinish,
  }
}))

function blankTask(index: number): ScheduleProcessLibraryTaskDraft {
  const suffix = Date.now().toString(36).slice(-5)
  return {
    key: `process-${suffix}-${index + 1}`,
    name: `新工序 ${index + 1}`,
    durationDays: 7,
    trade: '',
    color: ['#2f73c9', '#8b5cf6', '#10b981', '#f59e0b'][index % 4]!,
    stageCode: '',
    itemCodes: [],
    predecessorKey: index > 0 ? tasks.value[index - 1]?.key ?? null : null,
    predecessorDisabled: false,
  }
}

function resetBlank() {
  sourceLibraryId.value = null
  sourceLabel.value = ''
  code.value = ''
  name.value = ''
  description.value = ''
  tasks.value = [blankTask(0)]
}

function currentRouteSource(): string | null {
  return typeof route.query.source === 'string' ? route.query.source : null
}

async function initialize(source: string | null) {
  const generation = ++initializationGeneration
  initializingSource = source
  initialized.value = false
  if (!source) {
    resetBlank()
    lastInitializedSource.value = null
    initializingSource = undefined
    initialized.value = true
    return
  }
  try {
    const detail = await store.loadDetail(source)
    if (generation !== initializationGeneration || currentRouteSource() !== source)
      return
    if (!detail) {
      resetBlank()
      lastInitializedSource.value = source
      error('来源版本不存在或已删除')
      return
    }
    sourceLibraryId.value = detail.id
    sourceLabel.value = `${detail.name} · v${detail.version}`
    code.value = detail.code
    name.value = detail.name
    description.value = detail.description
    tasks.value = detail.tasks.map(task => ({
      key: task.key,
      name: task.name,
      durationDays: task.durationDays,
      trade: task.trade,
      color: task.color,
      stageCode: task.stageCode ?? '',
      itemCodes: [...task.itemCodes],
      predecessorKey: task.predecessorKey,
      predecessorDisabled: task.predecessorDisabled,
    }))
    lastInitializedSource.value = source
  }
  catch (cause) {
    if (generation === initializationGeneration)
      error('工序库版本读取失败', toErrorMessage(cause))
  }
  finally {
    if (generation === initializationGeneration) {
      initializingSource = undefined
      initialized.value = true
    }
  }
}

watch(
  currentRouteSource,
  source => void initialize(source),
  { immediate: true },
)

onActivated(() => {
  const source = currentRouteSource()
  if (source === lastInitializedSource.value || source === initializingSource)
    return
  void initialize(source)
})

function addTask() {
  tasks.value = [...tasks.value, blankTask(tasks.value.length)]
}

function removeTask(index: number) {
  const removedKey = tasks.value[index]?.key
  tasks.value = tasks.value
    .filter((_, candidateIndex) => candidateIndex !== index)
    .map(task => task.predecessorKey === removedKey
      ? { ...task, predecessorKey: null }
      : task)
}

function conflictedPredecessorKeys(rows: readonly ScheduleProcessLibraryTaskDraft[]) {
  const indexByKey = new Map(rows.map((task, index) => [task.key, index]))
  return rows
    .filter((task, index) =>
      task.predecessorKey
      && !task.predecessorDisabled
      && (indexByKey.get(task.predecessorKey) ?? Number.MAX_SAFE_INTEGER) >= index,
    )
    .map(task => task.key)
}

async function acceptReorderedTasks(rows: ScheduleProcessLibraryTaskDraft[]) {
  const conflicts = conflictedPredecessorKeys(rows)
  if (!conflicts.length) {
    tasks.value = rows
    return true
  }
  const approved = await confirm({
    variant: 'simple',
    title: `本次调整会冲突 ${conflicts.length} 条前置关系`,
    message: '继续后只把冲突关系置灰并保留，不会直接清除；可在顺序修复后重新启用。',
    confirmLabel: '调整并置灰冲突',
  })
  if (!approved)
    return false
  const conflictSet = new Set(conflicts)
  tasks.value = rows.map(task => conflictSet.has(task.key)
    ? { ...task, predecessorDisabled: true }
    : task)
  return true
}

async function moveTask(payload: { index: number, direction: -1 | 1 }) {
  const nextIndex = payload.index + payload.direction
  if (nextIndex < 0 || nextIndex >= tasks.value.length)
    return
  const rows = [...tasks.value]
  const [moved] = rows.splice(payload.index, 1)
  if (!moved)
    return
  rows.splice(nextIndex, 0, moved)
  await acceptReorderedTasks(rows)
}

async function updateTaskWindow(payload: {
  key: string
  plannedStart: string
  plannedFinish: string
}) {
  const currentIndex = tasks.value.findIndex(task => task.key === payload.key)
  if (currentIndex < 0)
    return
  const durationDays = calendarDays(payload.plannedStart, payload.plannedFinish) + 1
  const rows = tasks.value.map((task, index) =>
    index === currentIndex ? { ...task, durationDays } : task,
  )
  const currentPlan = previewRows.value.find(row => row.key === payload.key)
  if (currentPlan && currentPlan.plannedStart !== payload.plannedStart) {
    const [moved] = rows.splice(currentIndex, 1)
    if (!moved)
      return
    const otherPlans = previewRows.value.filter(row => row.key !== payload.key)
    const targetIndex = otherPlans.findIndex(row => payload.plannedStart < row.plannedStart)
    rows.splice(targetIndex < 0 ? rows.length : targetIndex, 0, moved)
  }
  await acceptReorderedTasks(rows)
}

async function save() {
  try {
    const created = await store.saveVersion({
      sourceLibraryId: sourceLibraryId.value,
      code: code.value,
      name: name.value,
      description: description.value,
      tasks: tasks.value,
    })
    success(`已保存 ${created.name} · v${created.version}`)
    await router.push('/schedule/process-library')
  }
  catch (cause) {
    error('标准工序库保存失败', toErrorMessage(cause))
  }
}
</script>

<template>
  <div class="process-library-form flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <Button as-child variant="ghost" size="icon">
        <NuxtLink to="/schedule/process-library" aria-label="返回标准工序库">
          <span class="i-lucide-arrow-left" aria-hidden="true" />
        </NuxtLink>
      </Button>
      <div class="min-w-56 flex-1">
        <div class="text-11px font-700 tracking-wide text-brand">
          标准工序库 · 独立表单
        </div>
        <h1 class="mt-0.5 text-20px font-850 text-ink">
          {{ sourceLibraryId ? '基于旧版新建版本' : '新建标准工序库' }}
        </h1>
        <p class="mt-1 text-12px text-ink-soft">
          {{ sourceLibraryId ? `来源 ${sourceLabel} 保持只读，本次保存会产生新版本。` : '保存后形成第一个可复用版本。' }}
        </p>
      </div>
    </section>

    <StatePanel
      v-if="loading && !initialized"
      kind="loading"
      title="正在读取来源版本"
    />
    <StatePanel
      v-else-if="storeError && !initialized"
      kind="error"
      title="来源版本读取失败"
      :description="storeError"
    />
    <template v-else>
      <section class="panel p-4 sm:p-5" aria-labelledby="process-library-meta-title">
        <h2 id="process-library-meta-title" class="text-14px font-800 text-ink">
          版本信息
        </h2>
        <div class="meta-grid mt-3 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          <label>
            <span class="field-label block">工序库编码 *</span>
            <input
              v-model="code"
              class="field-input mt-1 w-full"
              :disabled="Boolean(sourceLibraryId)"
              :title="sourceLibraryId ? '基于旧版新建时编码保持不变' : undefined"
              placeholder="如 interior-decoration"
            >
          </label>
          <label>
            <span class="field-label block">工序库名称 *</span>
            <input v-model="name" class="field-input mt-1 w-full" placeholder="如 精装修标准工序">
          </label>
          <label class="meta-description">
            <span class="field-label block">版本说明</span>
            <input v-model="description" class="field-input mt-1 w-full" placeholder="说明本版调整内容">
          </label>
        </div>
      </section>

      <section class="panel min-w-0 overflow-hidden">
        <header class="border-b border-line px-4 py-3">
          <h2 class="text-14px font-800 text-ink">
            顺序与工期预览
          </h2>
          <p class="mt-1 text-11px text-ink-soft">
            拖动整条调整顺序，拖动右边缘调整默认工期；方向键可精确微调。
          </p>
        </header>
        <ScheduleTemplateGanttEditor
          :rows="ganttRows"
          @update-window="updateTaskWindow"
        />
      </section>

      <ScheduleProcessLibraryTaskEditor
        :tasks="tasks"
        :planned-windows="previewRows"
        @update:tasks="tasks = $event"
        @add="addTask"
        @remove="removeTask"
        @move="moveTask"
      />

      <footer class="sticky bottom-3 z-3 flex flex-wrap justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <Button as-child>
          <NuxtLink to="/schedule/process-library">
            取消
          </NuxtLink>
        </Button>
        <Button variant="accent" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存为新版本' }}
        </Button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.process-library-form {
  container-type: inline-size;
}

.meta-description {
  grid-column: span 2;
}

@container (max-width: 42rem) {
  .meta-description {
    grid-column: auto;
  }
}
</style>
