<script setup lang="ts">
import { computed } from 'vue'

type ProcessStepStatus = 'pending' | 'active' | 'completed' | 'failed'

interface ProcessStepperStep {
  readonly id: string
  readonly label: string
  readonly status: ProcessStepStatus
}

const props = defineProps<{
  steps: readonly ProcessStepperStep[]
}>()

interface StatusStyle {
  label: string
  marker: string
  text: string
  connector: string
}

const STATUS_STYLES: Readonly<Record<ProcessStepStatus, StatusStyle>> = {
  pending: {
    label: '等待中',
    marker: 'border-line bg-panel text-ink-faint',
    text: 'text-ink-faint',
    connector: 'bg-line',
  },
  active: {
    label: '进行中',
    marker: 'border-brand bg-brand-soft text-brand',
    text: 'font-700 text-brand-deep',
    connector: 'bg-brand',
  },
  completed: {
    label: '已完成',
    marker: 'border-ok bg-ok-soft text-ok',
    text: 'font-600 text-ok-ink',
    connector: 'bg-ok',
  },
  failed: {
    label: '失败',
    marker: 'border-danger bg-danger-soft text-danger',
    text: 'font-600 text-danger-ink',
    connector: 'bg-danger',
  },
}

const completedCount = computed(() =>
  props.steps.filter(step => step.status === 'completed').length,
)
const activeStep = computed(() =>
  props.steps.find(step => step.status === 'active'),
)
const failedStep = computed(() =>
  props.steps.find(step => step.status === 'failed'),
)

const progressPercent = computed(() => {
  if (props.steps.length === 0)
    return 0

  const activePart = failedStep.value || !activeStep.value ? 0 : 0.5
  const progress = (completedCount.value + activePart) / props.steps.length

  return Math.round(Math.min(progress, 1) * 100)
})

const progressLabel = computed(() => {
  const summary = `已完成 ${completedCount.value}/${props.steps.length} 步`

  if (failedStep.value)
    return `${summary}，${failedStep.value.label}失败`
  if (activeStep.value)
    return `${summary}，正在${activeStep.value.label}`
  if (props.steps.length > 0 && completedCount.value === props.steps.length)
    return `${summary}，流程完成`

  return summary
})

const progressTone = computed<'brand' | 'ok' | 'danger'>(() => {
  if (failedStep.value)
    return 'danger'
  if (props.steps.length > 0 && completedCount.value === props.steps.length)
    return 'ok'
  return 'brand'
})
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-3 text-12px">
        <span class="font-600 text-ink-soft">处理进度</span>
        <span class="font-mono tabular-nums text-ink" aria-live="polite">
          {{ progressPercent }}%
        </span>
      </div>
      <ProgressBar
        :percent="progressPercent"
        :tone="progressTone"
        label="处理进度"
        :valuetext="progressLabel"
      />
    </div>

    <ol class="flex items-start" aria-label="处理步骤">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="relative min-w-0 flex flex-1 flex-col items-center gap-1.5 text-center"
        :data-state="step.status"
        :aria-current="step.status === 'active' ? 'step' : undefined"
      >
        <span
          v-if="index > 0"
          aria-hidden="true"
          class="absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 transition-colors duration-[var(--dur-fast)] motion-reduce:transition-none"
          :class="STATUS_STYLES[step.status].connector"
        />

        <span
          aria-hidden="true"
          class="relative z-1 grid h-6 w-6 place-items-center border rounded-full text-11px font-700 transition-colors duration-[var(--dur-fast)] motion-reduce:transition-none"
          :class="STATUS_STYLES[step.status].marker"
        >
          <span v-if="step.status === 'completed'" class="i-lucide-check h-3.5 w-3.5" />
          <span v-else-if="step.status === 'failed'" class="i-lucide-x h-3.5 w-3.5" />
          <span
            v-else-if="step.status === 'active'"
            class="h-2 w-2 rounded-full bg-brand animate-pulse motion-reduce:animate-none"
          />
          <span v-else>{{ index + 1 }}</span>
        </span>

        <span class="max-w-full truncate text-12px" :class="STATUS_STYLES[step.status].text">
          {{ step.label }}
        </span>
        <span class="text-10px" :class="STATUS_STYLES[step.status].text">
          <span class="sr-only">状态：</span>{{ STATUS_STYLES[step.status].label }}
        </span>
      </li>
    </ol>
  </div>
</template>
