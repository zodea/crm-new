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
    floorPlans: { id: string, plannedStart: string, plannedFinish: string }[]
  }]
  remove: []
  drill: []
  editDependency: []
}>()
const open = defineModel<boolean>('open', { required: true })

const plannedStart = shallowRef('')
const plannedFinish = shallowRef('')
const manualPercent = shallowRef(0)
const floorPlans = ref<{ id: string, plannedStart: string, plannedFinish: string }[]>([])
const predecessor = computed(() =>
  props.predecessorTasks.find(task => task.id === props.dependency?.predId) ?? null,
)
const dependencySummary = computed(() => {
  if (!props.dependency)
    return '尚未设置前置工序'
  const predecessorName = predecessor.value?.name ?? '当前前置工序'
  if (!props.dependency.lagDays)
    return `${predecessorName}完成后，${props.task?.name ?? '当前工序'}即可开始`
  if (props.dependency.lagDays > 0)
    return `${predecessorName}完成后等待 ${props.dependency.lagDays} 天，${props.task?.name ?? '当前工序'}开始`
  return `${props.task?.name ?? '当前工序'}可在${predecessorName}完成前 ${Math.abs(props.dependency.lagDays)} 天搭接`
})

watch([open, () => props.task], ([isOpen, task]) => {
  if (!isOpen || !task)
    return
  plannedStart.value = task.plannedStart
  plannedFinish.value = task.plannedFinish
  manualPercent.value = Math.round((task.manualProgress ?? task.actualProgress) * 100)
  floorPlans.value = task.floorPlans.map(plan => ({
    id: plan.id,
    plannedStart: plan.plannedStart,
    plannedFinish: plan.plannedFinish,
  }))
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
    dependency: null,
    floorPlans: floorPlans.value.filter((plan) => {
      const current = props.task?.floorPlans.find(candidate => candidate.id === plan.id)
      return current
        && (
          current.plannedStart !== plan.plannedStart
          || current.plannedFinish !== plan.plannedFinish
        )
    }),
  })
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="task ? `工序详情 · ${task.name}` : '工序详情'"
    :busy="busy"
    save-label="保存调整"
    width="min(860px, calc(100dvw - 24px))"
    @save="save"
    @cancel="open = false"
  >
    <div v-if="task" class="grid gap-4">
      <div class="rounded-lg bg-surface-2 px-3 py-2 text-12px text-ink-soft">
        <span class="font-700 text-ink">{{ groupName }}</span>
        <span class="mx-2 text-line-strong">/</span>
        {{ task.trade }} · <span class="numeric">{{ task.durationDays }}</span> 天
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

      <section class="rounded-lg border border-line p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-12px font-800 text-ink">
              前后置依赖
            </div>
            <p class="mt-0.5 truncate text-11px text-ink-faint" :title="dependencySummary">
              {{ dependencySummary }}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            :disabled="busy || (!dependency && !predecessorTasks.length)"
            :title="!dependency && !predecessorTasks.length ? '当前没有同组且计划日期更早的工序' : undefined"
            @click="emit('editDependency')"
          >
            {{ dependency ? '修改依赖' : '设置依赖' }}
          </Button>
        </div>
      </section>

      <section v-if="task.floorPlans.length" class="rounded-lg border border-line p-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div class="text-12px font-800 text-ink">
              分项 × 楼层计划
            </div>
            <p class="mt-0.5 text-11px text-ink-faint">
              默认按工序窗口逐层分摊；改动某层后，仅该层转为人工微调。
            </p>
          </div>
          <span class="status-info">{{ task.floorPlans.length }} 条</span>
        </div>
        <div class="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
          <div
            v-for="(plan, index) in floorPlans"
            :key="plan.id"
            class="grid gap-2 rounded-lg bg-surface-2 p-2.5 sm:grid-cols-[minmax(150px,1fr)_150px_150px]"
          >
            <div class="min-w-0 self-center">
              <div class="truncate text-12px font-700 text-ink">
                {{ task.floorPlans[index]?.itemName }}
              </div>
              <div class="mt-0.5 text-11px text-ink-faint">
                {{ task.floorPlans[index]?.buildingName }} · {{ task.floorPlans[index]?.floorName }}
                <span v-if="task.floorPlans[index]?.isManual" class="ml-1 text-warning">已微调</span>
              </div>
            </div>
            <label>
              <span class="field-label block">开始</span>
              <input v-model="plan.plannedStart" type="date" class="field-input w-full" required>
            </label>
            <label>
              <span class="field-label block">完成</span>
              <input v-model="plan.plannedFinish" type="date" class="field-input w-full" required>
            </label>
          </div>
        </div>
      </section>

      <section class="rounded-lg border border-line p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="numeric text-12px font-800 text-ink">
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
          <div class="numeric mt-1 font-700 text-ink">
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

.numeric {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
