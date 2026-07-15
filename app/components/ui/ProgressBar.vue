<script setup lang="ts">
// 细进度条原子：ProcessStepper 的步骤进度与导入页签的行进度共用，
// 保证轨道/动效/无障碍标记只维护一份。
defineProps<{
  percent: number
  tone: 'brand' | 'ok' | 'danger'
  label: string
  valuetext: string
}>()

const TONE_CLASSES: Readonly<Record<'brand' | 'ok' | 'danger', string>> = {
  brand: 'bg-brand',
  ok: 'bg-ok',
  danger: 'bg-danger',
}
</script>

<template>
  <div
    role="progressbar"
    class="h-1.5 overflow-hidden rounded-full bg-surface-3"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
    :aria-valuetext="valuetext"
  >
    <div
      class="h-full rounded-full transition-[width,background-color] duration-[var(--dur-fast)] motion-reduce:transition-none"
      :class="TONE_CLASSES[tone]"
      :style="{ width: `${percent}%` }"
    />
  </div>
</template>
