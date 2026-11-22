<script setup lang="ts">
import type { PayrollActualPaymentDraft, PayrollActualPaymentFormRead } from '~/lib/payroll/central-actual-contract'
import { computed } from 'vue'
import { c2InputNumber } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ read: PayrollActualPaymentFormRead, draft: PayrollActualPaymentDraft, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollActualPaymentDraft] }>()
const members = computed(() => [...new Map(props.read.originals.flatMap(original => original.members).map(member => [member.workerId, member])).values()])
const selected = computed(() => new Map(props.draft.allocations.map(item => [item.workerId, item])))
function patch(value: Partial<PayrollActualPaymentDraft>) {
  if (!props.disabled)
    emit('change', { ...props.draft, ...value })
}
function allocation(workerId: string, value: string) {
  const amount = c2InputNumber(value)
  const rows = props.draft.allocations.filter(item => item.workerId !== workerId)
  // 空白代表本次未选择，不补造成真实零分配。
  if (value.trim() !== '')
    rows.push({ workerId, amount })
  patch({ allocations: rows })
}
function application(adjustmentId: string, value: string) {
  patch({ applications: props.draft.applications.map(row => row.adjustmentId === adjustmentId ? { ...row, amount: c2InputNumber(value) } : row) })
}
</script>

<template>
  <section id="section-payment" class="panel grid min-w-0 gap-3 p-4">
    <SectionHeader title="本次真实收付" />
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-12px">收付方向<select :value="draft.kind" class="field-input" :disabled="disabled" @change="patch({ kind: ($event.target as HTMLSelectElement).value as 'refund' | 'supplement' })"><option value="refund">实际退款（负数）</option><option value="supplement">实际补发（正数）</option></select></label>
      <label class="grid gap-1 text-12px">真实发生日期<input :value="draft.occurredOn" type="date" class="field-input" :disabled="disabled" @input="patch({ occurredOn: ($event.target as HTMLInputElement).value })"></label>
      <label class="grid gap-1 text-12px">本次有符号实额<input :value="draft.amount ?? ''" type="number" step="0.01" class="field-input font-mono" :disabled="disabled" @input="patch({ amount: c2InputNumber(($event.target as HTMLInputElement).value) })"></label>
    </div>
    <label class="grid gap-1 text-12px">实际发生与核对依据<textarea :value="draft.evidenceNote" rows="3" class="field-input" :disabled="disabled" @input="patch({ evidenceNote: ($event.target as HTMLTextAreaElement).value })" /></label>
  </section>
  <section id="section-allocation" class="panel grid min-w-0 gap-3 p-4">
    <SectionHeader title="本次实际收付人" />
    <p class="text-12px text-ink-soft">
      按实际填写原成员。本次未参与留空；真实零填写 0。每项符号应与总额方向一致。
    </p>
    <div tabindex="0" aria-label="本次实际收付分配" class="min-w-0 overflow-x-auto">
      <table class="w-full min-w-440px text-left text-12px">
        <thead>
          <tr class="border-b border-line">
            <th class="p-2">
              原成员
            </th><th class="p-2">
              本次有符号收付金额
            </th>
          </tr>
        </thead><tbody>
          <tr v-for="member in members" :key="member.workerId" class="border-b border-line">
            <td class="p-2">
              {{ member.workerName || '姓名未记录' }}
            </td><td class="p-2">
              <input :value="selected.get(member.workerId)?.amount ?? ''" :aria-label="`${member.workerName || '原成员'}本次收付金额`" type="number" step="0.01" class="field-input w-40" :disabled="disabled" @input="allocation(member.workerId, ($event.target as HTMLInputElement).value)">
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <section id="section-application" class="panel grid min-w-0 gap-3 p-4">
    <SectionHeader title="本次处理的原更正" />
    <div tabindex="0" aria-label="本次更正处理分摊" class="min-w-0 overflow-x-auto">
      <table class="w-full min-w-600px text-left text-12px">
        <thead>
          <tr class="border-b border-line">
            <th class="p-2">
              原更正
            </th><th class="p-2">
              当前待处理差额
            </th><th class="p-2">
              本次有符号处理额
            </th>
          </tr>
        </thead><tbody>
          <tr v-for="balance in read.balances" :key="balance.adjustmentId" class="border-b border-line">
            <td class="max-w-56 break-all p-2">
              {{ balance.adjustmentId }}
            </td><td class="p-2 font-mono">
              {{ payrollAmount(balance.remainingDelta.value) }}
            </td><td class="p-2">
              <input :value="draft.applications.find(row => row.adjustmentId === balance.adjustmentId)?.amount ?? ''" :aria-label="`${balance.adjustmentId}本次处理额`" type="number" step="0.01" class="field-input w-40" :disabled="disabled" @input="application(balance.adjustmentId, ($event.target as HTMLInputElement).value)">
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
