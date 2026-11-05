<script setup lang="ts">
defineProps<{
  items: readonly { key: string, label: string, count: number | null }[]
  selected: string
}>()
const emit = defineEmits<{ select: [key: string] }>()
</script>

<template>
  <nav aria-label="按归属" class="max-h-48 shrink-0 overflow-auto rounded border border-line bg-panel md:max-h-none md:w-55">
    <h2 class="border-b border-line bg-surface-2 px-3 py-2 text-sm font-700 text-ink-soft">
      按归属
    </h2>
    <div class="grid gap-1 p-2">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm focus-visible:outline"
        :class="selected === item.key ? 'bg-brand-soft font-700 text-brand-deep' : 'text-ink hover:bg-surface-3'"
        :aria-pressed="selected === item.key"
        @click="emit('select', item.key)"
      >
        <span class="min-w-0 break-all">{{ item.label }}</span>
        <span v-if="item.count !== null" class="shrink-0 text-ink-soft">{{ item.count }}</span>
      </button>
    </div>
  </nav>
</template>
