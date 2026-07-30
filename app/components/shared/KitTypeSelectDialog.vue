<script setup lang="ts">
import type { TypeSelectOptions } from '~/composables/useKitUI'
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  open: boolean
  options: TypeSelectOptions | null
}>()

const emit = defineEmits<{
  select: [value: string]
  cancel: []
}>()

const selectedValue = shallowRef('')
const radioName = useId()
const optionInputs = useTemplateRef<HTMLInputElement[]>('optionInputs')
const footer = useTemplateRef<HTMLElement>('footer')

const items = computed(() => props.options?.options ?? [])
const selectedIndex = computed(() =>
  items.value.findIndex(option => option.value === selectedValue.value),
)
const canConfirm = computed(() => selectedIndex.value >= 0)

function resetSelection() {
  const requested = props.options?.defaultValue
  const fallback = items.value[0]?.value ?? ''
  selectedValue.value = requested && items.value.some(option => option.value === requested)
    ? requested
    : fallback
}

function focusSelected() {
  nextTick(() => {
    const selected = optionInputs.value?.find(input => input.value === selectedValue.value)
    const target = selected ?? optionInputs.value?.[0]
    const fallback = footer.value?.querySelector<HTMLButtonElement>('button')
    const focusTarget = target ?? fallback
    focusTarget?.focus()
  })
}

watch([() => props.open, () => props.options], ([open]) => {
  if (open) {
    resetSelection()
    focusSelected()
  }
}, { immediate: true })

function confirmSelection(value = selectedValue.value) {
  if (items.value.some(option => option.value === value))
    emit('select', value)
}

function onOpenChange(open: boolean) {
  if (!open)
    emit('cancel')
}

function onOpenAutoFocus(event: Event) {
  event.preventDefault()
  focusSelected()
}

function moveSelection(step: -1 | 1) {
  if (!items.value.length)
    return
  const current = selectedIndex.value >= 0 ? selectedIndex.value : 0
  const next = (current + step + items.value.length) % items.value.length
  selectedValue.value = items.value[next]!.value
  focusSelected()
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
  }
  else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    confirmSelection()
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      v-if="options"
      :show-close="false"
      class="kit-type-select-dialog w-[min(560px,calc(100dvw-32px))] p-0"
      @open-auto-focus="onOpenAutoFocus"
    >
      <div class="border-b border-line px-5 py-4">
        <DialogTitle>{{ options.title }}</DialogTitle>
        <DialogDescription class="mt-1 text-12px leading-5">
          请选择业务类型，确认后进入对应表单。
        </DialogDescription>
      </div>

      <fieldset
        class="grid max-h-[min(58dvh,480px)] gap-2 overflow-y-auto p-5"
        @keydown="onListKeydown"
      >
        <legend class="sr-only">
          业务类型
        </legend>
        <label
          v-for="option in items"
          :key="option.value"
          class="kit-type-select-option"
          :class="{ 'kit-type-select-option--selected': selectedValue === option.value }"
          @dblclick="confirmSelection(option.value)"
        >
          <input
            ref="optionInputs"
            v-model="selectedValue"
            type="radio"
            :name="radioName"
            :value="option.value"
            class="h-4 w-4 shrink-0 accent-[var(--brand)]"
          >
          <span class="min-w-0">
            <span class="block text-13px font-700 text-ink">{{ option.label }}</span>
            <span v-if="option.hint" class="mt-0.5 block text-11px leading-4 text-ink-faint">
              {{ option.hint }}
            </span>
          </span>
        </label>
      </fieldset>

      <div ref="footer" class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" @click="emit('cancel')">
          {{ options.cancelLabel ?? '取消' }}
        </Button>
        <Button variant="accent" :disabled="!canConfirm" @click="confirmSelection()">
          {{ options.confirmLabel ?? '确定' }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.kit-type-select-dialog {
  container-type: inline-size;
  max-height: min(86dvh, calc(100svh - 24px));
}

.kit-type-select-option {
  display: flex;
  min-height: 48px;
  cursor: pointer;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--panel);
  padding: 9px 11px;
  transition:
    border-color var(--dur-fast),
    background-color var(--dur-fast);
}

.kit-type-select-option:hover {
  border-color: var(--brand);
  background: var(--surface-2);
}

.kit-type-select-option:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.kit-type-select-option--selected {
  border-color: var(--brand);
  background: var(--brand-soft);
}
</style>
