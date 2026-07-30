<script setup lang="ts">
import type { CrewFormDraft } from '~/lib/master-data/forms'

const props = defineProps<{
  fieldErrors: Record<string, string>
}>()

const emit = defineEmits<{
  clearError: [field: keyof CrewFormDraft]
}>()

const draft = defineModel<CrewFormDraft>({ required: true })

function fieldClass(field: keyof CrewFormDraft) {
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
        <span class="field-label">班组名称 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" autocomplete="organization" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">工种 *</span>
        <input v-model="draft.trade" :class="fieldClass('trade')" data-field="trade" @input="emit('clearError', 'trade')">
        <span v-if="fieldErrors.trade" class="field-error">{{ fieldErrors.trade }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">负责人 *</span>
        <input v-model="draft.contactName" :class="fieldClass('contactName')" data-field="contactName" autocomplete="name" @input="emit('clearError', 'contactName')">
        <span v-if="fieldErrors.contactName" class="field-error">{{ fieldErrors.contactName }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">联系电话 *</span>
        <input v-model="draft.contactPhone" :class="fieldClass('contactPhone')" data-field="contactPhone" type="tel" inputmode="tel" autocomplete="tel" @input="emit('clearError', 'contactPhone')">
        <span v-if="fieldErrors.contactPhone" class="field-error">{{ fieldErrors.contactPhone }}</span>
      </label>
      <MasterDataCapabilityFields
        v-model:trades="draft.capabilityTrades"
        v-model:items="draft.capabilityItems"
        :primary-trade="draft.trade"
      />
    </div>
  </section>

  <section id="section-pay" class="panel scroll-mt-4 p-4">
    <SectionHeader
      title="计薪与提成"
      subtitle="以下为班组档案默认值，不按项目复制配置"
    />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">默认发放比例</span>
        <input v-model.number="draft.defaultPayRatio" data-field="defaultPayRatio" type="number" inputmode="decimal" min="0" max="1" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">指派粒度</span>
        <select v-model="draft.assignmentLevel" data-field="assignmentLevel" class="field-input w-full">
          <option value="crew">班组</option>
          <option value="worker">个人</option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">房租补贴</span>
        <span class="flex items-center gap-2">
          <input v-model="draft.rentSubsidyEnabled" type="checkbox" class="accent-brand">
          <span class="text-12px text-ink-soft">启用</span>
        </span>
      </label>
      <label class="field-block">
        <span class="field-label">房租补贴单价</span>
        <input v-model.number="draft.rentSubsidyPrice" data-field="rentSubsidyPrice" type="number" inputmode="decimal" min="0" step="0.01" :disabled="!draft.rentSubsidyEnabled" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">管理提成</span>
        <span class="flex items-center gap-2">
          <input v-model="draft.mgmtFeeEnabled" type="checkbox" class="accent-brand">
          <span class="text-12px text-ink-soft">启用</span>
        </span>
      </label>
      <label class="field-block">
        <span class="field-label">管理提成单价</span>
        <input v-model.number="draft.mgmtFeePrice" data-field="mgmtFeePrice" type="number" inputmode="decimal" min="0" step="0.01" :disabled="!draft.mgmtFeeEnabled" class="field-input w-full">
      </label>
    </div>
  </section>
</template>
