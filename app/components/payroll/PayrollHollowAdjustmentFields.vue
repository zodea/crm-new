<script setup lang="ts">
import type { PayrollHollowAdjustmentBasis } from '~/lib/payroll/central-hollow-deduction-contract'
import { computed } from 'vue'
import { c2InputNumber } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ basis: PayrollHollowAdjustmentBasis, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollHollowAdjustmentBasis] }>()
const originals = computed(() => new Map(props.basis.source.adoptions.map(adoption => [adoption.id, adoption.line])))
function update(index: number, field: 'count' | 'unitAmount', event: Event) {
  if (props.disabled)
    return
  emit('change', { ...props.basis, components: props.basis.components.map((row, i) => i === index ? { ...row, [field]: c2InputNumber((event.target as HTMLInputElement).value) } : row) })
}
</script>

<template>
  <section class="grid min-w-0 gap-3" aria-label="原空鼓采用更正">
    <h3 class="text-14px font-semibold">
      原空鼓采用依据
    </h3>
    <p class="text-12px leading-5 text-ink-soft">
      本次处数和单处金额形成独立核算更正。原检查、整改、采用位置和签名原件保持原记录；实际补退另行确认。
    </p>
    <p v-if="!basis.components.length" class="text-12px text-ink-soft">
      原单没有采用空鼓扣款。
    </p>
    <section v-for="(row, index) in basis.components" :key="row.adoptionId" class="grid min-w-0 gap-3 rounded border border-line p-3" :aria-label="`第${index + 1}条原空鼓采用`">
      <template v-if="originals.get(row.adoptionId)">
        <p class="min-w-0 break-words text-12px font-medium">
          {{ originals.get(row.adoptionId)!.fact.location.locationLabel }} · {{ originals.get(row.adoptionId)!.fact.originalPartyName }}
        </p>
        <p class="text-12px leading-5 text-ink-soft">
          原采用 {{ originals.get(row.adoptionId)!.count }} 处 · 原单处金额 {{ payrollAmount(originals.get(row.adoptionId)!.unitAmount) }} · 原扣款 {{ payrollAmount(originals.get(row.adoptionId)!.amount) }}
        </p>
        <div class="grid min-w-0 gap-3 sm:grid-cols-2">
          <label class="grid min-w-0 gap-1 text-12px">本次更正处数<input :value="row.count ?? ''" :aria-label="`第${index + 1}条空鼓更正处数`" type="number" min="0" step="1" class="field-input w-full min-w-0" :disabled="disabled" @input="update(index, 'count', $event)"></label>
          <label class="grid min-w-0 gap-1 text-12px">本次更正单处金额（元 / 处）<input :value="row.unitAmount ?? ''" :aria-label="`第${index + 1}条空鼓更正单处金额`" type="number" min="0" step="0.01" class="field-input w-full min-w-0" :disabled="disabled" @input="update(index, 'unitAmount', $event)"></label>
        </div>
      </template>
      <p v-else class="text-12px text-warn">
        原采用记录不完整，请重新读取原工资依据。
      </p>
    </section>
  </section>
</template>
