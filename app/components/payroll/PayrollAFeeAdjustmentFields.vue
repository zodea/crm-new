<script setup lang="ts">
import type { PayrollAFeeAdjustmentBasis, PayrollAFeesSourceSnapshot } from '~/lib/payroll/central-a-fees-contract'
import { computed } from 'vue'
import { c2InputNumber } from '~/lib/payroll/c2-presentation'

const props = defineProps<{ basis: PayrollAFeeAdjustmentBasis, source: PayrollAFeesSourceSnapshot, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollAFeeAdjustmentBasis] }>()
const names = computed(() => new Map(props.source.lines.flatMap(line => line.components.map(component => [component.componentKey, [line.name, line.buildingName, line.itemName].filter(Boolean).join(' · ')]))))
function component(index: number, field: 'quantity' | 'unitPrice', event: Event) {
  if (props.disabled)
    return
  emit('change', { ...props.basis, components: props.basis.components.map((row, i) => i === index ? { ...row, [field]: c2InputNumber((event.target as HTMLInputElement).value) } : row) })
}
function negative(index: number, field: 'label' | 'quantity' | 'unitPrice' | 'reason' | 'evidenceNote', event: Event) {
  if (props.disabled)
    return
  const value = (event.target as HTMLInputElement).value
  emit('change', { ...props.basis, negativeLines: props.basis.negativeLines.map((row, i) => i === index ? { ...row, [field]: field === 'quantity' || field === 'unitPrice' ? c2InputNumber(value) : value } : row) })
}
</script>

<template>
  <div class="grid min-w-0 gap-4" aria-label="原费用与管理清单更正">
    <p class="text-12px leading-5 text-ink-soft">
      本次更正保留原请款簿、费项、施工责任和负价依据；本页输入形成独立更正，原签名金额保持冻结。
    </p>
    <div v-if="basis.components.length" tabindex="0" aria-label="原费用量价更正表" class="min-w-0 overflow-x-auto">
      <table class="w-full min-w-640px text-left text-12px">
        <thead>
          <tr class="border-b border-line">
            <th class="p-2">
              原费项与位置
            </th><th class="p-2">
              更正现场量
            </th><th class="p-2">
              更正单价
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in basis.components" :key="row.componentKey" class="border-b border-line">
            <td class="p-2">
              {{ names.get(row.componentKey) || '原费项名称未记录' }}
            </td><td class="p-2">
              <input :value="row.quantity ?? ''" :aria-label="`第${index + 1}项费用更正现场量`" type="number" min="0" step="any" class="field-input w-32" :disabled="disabled" @input="component(index, 'quantity', $event)">
            </td><td class="p-2">
              <input :value="row.unitPrice ?? ''" :aria-label="`第${index + 1}项费用更正单价`" type="number" min="0" step="0.01" class="field-input w-32" :disabled="disabled" @input="component(index, 'unitPrice', $event)">
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section v-for="(row, index) in basis.negativeLines" :key="row.lineId" class="grid min-w-0 gap-3 rounded border border-line p-3" :aria-label="`第${index + 1}条原管理负价更正`">
      <p class="text-12px text-ink-soft">
        原单位：{{ row.unit || '未记录' }} · 原施工责任 {{ row.scope.assignments.length }} 份 · {{ row.actualRef ? '保留原已关联收付依据' : '未关联实际收付' }}
      </p>
      <div class="grid min-w-0 gap-3 sm:grid-cols-3">
        <label class="grid min-w-0 gap-1 text-12px">清单名称<input :value="row.label" :aria-label="`第${index + 1}条负价更正名称`" class="field-input" :disabled="disabled" @input="negative(index, 'label', $event)"></label>
        <label class="grid min-w-0 gap-1 text-12px">更正数量<input :value="row.quantity ?? ''" :aria-label="`第${index + 1}条负价更正数量`" type="number" min="0" step="any" class="field-input" :disabled="disabled" @input="negative(index, 'quantity', $event)"></label>
        <label class="grid min-w-0 gap-1 text-12px">更正负单价<input :value="row.unitPrice ?? ''" :aria-label="`第${index + 1}条负价更正单价`" type="number" max="-0.01" step="0.01" class="field-input" :disabled="disabled" @input="negative(index, 'unitPrice', $event)"></label>
      </div>
      <label class="grid gap-1 text-12px">代付原因<textarea :value="row.reason" :aria-label="`第${index + 1}条负价更正原因`" class="field-input" rows="2" :disabled="disabled" @input="negative(index, 'reason', $event)" /></label>
      <label class="grid gap-1 text-12px">本次核对依据<textarea :value="row.evidenceNote" :aria-label="`第${index + 1}条负价更正依据`" class="field-input" rows="2" :disabled="disabled" @input="negative(index, 'evidenceNote', $event)" /></label>
    </section>
  </div>
</template>
