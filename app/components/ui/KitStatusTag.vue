<script setup lang="ts">
export type KitStatusTone = 'ok' | 'warn' | 'brand' | 'danger' | 'neutral'

withDefaults(defineProps<{
  tone?: KitStatusTone
}>(), { tone: 'neutral' })

const toneClasses: Record<KitStatusTone, string> = {
  ok: 'bg-ok-soft text-ok-ink',
  warn: 'bg-warn-soft text-warn-ink',
  brand: 'bg-brand-soft text-brand-deep',
  danger: 'bg-danger-soft text-danger-ink',
  neutral: 'bg-surface-3 text-ink-soft',
}
</script>

<template>
  <span
    data-ui="status-tag"
    :data-tone="tone"
    class="inline-flex shrink-0 items-center whitespace-nowrap rounded-[2px] px-1 py-px text-11px font-500 leading-[14px]"
    :class="toneClasses[tone]"
  ><slot /></span>
</template>
