<script setup lang="ts">
import { yuan } from '~/lib/util/money'

defineProps<{
  total: number
  items: readonly { label: string, value: number }[]
}>()
</script>

<template>
  <footer class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border border-line rounded-[var(--radius-card)] bg-panel px-3 py-2.5 shadow-[var(--shadow-card)]">
    <span class="text-12px text-ink-faint">共 {{ total }} 份</span>
    <span v-for="item in items" :key="item.label" class="text-12px text-ink-soft">
      {{ item.label }}
      <span class="ml-1 font-mono font-700 tabular-nums text-ink">{{ yuan(item.value) }}</span>
    </span>
  </footer>
</template>
