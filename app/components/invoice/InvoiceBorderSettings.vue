<script setup lang="ts">
import type { InvoiceBorderSide, InvoiceBorderStyle } from '~/lib/invoice/xlsx-border'

const props = defineProps<{ label: string, modelValue: InvoiceBorderStyle }>()
const emit = defineEmits<{ 'update:modelValue': [value: InvoiceBorderStyle] }>()
const sides = [
  { key: 'top', label: '上边框' },
  { key: 'bottom', label: '下边框' },
  { key: 'left', label: '左边框' },
  { key: 'right', label: '右边框' },
] as const
const styles = [
  { value: 'thin', label: '细线' },
  { value: 'medium', label: '中线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'none', label: '无' },
]

function update(side: keyof InvoiceBorderStyle, field: keyof InvoiceBorderSide, event: Event) {
  const value = (event.target as HTMLInputElement | HTMLSelectElement).value
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], [field]: value },
  })
}
</script>

<template>
  <fieldset class="m-0 min-w-0 border-0 p-0" :aria-label="`${label}边框`">
    <legend class="mb-2 text-11px font-800 text-ink">
      {{ label }}边框
    </legend>
    <div class="grid gap-2">
      <div v-for="side in sides" :key="side.key" class="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2">
        <span class="text-10px text-ink-soft">{{ side.label }}</span>
        <select :value="modelValue[side.key].style" :aria-label="`${label}${side.label}线型`" class="field-input min-w-0 w-full text-11px" @change="update(side.key, 'style', $event)">
          <option v-if="!styles.some(option => option.value === modelValue[side.key].style)" :value="modelValue[side.key].style">
            原线型（{{ modelValue[side.key].style }}）
          </option>
          <option v-for="option in styles" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input :value="modelValue[side.key].color" :aria-label="`${label}${side.label}颜色`" class="field-input min-w-0 w-full font-mono text-11px" placeholder="自动黑色" spellcheck="false" @input="update(side.key, 'color', $event)">
      </div>
    </div>
  </fieldset>
</template>
