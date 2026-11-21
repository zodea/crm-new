<script setup lang="ts">
defineProps<{
  fileName: string
  category?: string
  categoryReadonly?: boolean
  compactCategory?: boolean
  disabled?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  updateCategory: [category: string]
  remove: []
}>()
defineSlots<{ remove?: () => unknown }>()

function updateCategory(event: Event) {
  emit('updateCategory', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-brand/30 bg-brand-soft px-3 py-2">
    <span class="i-lucide-file-plus-2 text-brand" aria-hidden="true" />
    <span class="min-w-36 flex-1 truncate text-12px text-ink">{{ fileName }}</span>
    <input
      :value="category"
      :disabled="disabled || readonly"
      :readonly="categoryReadonly"
      class="field-input h-7 text-11px"
      :class="compactCategory ? 'w-32' : 'w-36'"
      aria-label="附件分类"
      @input="updateCategory"
    >
    <slot v-if="!readonly" name="remove">
      <button type="button" class="text-11px text-danger" :disabled="disabled" @click="emit('remove')">
        移除
      </button>
    </slot>
  </div>
</template>
