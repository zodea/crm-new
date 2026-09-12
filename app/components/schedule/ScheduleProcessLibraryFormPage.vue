<script setup lang="ts">
import type { ScheduleProcessLibraryTaskDraft } from '~/lib/schedule/process-library'
import type { ProcessLibraryReadVersion } from '~/lib/schedule/process-library-state'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import StatePanel from '~/components/ui/StatePanel.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { ProjectRepositoryProblem } from '~/lib/project/repository'
import { calendarDays, planTemplateTasks } from '~/lib/schedule/planning'
import { processLibraryNavigationQuery, processLibraryReturnTo } from '~/lib/schedule/process-library-navigation'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { useTabsStore } from '~/stores/tabs'

const route = useRoute()
const router = useRouter()
const store = useScheduleProcessLibraryStore()
const tabs = useTabsStore()
const formTabKey = deriveKey(route.fullPath || '/schedule/process-library/form')
const { loading, saving } = storeToRefs(store)
const { confirm, error, success } = useKitUI()

const sourceLibraryId = shallowRef<string | null>(null)
const sourceLabel = shallowRef('')
const code = shallowRef('')
const name = shallowRef('')
const description = shallowRef('')
const tasks = ref<ScheduleProcessLibraryTaskDraft[]>([])
const initialized = shallowRef(false)
const readError = shallowRef('')
const needsReview = shallowRef(false)
const reviewMessage = shallowRef('')
const reviewing = shallowRef(false)
const baseline = shallowRef<ProcessLibraryReadVersion | null>(null)
const initialSnapshot = shallowRef('')
const active = shallowRef(true)
const pendingReorder = shallowRef<{
  rows: ScheduleProcessLibraryTaskDraft[]
  conflicts: { key: string, predecessor: string, successor: string }[]
  generation: number
  snapshot: string
} | null>(null)
const cancelReorderButton = useTemplateRef<{ $el?: HTMLElement }>('cancelReorderButton')
let lastInitializedKey: string | undefined
let initializationGeneration = 0
let initializingKey: string | undefined
let allowLeave = false
const origin = computed(() => route.query.origin === 'demo' ? 'demo' : route.query.origin === 'real' ? 'real' : store.origin)
const scopeMatches = computed(() => origin.value === store.origin)
const returnTo = computed(() => processLibraryReturnTo(route.query))
const ownsPage = () => !route.path || route.path === '/schedule/process-library/form'
const currentKey = () => `${currentRouteSource() ?? ''}:${origin.value}:${store.origin}`
const snapshot = () => JSON.stringify({ code: code.value, name: name.value, description: description.value, tasks: tasks.value })
const dirty = computed(() => initialized.value && snapshot() !== initialSnapshot.value)
const editable = computed(() => active.value && ownsPage() && initialized.value && scopeMatches.value && store.canWrite && !saving.value && !loading.value && !reviewing.value)
const canSave = computed(() => editable.value && !needsReview.value)

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
  const key = currentKey()
  initializingKey = key
  initialized.value = false
  baseline.value = null
  readError.value = ''
  needsReview.value = false
  reviewMessage.value = ''
  allowLeave = false
  pendingReorder.value = null
  resetBlank()
  try {
    if (!scopeMatches.value)
      throw new Error('此表单来源与当前工作区不同，请返回对应来源重新打开')
    const detail = source ? await store.loadDetail(source) : (await store.loadLibraries(), null)
    if (!active.value || generation !== initializationGeneration || currentKey() !== key)
      return
    if (source && !detail)
      throw new Error('来源版本不存在或已删除')
    if (detail) {
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
    }
    baseline.value = store.readVersion
    lastInitializedKey = key
    initialSnapshot.value = snapshot()
    initialized.value = true
  }
  catch (cause) {
    if (active.value && generation === initializationGeneration && currentKey() === key)
      readError.value = toErrorMessage(cause)
  }
  finally {
    if (generation === initializationGeneration)
      initializingKey = undefined
  }
}

watch(
  currentKey,
  () => {
    if (active.value && ownsPage())
      void initialize(currentRouteSource())
  },
  { immediate: true, flush: 'sync' },
)

onActivated(() => {
  active.value = true
  const key = currentKey()
  if (key === initializingKey)
    return
  if (key !== lastInitializedKey || !initialized.value)
    void initialize(currentRouteSource())
  else
    void refreshAccess()
})
onDeactivated(() => {
  active.value = false
  pendingReorder.value = null
  initializationGeneration++
  initializingKey = undefined
})
onScopeDispose(() => {
  active.value = false
  pendingReorder.value = null
  initializationGeneration++
})

async function refreshAccess() {
  const generation = initializationGeneration
  try {
    await store.loadLibraries()
    if (active.value && generation === initializationGeneration)
      readError.value = ''
  }
  catch (cause) {
    if (active.value && generation === initializationGeneration)
      readError.value = toErrorMessage(cause)
  }
}

async function recheck() {
  if (!active.value || saving.value || reviewing.value || !scopeMatches.value)
    return
  const generation = initializationGeneration
  const key = currentKey()
  const requestedCode = code.value
  const requestedSource = sourceLibraryId.value
  const approved = await confirm({ variant: 'simple', title: '重新核对当前版本系列', message: '重新读取同编码的当前最高版本及权限，保留这份人工稿和复制来源。核对成功后需要再次点击保存，不会自动提交。', confirmLabel: '重新核对并保留人工稿' })
  if (!approved || !active.value || generation !== initializationGeneration || currentKey() !== key || code.value !== requestedCode || sourceLibraryId.value !== requestedSource)
    return
  reviewing.value = true
  try {
    const next = await store.recheckSeries(requestedCode, requestedSource)
    if (!active.value || generation !== initializationGeneration || currentKey() !== key)
      return
    baseline.value = next
    needsReview.value = false
    readError.value = ''
    const latestVersion = next && Object.hasOwn(next.versions, requestedCode) ? next.versions[requestedCode] : 0
    reviewMessage.value = next ? `已核对同编码当前最高版本 v${latestVersion}；人工稿已保留，请再次保存。` : '已重新核对，人工稿已保留，请再次保存。'
  }
  catch (cause) {
    if (active.value && generation === initializationGeneration)
      readError.value = toErrorMessage(cause)
  }
  finally { reviewing.value = false }
}

function addTask() {
  if (!editable.value)
    return
  tasks.value = [...tasks.value, blankTask(tasks.value.length)]
}

function removeTask(index: number) {
  if (!editable.value)
    return
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

function acceptReorderedTasks(rows: ScheduleProcessLibraryTaskDraft[]) {
  if (!editable.value)
    return false
  const generation = initializationGeneration
  const before = snapshot()
  const conflicts = conflictedPredecessorKeys(rows)
  if (!conflicts.length) {
    tasks.value = rows
    return true
  }
  pendingReorder.value = {
    rows,
    generation,
    snapshot: before,
    conflicts: conflicts.map((key) => {
      const task = rows.find(row => row.key === key)!
      const predecessor = rows.find(row => row.key === task.predecessorKey)
      return { key, predecessor: `${predecessor?.name || task.predecessorKey}（${task.predecessorKey}）`, successor: `${task.name || task.key}（${task.key}）` }
    }),
  }
  return false
}

function confirmReorder() {
  const pending = pendingReorder.value
  pendingReorder.value = null
  if (!pending || !editable.value || pending.generation !== initializationGeneration || snapshot() !== pending.snapshot)
    return
  const conflictSet = new Set(pending.conflicts.map(conflict => conflict.key))
  tasks.value = pending.rows.map(task => conflictSet.has(task.key)
    ? { ...task, predecessorDisabled: true }
    : task)
}

function focusReorderCancel(event: Event) {
  event.preventDefault()
  void nextTick(() => cancelReorderButton.value?.$el?.focus())
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
  if (!canSave.value)
    return
  const generation = initializationGeneration
  const key = currentKey()
  try {
    const created = await store.saveVersion({
      sourceLibraryId: sourceLibraryId.value,
      code: code.value,
      name: name.value,
      description: description.value,
      tasks: tasks.value,
    }, baseline.value)
    if (!active.value || generation !== initializationGeneration || currentKey() !== key)
      return
    initialSnapshot.value = snapshot()
    allowLeave = true
    success(`已保存 ${created.name} · v${created.version}`)
    const target = { path: `/schedule/process-library/${encodeURIComponent(created.id)}`, query: processLibraryNavigationQuery(origin.value, returnTo.value) }
    tabs.close(formTabKey)
    await router.push(target)
  }
  catch (cause) {
    if (!active.value || generation !== initializationGeneration || currentKey() !== key)
      return
    if (cause instanceof ProjectRepositoryProblem && cause.problem.code === 'conflict')
      needsReview.value = true
    readError.value = toErrorMessage(cause)
    error('标准工序库保存失败', toErrorMessage(cause))
  }
}

async function mayLeave() {
  if (allowLeave || !dirty.value)
    return true
  if (saving.value)
    return false
  const generation = initializationGeneration
  const before = snapshot()
  const approved = await confirm({ variant: 'simple', title: '放弃修改', message: '当前工序库还有未保存内容，确认离开？', confirmLabel: '放弃修改' })
  return approved && generation === initializationGeneration && before === snapshot()
}
useTabCloseGuard(mayLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.query.source === from.query.source && to.query.origin === from.query.origin)
    return true
  return mayLeave()
})

async function cancel() {
  const generation = initializationGeneration
  if (!await mayLeave() || !active.value || generation !== initializationGeneration)
    return
  allowLeave = true
  const target = { path: '/schedule/process-library', query: processLibraryNavigationQuery(origin.value, returnTo.value) }
  tabs.close(formTabKey)
  await router.push(target)
}
</script>

<template>
  <div class="process-library-form flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <Button variant="ghost" size="icon" aria-label="返回标准工序库" @click="cancel">
        <span class="i-lucide-arrow-left" aria-hidden="true" />
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
      v-if="!initialized && !readError"
      kind="loading"
      title="正在读取来源版本"
    />
    <StatePanel
      v-else-if="readError && !initialized"
      kind="error"
      title="来源版本读取失败"
      :description="readError"
      action-label="重试读取"
      @action="initialize(currentRouteSource())"
    />
    <template v-else>
      <section v-if="readError || needsReview || reviewMessage || !store.canWrite" class="panel p-4" aria-live="polite">
        <p v-if="readError" role="alert" class="text-12px text-danger">
          {{ readError }}
        </p>
        <p v-if="needsReview" class="mt-1 text-12px text-ink-soft">
          同编码已有新版本。人工稿已保留，请先核对再保存。
        </p>
        <p v-if="reviewMessage" class="text-12px text-ink-soft">
          {{ reviewMessage }}
        </p>
        <p v-if="!store.canWrite" class="mt-1 text-12px text-ink-soft">
          {{ origin === 'demo' ? '演示来源只读，不能新建版本。' : '尚未确认当前写入权限，人工稿保持不变。' }}
        </p>
        <Button v-if="origin === 'real' && (needsReview || readError || !store.canWrite)" class="mt-2" :disabled="reviewing || saving || loading || !scopeMatches" @click="recheck">
          {{ reviewing ? '正在核对…' : '重新核对当前版本系列' }}
        </Button>
      </section>
      <fieldset :disabled="!editable" class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
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
          @update:tasks="editable && (tasks = $event)"
          @add="addTask"
          @remove="removeTask"
          @move="moveTask"
        />
      </fieldset>

      <footer class="sticky bottom-3 z-3 flex flex-wrap justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <Button :disabled="saving" @click="cancel">
          取消
        </Button>
        <Button variant="accent" :disabled="!canSave" @click="save">
          {{ saving ? '保存中…' : '保存为新版本' }}
        </Button>
      </footer>
    </template>
    <Dialog :open="Boolean(pendingReorder)" @update:open="!$event && (pendingReorder = null)">
      <DialogContent :show-close="false" class="reorder-dialog flex max-h-[90vh] w-[min(560px,92vw)] flex-col p-5" @open-auto-focus="focusReorderCancel">
        <DialogTitle>本次调整会冲突 {{ pendingReorder?.conflicts.length ?? 0 }} 条前置关系</DialogTitle>
        <DialogDescription class="mt-3 text-12px leading-relaxed">
          以下前置工序将不再排在后置工序之前。继续后只把这些关系置灰并保留，可在顺序修复后重新启用。
        </DialogDescription>
        <div class="reorder-relations mt-3 min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-line p-3" tabindex="0" role="region" aria-label="受影响的前置关系，可滚动">
          <ul class="grid gap-3">
            <li v-for="relation in pendingReorder?.conflicts ?? []" :key="relation.key" class="reorder-relation min-w-0 text-12px text-ink">
              <p>前置：{{ relation.predecessor }}</p>
              <p class="my-1 text-ink-faint" aria-hidden="true">
                ↓
              </p>
              <p>后置：{{ relation.successor }}</p>
            </li>
          </ul>
        </div>
        <div class="mt-4 flex shrink-0 flex-wrap justify-end gap-2">
          <Button ref="cancelReorderButton" variant="ghost" @click="pendingReorder = null">
            取消调整
          </Button>
          <Button variant="accent" @click="confirmReorder">
            调整并置灰冲突
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.process-library-form {
  container-type: inline-size;
}

.meta-description {
  grid-column: span 2;
}

.reorder-relations {
  max-height: min(40vh, 20rem);
}

.reorder-relation {
  overflow-wrap: anywhere;
}

@container (max-width: 42rem) {
  .meta-description {
    grid-column: auto;
  }
}
</style>
