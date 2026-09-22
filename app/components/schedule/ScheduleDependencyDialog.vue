<script setup lang="ts">
import type { ScheduleDependencyInput } from '~/lib/schedule/planning'
import type {
  ScheduleDisabledDependencyView,
  ScheduleTaskView,
} from '~/lib/schedule/read-model'
import ScheduleCommandRecovery from '~/components/schedule/ScheduleCommandRecovery.vue'
import {
  dependencyConflictPreview,
  dependencyWouldCycle,
  normalizeDependencyLag,
} from '~/lib/schedule/planning'

const props = defineProps<{
  task: ScheduleTaskView | null
  groupName: string
  groupTasks: readonly ScheduleTaskView[]
  dependencies: readonly ScheduleDependencyInput[]
  dependency: ScheduleDependencyInput | null
  disabledDependencies: readonly ScheduleDisabledDependencyView[]
  busy?: boolean
  readonly?: boolean
  pending?: boolean
  readError?: string
}>()

const emit = defineEmits<{
  save: [payload: { predecessorId: string, lagDays: number }]
  remove: [dependencyId: string]
  restore: [dependencyId: string]
  requestClose: [dirty: boolean]
  recover: []
  recheck: []
}>()

const open = defineModel<boolean>('open', { required: true })
const predecessorId = shallowRef('')
const lagDays = shallowRef(0)
const validationMessage = shallowRef('')
const initialPredecessorId = shallowRef('')
const initialLagDays = shallowRef(0)
let closeRequestQueued = false

const candidates = computed(() => {
  if (!props.task)
    return []
  return props.groupTasks
    .filter(candidate =>
      candidate.id !== props.task!.id
      && candidate.groupId === props.task!.groupId
      && candidate.plannedStart < props.task!.plannedStart,
    )
    .sort((left, right) =>
      left.plannedStart.localeCompare(right.plannedStart)
      || left.sortOrder - right.sortOrder,
    )
})

const predecessorOptions = computed(() => candidates.value.map(task => ({
  key: task.id,
  label: `${task.name} · ${task.plannedStart}—${task.plannedFinish}`,
})))
const predecessor = computed(() => candidates.value.find(task => task.id === predecessorId.value) ?? null)
const lagError = computed(() => {
  try {
    normalizeDependencyLag(lagDays.value)
    return ''
  }
  catch (cause) {
    return cause instanceof Error ? cause.message : 'Lag 天数不合法'
  }
})
const cycleError = computed(() => {
  if (!props.task || !predecessorId.value)
    return ''
  return dependencyWouldCycle(props.dependencies, {
    predecessorId: predecessorId.value,
    successorId: props.task.id,
    excludeDependencyId: props.dependency?.id,
  })
    ? '该选择会形成循环依赖，请改选其他前置工序'
    : ''
})
const preview = computed(() => {
  if (!props.task || !predecessor.value || lagError.value)
    return null
  return dependencyConflictPreview({
    predecessorFinish: predecessor.value.plannedFinish,
    successorStart: props.task.plannedStart,
    lagDays: lagDays.value,
  })
})
const naturalSummary = computed(() => {
  if (!props.task || !predecessor.value)
    return ''
  if (!lagDays.value)
    return `${predecessor.value.name}完成后，${props.task.name}即可开始`
  if (lagDays.value > 0)
    return `${predecessor.value.name}完成后等待 ${lagDays.value} 天，${props.task.name}开始`
  return `${props.task.name}可在${predecessor.value.name}完成前 ${Math.abs(lagDays.value)} 天搭接`
})
const canSave = computed(() =>
  Boolean(props.task && predecessor.value)
  && !lagError.value
  && !cycleError.value
  && !props.busy
  && !props.pending && !props.readonly,
)
const isDirty = computed(() =>
  predecessorId.value !== initialPredecessorId.value
  || lagDays.value !== initialLagDays.value,
)
const disabledForTask = computed(() => props.task
  ? props.disabledDependencies.filter(dependency => dependency.succId === props.task!.id)
  : [])

watch([open, () => props.task?.id], ([isOpen]) => {
  if (!isOpen)
    return
  predecessorId.value = props.dependency?.predId ?? candidates.value.at(-1)?.id ?? ''
  lagDays.value = props.dependency?.lagDays ?? 0
  initialPredecessorId.value = predecessorId.value
  initialLagDays.value = lagDays.value
  validationMessage.value = ''
}, { immediate: true })

function requestClose(event?: Event) {
  event?.preventDefault()
  if (props.busy || props.pending || closeRequestQueued)
    return
  closeRequestQueued = true
  queueMicrotask(() => {
    closeRequestQueued = false
  })
  emit('requestClose', isDirty.value)
}

function save() {
  validationMessage.value = lagError.value || cycleError.value
    || (!predecessor.value ? '请选择同一楼栋分组内、计划日期更早的前置工序' : '')
  if (!canSave.value)
    return
  emit('save', {
    predecessorId: predecessorId.value,
    lagDays: normalizeDependencyLag(lagDays.value),
  })
}

function taskName(taskId: string): string {
  return props.groupTasks.find(task => task.id === taskId)?.name ?? '已删除工序'
}
</script>

<template>
  <Dialog :open="open" @update:open="value => !value && requestClose()">
    <DialogContent
      :show-close="false"
      class="dependency-dialog flex max-h-[min(84dvh,720px)] w-[min(440px,calc(100dvw-24px))] flex-col overflow-hidden p-0"
      :aria-busy="busy"
      @escape-key-down="requestClose"
      @keydown.esc.stop.prevent="requestClose"
    >
      <header class="flex flex-none items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div class="min-w-0">
          <DialogTitle>依赖设置<span v-if="task"> · {{ task.name }}</span></DialogTitle>
          <p class="mt-1 text-11px text-ink-faint">
            楼栋分组：{{ groupName }}
          </p>
        </div>
        <button type="button" class="icon-btn flex-none" aria-label="关闭" :disabled="busy || pending" @click="requestClose()">
          <span class="i-lucide-x text-14px" />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <ScheduleCommandRecovery v-if="pending" :busy="busy" @recover="emit('recover')" @recheck="emit('recheck')" />
        <div v-if="readError && !pending" class="rounded bg-warning/8 p-3 text-12px" role="alert">
          <p>{{ readError }}；依赖输入仍保留。</p>
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('recheck')">
            重新核对权限与资料
          </Button>
        </div>
        <div v-if="task" class="grid gap-4">
          <div class="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-11px">
            <span class="text-ink-faint">关系类型</span>
            <strong class="text-ink">完成 → 开始（FS）</strong>
          </div>

          <section class="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_112px]">
            <div class="min-w-0">
              <span class="field-label block">前置工序</span>
              <SelectFilter
                v-model="predecessorId"
                aria-label="前置工序"
                :options="predecessorOptions"
                :disabled="busy || pending || readonly || !predecessorOptions.length"
                :min-width="220"
                full-width
                :placeholder="predecessorOptions.length ? '请选择前置工序' : '没有符合日期条件的工序'"
              />
            </div>
            <label>
              <span class="field-label block">Lag（天）</span>
              <input
                v-model.number="lagDays"
                :disabled="busy || pending || readonly"
                aria-label="Lag 天数"
                type="number"
                min="-365"
                max="365"
                class="field-input w-full"
              >
            </label>
          </section>

          <section
            v-if="predecessor && preview"
            class="dependency-preview rounded-lg border p-3"
            :class="preview.hasConflict ? 'border-warning bg-warning-soft' : 'border-ok/35 bg-ok-soft'"
            aria-live="polite"
          >
            <div class="text-12px font-800 text-ink">
              {{ naturalSummary }}
            </div>
            <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-11px">
              <dt class="text-ink-faint">
                前置计划完成
              </dt>
              <dd class="numeric text-right">
                {{ predecessor.plannedFinish }}
              </dd>
              <dt class="text-ink-faint">
                最早允许开始
              </dt>
              <dd class="numeric text-right">
                {{ preview.earliestStart }}
              </dd>
              <dt class="text-ink-faint">
                当前计划开始
              </dt>
              <dd class="numeric text-right">
                {{ task.plannedStart }}
              </dd>
            </dl>
            <p class="mt-2 text-11px font-700" :class="preview.hasConflict ? 'text-warning' : 'text-ok'">
              {{ preview.hasConflict
                ? `当前计划提前了 ${preview.conflictDays} 天；保存关系不会自动改期。`
                : '当前计划满足依赖关系。' }}
            </p>
          </section>

          <p v-if="lagError || cycleError || validationMessage" role="alert" class="text-11px text-danger">
            {{ lagError || cycleError || validationMessage }}
          </p>

          <section v-if="disabledForTask.length" class="rounded-lg border border-line bg-surface-2 p-3">
            <div class="text-12px font-800 text-ink">
              已禁用的冲突关系
            </div>
            <p class="mt-0.5 text-11px text-ink-faint">
              调期确认后只置灰关系，不清除记录；日期修复且无循环时可恢复。
            </p>
            <div class="mt-2 grid gap-2">
              <div
                v-for="disabled in disabledForTask"
                :key="disabled.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-2.5 py-2 text-11px text-ink-faint"
              >
                <span class="line-through">
                  {{ taskName(disabled.predId) }} → {{ taskName(disabled.succId) }}
                  · FS{{ disabled.lagDays >= 0 ? '+' : '' }}{{ disabled.lagDays }}
                </span>
                <Button variant="outline" size="sm" :disabled="busy || pending || readonly" @click="emit('restore', disabled.id)">
                  恢复关系
                </Button>
                <span class="w-full text-10px no-underline">
                  原因：调期冲突 · {{ disabled.disabledAt }}
                  <span :title="`操作日志 ${disabled.auditLogId}`">· 已留审计</span>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer class="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <Button
          v-if="dependency"
          variant="destructive"
          :disabled="busy || pending || readonly"
          @click="emit('remove', dependency.id)"
        >
          移除依赖
        </Button>
        <span class="min-w-0 flex-1" />
        <Button variant="outline" :disabled="busy || pending" @click="requestClose()">
          取消
        </Button>
        <Button variant="accent" :disabled="!canSave" @click="save">
          保存依赖
        </Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.dependency-dialog { container-type: inline-size; }
.numeric { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
@container (max-width: 30rem) {
  .dependency-dialog header, .dependency-dialog footer { padding-inline: 16px; }
  .dependency-dialog > div { padding: 16px; }
}
</style>
