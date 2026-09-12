<script setup lang="ts">
import type { QuantityBoqLine } from '~/lib/quantity/central-boq'
import { computed } from 'vue'
import { formatQuantityValue } from '~/lib/quantity/format'

const props = defineProps<{
  value?: string | null
  originalId?: string | null
  recognizedQty: number | null
  lines: readonly QuantityBoqLine[]
  loading?: boolean
  error?: string
}>()
const emit = defineEmits<{ change: [id: string | null] }>()
const selectedId = computed(() => props.value === undefined ? props.originalId ?? '' : props.value ?? '')
const selected = computed(() => props.lines.find(line => line.id === selectedId.value))
const pendingLink = computed(() => Boolean(selected.value && selectedId.value !== (props.originalId ?? '')))
const recognized = computed(() => pendingLink.value ? selected.value!.qty : props.recognizedQty)
const label = computed(() => {
  const value = recognized.value == null ? '未记录' : formatQuantityValue(recognized.value)
  if (!selectedId.value)
    return `原识别值：${value}（${props.originalId ? '已解除关联' : '未关联清单'}）`
  return `${pendingLink.value ? '待保存原识别量' : '原识别量'}：${value}`
})
</script>

<template>
  <div class="grid min-w-0 gap-1.5">
    <select
      :value="selectedId"
      class="field-input w-full min-w-0"
      aria-label="关联合同清单"
      :disabled="loading || Boolean(error)"
      @change="emit('change', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">
        未关联清单
      </option>
      <option v-if="selectedId && !selected" :value="selectedId">
        当前关联暂不可用 · {{ selectedId }}
      </option>
      <option v-for="line in lines" :key="line.id" :value="line.id">
        {{ line.contractNo || line.contractName }} · {{ line.itemName }} · {{ line.unit || '单位未记录' }} · 原量 {{ line.qty == null ? '未记录' : formatQuantityValue(line.qty) }}
      </option>
    </select>
    <span class="text-10px text-ink-soft">{{ label }}</span>
    <span v-if="loading" class="text-10px text-ink-faint" role="status">正在读取当前项目清单…</span>
    <span v-else-if="error" class="text-10px text-danger" role="alert">{{ error }}</span>
  </div>
</template>
