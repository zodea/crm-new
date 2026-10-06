<script setup lang="ts">
import type { ContractDeductionDraft } from '~/lib/contract/forms'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ deductions: ContractDeductionDraft[] }>()
const emit = defineEmits<{ update: [deductions: ContractDeductionDraft[]] }>()
const total = computed(() => props.deductions.some(row => row.amount == null) ? null : props.deductions.reduce((sum, row) => sum + row.amount!, 0))
function patch(index: number, patch: Partial<ContractDeductionDraft>) {
  emit('update', props.deductions.map((row, current) => current === index ? { ...row, ...patch } : row))
}
function amount(event: Event): number | null {
  const value = (event.target as HTMLInputElement).value
  return value === '' ? null : Number(value)
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden p-4" aria-label="合同独立减项">
    <div class="flex flex-wrap items-center gap-2">
      <strong class="mr-auto text-13px">优惠与扣减</strong><button type="button" class="btn-secondary" data-testid="add-contract-deduction" @click="emit('update', [...deductions, { name: '', amount: null, basis: '' }])">
        增加减项
      </button>
    </div>
    <p class="mt-2 text-12px text-ink-soft">
      扣减金额填写正值，合计按负额纳入一次；原材料数量和单价保留。
    </p>
    <div v-for="(row, index) in deductions" :key="row.id ?? index" class="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-4">
      <label class="field-block"><span class="field-label">减项名称 *</span><input class="field-input" :value="row.name" :aria-label="`减项名称，第 ${index + 1} 行`" @input="patch(index, { name: ($event.target as HTMLInputElement).value })"></label>
      <label class="field-block"><span class="field-label">扣减金额 *</span><input class="field-input" type="number" min="0.01" step="0.01" :value="row.amount" :aria-label="`扣减金额，第 ${index + 1} 行`" @input="patch(index, { amount: amount($event) })"></label>
      <label class="field-block"><span class="field-label">依据 *</span><input class="field-input" :value="row.basis" :aria-label="`减项依据，第 ${index + 1} 行`" @input="patch(index, { basis: ($event.target as HTMLInputElement).value })"></label>
      <div class="flex items-end gap-2">
        <span class="mr-auto">{{ row.amount == null ? '金额待填' : yuan(-row.amount) }}</span><button type="button" class="btn-ghost" :aria-label="`删除减项，第 ${index + 1} 行`" @click="emit('update', deductions.filter((_, current) => current !== index))">
          删除
        </button>
      </div>
    </div>
    <p class="mt-3 text-right text-12px">
      减项合计：{{ total == null ? '待完善' : yuan(-total) }}
    </p>
  </section>
</template>
