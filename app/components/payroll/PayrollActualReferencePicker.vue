<script setup lang="ts">
import type { PayrollActualFact, PayrollActualRef } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import { computed } from 'vue'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ value: PayrollActualRef | null, facts: PayrollActualFact[], statements: PayrollStatementRow[], ready: boolean, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollActualRef | null] }>()
const labels = { 'initial-release': '原工资发放', 'supplement': '实际补发', 'refund': '实际退款', 'recording-reversal': '错记冲销' }
const selected = computed(() => props.value ? props.facts.find(fact => payrollACanonical(fact.ref) === payrollACanonical(props.value))?.identity ?? 'unread-original' : '')
function label(fact: PayrollActualFact) {
  const originals = fact.originalStatementIds.map(id => props.statements.find(row => row.id === id)).map(row => row ? `${row.month} ${row.leaderName || '原姓名未记录'} ${row.book?.bookPurpose === 'management' ? '管理费簿' : row.book ? '普通施工簿' : row.formatFamily}` : '原工资资料未读取')
  return `${fact.occurredOn || '日期未记录'} · ${labels[fact.kind]} · ${payrollAmount(fact.signedAmount.value)} · ${originals.join('、')}`
}
function change(event: Event) {
  if (props.disabled || !props.ready)
    return
  const identity = (event.target as HTMLSelectElement).value
  const fact = props.facts.find(row => row.identity === identity)
  if (!identity || fact)
    emit('change', fact?.ref ?? null)
}
</script>

<template>
  <div class="grid grid-cols-1 min-w-0 gap-1 text-12px">
    <label class="grid grid-cols-1 min-w-0 gap-1">可选：关联已有实际收付<select :value="selected" aria-label="关联已有实际收付" class="field-input min-w-0 w-full" :disabled="disabled || !ready" @change="change"><option value="">未关联实际收付</option><option v-if="selected === 'unread-original'" value="unread-original">已保留原事实引用，待重新核对</option><option v-for="fact in facts" :key="fact.identity" :value="fact.identity">{{ label(fact) }}</option></select></label>
    <p class="leading-5 text-ink-faint">
      仅保存原事实引用，不创建收付款，也不把负价金额当成退款。
    </p>
  </div>
</template>
