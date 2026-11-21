<script setup lang="ts">
defineProps<{
  description: string
  disabled?: boolean
  inputTestId?: string
}>()

const emit = defineEmits<{ files: [files: File[]] }>()

function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  emit('files', [...(input.files ?? [])])
  input.value = ''
}
</script>

<template>
  <label class="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-2 px-4 text-center transition-colors hover:border-brand hover:bg-brand-soft">
    <span class="i-lucide-upload-cloud mb-1 text-22px text-brand" aria-hidden="true" />
    <span class="text-12px font-600 text-ink">点击选择附件</span>
    <span class="mt-0.5 text-11px text-ink-faint">{{ description }}</span>
    <input
      type="file"
      multiple
      class="sr-only"
      :disabled="disabled"
      :data-testid="inputTestId"
      @change="handleFiles"
    >
  </label>
</template>
