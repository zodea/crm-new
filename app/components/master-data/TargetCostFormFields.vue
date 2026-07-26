<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { TargetCostFormDraft } from '~/lib/master-data/forms'

const props = defineProps<{
  fieldErrors: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  clearError: [field: keyof TargetCostFormDraft]
}>()

const draft = defineModel<TargetCostFormDraft>({ required: true })

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
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">项目 *</span>
        <LookupSelect
          v-model="draft.projectId"
          :fetch="fetchProjects"
          recent-key="target-cost-projects"
          placeholder="检索项目"
          @update:model-value="emit('clearError', 'projectId')"
        />
        <span v-if="fieldErrors.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
      </label>
      <label class="field-block form-span-full">
        <span class="flex items-center gap-2">
          <input v-model="draft.isBaseline" type="checkbox" class="accent-brand">
          <span class="field-label mb-0">设为当前对比基线</span>
        </span>
      </label>
    </div>
  </section>

  <section id="section-amount" class="panel scroll-mt-4 p-4">
    <SectionHeader title="金额基准" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">合同收入</span>
        <input v-model.number="draft.contractRevenue" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">计划利润</span>
        <input v-model.number="draft.plannedProfit" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">已签合同额</span>
        <input v-model.number="draft.signedContractSum" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">含税合价</span>
        <input v-model.number="draft.taxInclusiveTotal" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">无税合价</span>
        <input v-model.number="draft.taxExclusiveTotal" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">税额</span>
        <input v-model.number="draft.taxAmount" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
    </div>
    <p class="mt-3 text-11px text-ink-faint">
      含税、无税和税额只作勾稽提示，不自动覆盖人工确认值。
    </p>
  </section>
</template>
