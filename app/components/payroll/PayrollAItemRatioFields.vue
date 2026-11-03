<script setup lang="ts">
import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import type { PayrollAFeeRatio, PayrollARatioPlan } from '~/lib/payroll/central-a-item-ratio'
import { computed } from 'vue'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'

const props = defineProps<{ read: PayrollAFormRead, plan: PayrollARatioPlan, disabled: boolean }>()
const emit = defineEmits<{ change: [plan: PayrollARatioPlan], preview: [] }>()
const items = computed(() => props.plan.itemRatios.map((entry) => {
  const line = props.read.lines.find(line => line.itemId === entry.itemId)
  return { ...entry, name: line?.itemName || '分项名称未记录', missing: !line }
}))
const fees = computed(() => {
  if (!hasPayrollAFeesForm(props.read) || !props.read.fees)
    return []
  const entries = [
    ...props.plan.feeRatios.map(entry => ({ kind: entry.kind, id: entry.id, name: '原费用已变化，请清除单独比例后重新核对' })),
    ...props.read.fees.lines.map(line => ({ kind: 'fee' as const, id: line.feeId, name: line.name })),
    ...props.read.fees.negativeLines.filter(line => !line.removed).map(line => ({ kind: 'negative' as const, id: line.lineId, name: line.label })),
  ]
  return [...new Map(entries.map(entry => [JSON.stringify([entry.kind, entry.id]), entry])).values()]
})
function input(event: Event) {
  const value = payrollInputNumber((event.target as HTMLInputElement).value)
  return value === null ? null : value / 100
}
function item(itemId: string, ratio: number | null) {
  emit('change', { ...props.plan, itemRatios: props.plan.itemRatios.map(row => row.itemId === itemId ? { ...row, ratio } : row) })
}
function fee(kind: PayrollAFeeRatio['kind'], id: string, ratio: number | null) {
  const feeRatios = props.plan.feeRatios.filter(row => row.kind !== kind || row.id !== id)
  if (ratio !== null)
    feeRatios.push({ kind, id, ratio })
  emit('change', { ...props.plan, feeRatios })
}
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="工程量分项支付比例">
    <SectionHeader title="工程量分项支付比例" />
    <p class="text-12px text-ink-soft">
      相同工作带出同簿上月比例；新增工作须填写。费用留空时采用整单默认比例，填写后单独计算。
    </p>
    <p v-if="!items.length" class="text-12px text-ink-faint">
      当前没有工程量分项。
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      <div v-for="entry in items" :key="entry.itemId" class="grid min-w-0 gap-1 text-12px">
        <label class="grid gap-1">{{ entry.name }}（%）<input :value="entry.ratio === null ? '' : entry.ratio * 100" :aria-label="`${entry.name}支付比例`" class="field-input min-w-0" type="number" min="0" max="100" step="0.01" :disabled="disabled || read.draft.periodKind === 'retention' || entry.missing" @input="item(entry.itemId, input($event))" @change="emit('preview')"></label>
        <button v-if="entry.missing" type="button" class="cell--link justify-self-start" :disabled="disabled" @click="emit('change', { ...plan, itemRatios: plan.itemRatios.filter(row => row.itemId !== entry.itemId) }); emit('preview')">
          原分项已变化，移除此比例并重新核对
        </button>
      </div>
      <label v-for="entry in fees" :key="`${entry.kind}:${entry.id}`" class="grid min-w-0 gap-1 text-12px">{{ entry.name }}单独比例（%，留空使用默认比例）<input :value="(plan.feeRatios.find(row => row.kind === entry.kind && row.id === entry.id)?.ratio ?? null) === null ? '' : plan.feeRatios.find(row => row.kind === entry.kind && row.id === entry.id)!.ratio * 100" :aria-label="`${entry.name}单独比例`" class="field-input min-w-0" type="number" min="0" max="100" step="0.01" :disabled="disabled || read.draft.periodKind === 'retention'" @input="fee(entry.kind, entry.id, input($event))" @change="emit('preview')"></label>
    </div>
  </section>
</template>
