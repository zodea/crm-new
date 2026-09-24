<script setup lang="ts">
import type { PayrollAFeeConfigRead, PayrollANegativeLineDraft } from '~/lib/payroll/central-a-fees-contract'
import type { PayrollActualFact } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'
import PayrollActualReferencePicker from './PayrollActualReferencePicker.vue'
import PayrollAManagementScopeEditor from './PayrollAManagementScopeEditor.vue'

const props = defineProps<{ draft: PayrollANegativeLineDraft, options: PayrollAFeeConfigRead['responsibilityOptions'], cellOptions?: PayrollAFeeConfigRead['cellOptions'], returnTo?: string, actualFacts?: PayrollActualFact[], actualStatements?: PayrollStatementRow[], referenceReady?: boolean, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollANegativeLineDraft], remove: [] }>()
const change = (patch: Partial<PayrollANegativeLineDraft>) => emit('change', { ...props.draft, ...patch })
</script>

<template>
  <article class="grid grid-cols-1 min-w-0 gap-3 rounded border border-line p-3" aria-label="负价代付清单行">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-13px font-700">
        负价代付依据
      </p><KitButton type="button" variant="ghost" :disabled="disabled" @click="emit('remove')">
        {{ draft.lineId ? '移除此行（追加修订）' : '移除未保存行' }}
      </KitButton>
    </div>
    <div class="grid grid-cols-1 min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">清单名称<input class="field-input min-w-0 w-full" :value="draft.label" aria-label="代付清单名称" :disabled="disabled" @input="change({ label: ($event.target as HTMLInputElement).value })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">数量<input type="number" min="0" step="any" class="field-input min-w-0 w-full" :value="draft.quantity ?? ''" aria-label="代付数量" :disabled="disabled" @input="change({ quantity: payrollInputNumber(($event.target as HTMLInputElement).value) })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">单位<input class="field-input min-w-0 w-full" :value="draft.unit ?? ''" aria-label="代付单位" :disabled="disabled" @input="change({ unit: ($event.target as HTMLInputElement).value || null })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">负单价<input type="number" max="0" step="any" class="field-input min-w-0 w-full" :value="draft.unitPrice ?? ''" aria-label="代付负单价" :disabled="disabled" @input="change({ unitPrice: payrollInputNumber(($event.target as HTMLInputElement).value) })"></label>
    </div>
    <PayrollAManagementScopeEditor :scope="draft.scope" :options="options" :cell-options="cellOptions" :return-to="returnTo" :disabled="disabled" @change="change({ scope: $event })" />
    <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">具体事由<textarea class="field-input min-w-0 w-full" :value="draft.reason" aria-label="代付事由" rows="3" :disabled="disabled" @input="change({ reason: ($event.target as HTMLTextAreaElement).value })" /></label>
    <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">经办确认依据<textarea class="field-input min-w-0 w-full" :value="draft.evidenceNote" aria-label="代付确认依据" rows="3" :disabled="disabled" @input="change({ evidenceNote: ($event.target as HTMLTextAreaElement).value })" /></label>
    <PayrollActualReferencePicker :value="draft.actualRef" :facts="actualFacts ?? []" :statements="actualStatements ?? []" :ready="!!referenceReady" :disabled="disabled" @change="change({ actualRef: $event })" />
    <p class="text-12px leading-5 text-ink-faint">
      {{ draft.actualRef ? '已保留原实际事实引用，保存时重新核验。' : '未关联实际收付' }}。本清单减少管理费核算组成，不代表发生退款或向其他人支付。
    </p>
  </article>
</template>
