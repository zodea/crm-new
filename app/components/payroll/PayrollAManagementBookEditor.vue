<script setup lang="ts">
import type { PayrollAFeeConfigRead, PayrollAManagementBookDraft } from '~/lib/payroll/central-a-fees-contract'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'
import PayrollAManagementScopeEditor from './PayrollAManagementScopeEditor.vue'

const props = defineProps<{ draft: PayrollAManagementBookDraft, read: PayrollAFeeConfigRead, returnTo?: string, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollAManagementBookDraft] }>()
const change = (patch: Partial<PayrollAManagementBookDraft>) => emit('change', { ...props.draft, ...patch })
</script>

<template>
  <section class="grid grid-cols-1 min-w-0 gap-3 rounded border border-line p-3" aria-label="管理关系编辑">
    <div class="grid grid-cols-1 min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">管理方式<select class="field-input min-w-0 w-full" :value="draft.managementMode" aria-label="管理方式" :disabled="disabled" @change="change({ managementMode: ($event.target as HTMLSelectElement).value === 'company-managed' ? 'company-managed' : 'crew-managed' })"><option value="crew-managed">班组管理 · 独立管理费簿</option><option value="company-managed">公司代管 · 本范围不生成管理费单</option></select></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">管理人<select class="field-input min-w-0 w-full" :value="draft.managerWorkerId || ''" aria-label="管理人" :disabled="disabled || !!draft.managementBookId" @change="change({ managerWorkerId: ($event.target as HTMLSelectElement).value || null })"><option value="">{{ draft.managementMode === 'company-managed' ? '未指定管理人' : '请选择真实管理人' }}</option><option v-for="worker in read.options.workers" :key="worker.id" :value="worker.id" :disabled="!worker.eligible">{{ worker.name || '姓名未记录' }}{{ worker.crewId ? ` · ${read.options.crews.find(crew => crew.id === worker.crewId)?.name || '班组名称未记录'}` : ' · 未关联班组' }}</option></select></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">生效月份<input type="month" class="field-input min-w-0 w-full" :value="draft.effectiveMonth" aria-label="管理关系生效月份" :disabled="disabled" @input="change({ effectiveMonth: ($event.target as HTMLInputElement).value })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">本管理簿首月比例（%）<input type="number" min="0" max="100" step="any" class="field-input min-w-0 w-full" :value="draft.initialPayRatio === null ? '' : draft.initialPayRatio * 100" aria-label="管理簿首月比例" :disabled="disabled" @input="change({ initialPayRatio: payrollInputNumber(($event.target as HTMLInputElement).value) === null ? null : Number(($event.target as HTMLInputElement).value) / 100 })"></label>
    </div>
    <p v-if="draft.managementBookId" class="text-12px text-ink-faint">
      原管理人保持不变；换管理人须另建管理簿，原已领不转移。
    </p>
    <PayrollAManagementScopeEditor :scope="draft.scope" :options="read.responsibilityOptions" :cell-options="read.cellOptions" :return-to="returnTo" :disabled="disabled" @change="change({ scope: $event })" />
    <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">管理关系确认依据<textarea class="field-input min-w-0 w-full" :value="draft.evidenceNote" aria-label="管理关系确认依据" rows="3" :disabled="disabled" @input="change({ evidenceNote: ($event.target as HTMLTextAreaElement).value })" /></label>
  </section>
</template>
