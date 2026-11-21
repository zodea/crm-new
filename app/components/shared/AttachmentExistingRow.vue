<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  fileName: string
  category: string
  deleted: boolean
  pendingRemove: boolean
  pendingRestore: boolean
  disabled?: boolean
  readonly?: boolean
}>()

defineEmits<{ toggle: [] }>()
defineSlots<{
  download?: () => unknown
  toggle?: (props: { label: string, tone: string }) => unknown
}>()

const rowClass = computed(() => {
  if (props.pendingRemove)
    return 'bg-danger-soft opacity-65'
  if (props.pendingRestore)
    return 'border-brand/30 bg-brand-soft'
  return props.deleted ? 'bg-surface-2 opacity-65' : 'bg-panel'
})

const toggleLabel = computed(() => {
  if (props.deleted)
    return props.pendingRestore ? '取消恢复' : '恢复'
  return props.pendingRemove ? '撤销删除' : '删除'
})
const toggleTone = computed(() => props.deleted ? 'text-brand' : 'text-danger')
</script>

<template>
  <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2" :class="rowClass">
    <span class="i-lucide-paperclip text-ink-faint" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate text-12px text-ink">{{ fileName }}</span>
    <span class="text-10px text-ink-faint">{{ category || '未分类' }}</span>
    <span v-if="deleted" class="text-10px text-danger">已删除</span>
    <slot name="download" />
    <slot v-if="!readonly" name="toggle" :label="toggleLabel" :tone="toggleTone">
      <button type="button" class="text-11px" :class="toggleTone" :disabled="disabled" @click="$emit('toggle')">
        {{ toggleLabel }}
      </button>
    </slot>
  </div>
</template>
