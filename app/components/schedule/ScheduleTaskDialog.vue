<script setup lang="ts">
import type { ScheduleDependencyInput } from '~/lib/schedule/planning'
import type { ScheduleTaskView } from '~/lib/schedule/read-model'

const props = defineProps<{
  task: ScheduleTaskView | null
  groupName: string
  dependency: ScheduleDependencyInput | null
  predecessorTasks: readonly ScheduleTaskView[]
  busy?: boolean
}>()
const emit = defineEmits<{
  save: [payload: {
    task: { plannedStart: string, plannedFinish: string, manualProgress?: number }
    dependency: { predecessorId: string, lagDays: number } | null
  }]
  remove: []
  drill: []
}>()
const open = defineModel<boolean>('open', { required: true })

const plannedStart = shallowRef('')
const plannedFinish = shallowRef('')
const manualPercent = shallowRef(0)
const predecessorId = shallowRef('')
const lagDays = shallowRef(0)

watch([open, () => props.task], ([isOpen, task]) => {
  if (!isOpen || !task)
    return
  plannedStart.value = task.plannedStart
  plannedFinish.value = task.plannedFinish
  manualPercent.value = Math.round((task.manualProgress ?? task.actualProgress) * 100)
  predecessorId.value = props.dependency?.predId ?? props.predecessorTasks.at(-1)?.id ?? ''
  lagDays.value = props.dependency?.lagDays ?? 0
}, { immediate: true })

function save() {
  if (!props.task)
    return
  emit('save', {
    task: {
      plannedStart: plannedStart.value,
      plannedFinish: plannedFinish.value,
      ...(!props.task.hasQty ? { manualProgress: manualPercent.value / 100 } : {}),
    },
    dependency: predecessorId.value
      ? { predecessorId: predecessorId.value, lagDays: lagDays.value }
      : null,
  })
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="task ? `工序详情 · ${task.name}` : '工序详情'"
    :busy="busy"
    save-label="保存调整"
    width="min(680px, calc(100dvw - 24px))"
    @save="save"
    @cancel="open = false"
  >
    <div v-if="task" class="grid gap-4">
      <div class="rounded-lg bg-surface-2 px-3 py-2 text-12px text-ink-soft">
        <span class="font-700 text-ink">{{ groupName }}</span>
        <span class="mx-2 text-line-strong">/</span>
        {{ task.trade }} · {{ task.durationDays }} 天
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label>
          <span class="field-label block">计划开始</span>
          <input v-model="plannedStart" type="date" class="field-input w-full" required>
        </label>
        <label>
          <span class="field-label block">计划完成</span>
          <input v-model="plannedFinish" type="date" class="field-input w-full" required>
        </label>
      </div>

      <section v-if="predecessorTasks.length" class="rounded-lg border border-line p-3">
        <div class="mb-2 text-12px font-800 text-ink">
          FS 前后置关系
        </div>
        <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
          <label>
            <span class="field-label block">前置工序</span>
            <select v-model="predecessorId" class="field-input w-full">
              <option v-for="candidate in predecessorTasks" :key="candidate.id" :value="candidate.id">
                {{ candidate.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="field-label block">Lag（天）</span>
            <input v-model.number="lagDays" type="number" min="-365" max="365" class="field-input w-full">
          </label>
        </div>
      </section>

      <section class="rounded-lg border border-line p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-12px font-800 text-ink">
              实际进度 {{ Math.round(task.actualProgress * 100) }}%
            </div>
            <div class="mt-0.5 text-11px text-ink-faint">
              {{ task.hasQty ? '由工程量阶段完成事实自动派生，不可手填' : '非工程量工序由排程人工填报' }}
            </div>
          </div>
          <button v-if="task.hasQty" type="button" class="btn-primary" @click="emit('drill')">
            查看工程量
          </button>
        </div>
        <input
          v-if="!task.hasQty"
          v-model.number="manualPercent"
          class="mt-3 w-full accent-[var(--brand)]"
          type="range"
          min="0"
          max="100"
          step="5"
          aria-label="人工进度百分比"
        >
        <div v-if="!task.hasQty" class="mt-1 text-right text-12px font-700 text-brand">
          {{ manualPercent }}%
        </div>
      </section>

      <div v-if="task.hasQty" class="grid grid-cols-2 gap-3 text-11px">
        <div class="rounded-lg bg-surface-2 p-3">
          <div class="text-ink-faint">
            计量范围
          </div>
          <div class="mt-1 font-700 text-ink">
            {{ task.itemNames.join('、') || '阶段全部分项' }}
          </div>
        </div>
        <div class="rounded-lg bg-surface-2 p-3">
          <div class="text-ink-faint">
            完成户数
          </div>
          <div class="mt-1 font-700 text-ink">
            {{ task.completedUnits ?? 0 }} / {{ task.applicableUnits ?? 0 }}
          </div>
        </div>
      </div>
    </div>

    <template #actions>
      <Button variant="destructive" :disabled="busy" @click="emit('remove')">
        删除工序
      </Button>
    </template>
  </FormDialog>
</template>

<style scoped>
input[type='date'], input[type='number'], input[type='range'], .font-700.text-brand {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
