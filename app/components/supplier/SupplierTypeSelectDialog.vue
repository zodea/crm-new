<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': [category: string]
}>()

const selectedCategory = shallowRef(SUPPLIER_CATEGORIES[0]!)

watch(
  () => props.open,
  (open) => {
    if (open)
      selectedCategory.value = SUPPLIER_CATEGORIES[0]!
  },
)

function close() {
  emit('update:open', false)
}

function confirmSelection() {
  emit('confirm', selectedCategory.value)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[min(480px,calc(100dvw-32px))] p-5">
      <DialogTitle>
        选择分供方类别
      </DialogTitle>
      <DialogDescription class="mt-1 text-12px leading-5">
        先确定业务类别，再进入独立新建表单；类别会预填，未产生业务引用前仍可修正。
      </DialogDescription>

      <fieldset class="mt-4 grid gap-2 sm:grid-cols-2">
        <legend class="sr-only">
          分供方类别
        </legend>
        <label
          v-for="category in SUPPLIER_CATEGORIES"
          :key="category"
          class="supplier-type-option"
          :class="{ 'supplier-type-option--selected': selectedCategory === category }"
        >
          <input
            v-model="selectedCategory"
            type="radio"
            name="supplier-category"
            :value="category"
            class="h-3.5 w-3.5 shrink-0 accent-[var(--brand)]"
          >
          <span class="text-13px font-600 text-ink">{{ category }}</span>
        </label>
      </fieldset>

      <div class="mt-5 flex items-center justify-end gap-2">
        <Button variant="outline" @click="close">
          取消
        </Button>
        <Button variant="accent" @click="confirmSelection">
          进入新建表单
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.supplier-type-option {
  display: flex;
  min-height: 42px;
  cursor: pointer;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--panel);
  padding: 8px 10px;
}

.supplier-type-option:hover {
  border-color: var(--brand);
  background: var(--surface-2);
}

.supplier-type-option:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.supplier-type-option--selected {
  border-color: var(--brand);
  background: var(--brand-soft);
}
</style>
