<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { TargetCostFormDraft } from '~/lib/master-data/forms'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'
import { round2 } from '~/lib/util/number'

const props = defineProps<{
  fieldErrors: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  disabled?: boolean
  projectLabel?: string
  lookupKey?: string
}>()

const emit = defineEmits<{
  clearError: [field: keyof TargetCostFormDraft]
}>()

const draft = defineModel<TargetCostFormDraft>({ required: true })
const taxDifference = computed(() => {
  const { taxInclusiveTotal, taxExclusiveTotal, taxAmount } = draft.value
  return taxInclusiveTotal == null || taxExclusiveTotal == null || taxAmount == null ? null : round2(Number(taxInclusiveTotal) - Number(taxExclusiveTotal) - Number(taxAmount))
})
const amounts = [
  ['contractRevenue', '合同收入'],
  ['plannedProfit', '计划利润'],
  ['signedContractSum', '已签合同额（录入值）'],
  ['taxInclusiveTotal', '含税合价'],
  ['taxExclusiveTotal', '无税合价'],
  ['taxAmount', '税额'],
] as const

function updateAmount(field: typeof amounts[number][0], event: Event) {
  const input = event.target as HTMLInputElement
  draft.value = { ...draft.value, [field]: input.value === '' ? null : input.valueAsNumber }
  emit('clearError', field)
}

function fieldClass(field: keyof TargetCostFormDraft) {
  return props.fieldErrors[field]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}
</script>

<template>
  <section id="section-basic" class="panel scroll-mt-4 p-4">
    <SectionHeader title="基本信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">版本名 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" :disabled="disabled" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">项目 *</span>
        <span v-if="disabled" class="field-input w-full" aria-label="已选预算项目">{{ projectLabel || draft.projectId || '未关联项目' }}</span>
        <LookupSelect
          v-else
          v-model="draft.projectId"
          :fetch="fetchProjects"
          field="projectId"
          :invalid="!!fieldErrors.projectId"
          :description-id="fieldErrors.projectId ? 'target-cost-project-error' : undefined"
          :recent-key="lookupKey || 'target-cost-projects'"
          placeholder="检索项目"
          @update:model-value="emit('clearError', 'projectId')"
        />
        <span v-if="fieldErrors.projectId" id="target-cost-project-error" class="field-error">{{ fieldErrors.projectId }}</span>
      </label>
      <label class="field-block form-span-full">
        <span class="flex items-center gap-2">
          <input v-model="draft.isBaseline" type="checkbox" class="accent-brand" :disabled="disabled">
          <span class="field-label mb-0">设为当前对比基线</span>
        </span>
      </label>
    </div>
  </section>

  <section id="section-amount" class="panel scroll-mt-4 p-4">
    <SectionHeader title="金额基准" />
    <div class="form-fields-grid mt-3">
      <label v-for="[field, label] in amounts" :key="field" class="field-block">
        <span class="field-label">{{ label }}</span>
        <input :value="draft[field] ?? ''" type="number" min="0" step="0.01" :class="fieldClass(field)" :data-field="field" :disabled="disabled" @input="updateAmount(field, $event)">
        <span v-if="fieldErrors[field]" class="field-error">{{ fieldErrors[field] }}</span>
      </label>
    </div>
    <p class="mt-3 text-11px text-ink-faint">
      含税、无税和税额只作勾稽提示，不自动覆盖人工确认值。
    </p>
    <p v-if="taxDifference != null && taxDifference !== 0" class="mt-2 text-12px text-warn-ink" aria-label="预算税价勾稽提示">
      含税合价与“无税合价＋税额”相差 {{ yuan(taxDifference) }}，请核对；当前人工金额保持不变。
    </p>
  </section>
</template>
