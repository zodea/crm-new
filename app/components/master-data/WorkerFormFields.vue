<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { WorkerFormDraft } from '~/lib/master-data/forms'

const props = defineProps<{
  fieldErrors: Record<string, string>
  fetchCrews: (keyword: string) => Promise<LookupOption[]>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  clearError: [field: keyof WorkerFormDraft]
}>()

const draft = defineModel<WorkerFormDraft>({ required: true })

function fieldClass(field: keyof WorkerFormDraft) {
  return props.fieldErrors[field]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}
</script>

<template>
  <section id="section-personal" class="panel scroll-mt-4 p-4">
    <SectionHeader title="个人信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">姓名 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">性别</span>
        <select v-model="draft.gender" class="field-input w-full">
          <option value="">未填写</option>
          <option value="男">男</option>
          <option value="女">女</option>
        </select>
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">身份证号</span>
        <input v-model="draft.idCard" class="field-input w-full font-mono">
      </label>
      <label class="field-block">
        <span class="field-label">联系电话 *</span>
        <input v-model="draft.phone" :class="fieldClass('phone')" data-field="phone" @input="emit('clearError', 'phone')">
        <span v-if="fieldErrors.phone" class="field-error">{{ fieldErrors.phone }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">籍贯</span>
        <input v-model="draft.hometown" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">紧急联系人</span>
        <input v-model="draft.emergencyContact" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">紧急联系电话</span>
        <input v-model="draft.emergencyPhone" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-bank" class="panel scroll-mt-4 p-4">
    <SectionHeader title="银行信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">开户银行 *</span>
        <input v-model="draft.bankName" :class="fieldClass('bankName')" data-field="bankName" @input="emit('clearError', 'bankName')">
        <span v-if="fieldErrors.bankName" class="field-error">{{ fieldErrors.bankName }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">银行卡号 *</span>
        <input v-model="draft.bankAccount" :class="fieldClass('bankAccount')" data-field="bankAccount" @input="emit('clearError', 'bankAccount')">
        <span v-if="fieldErrors.bankAccount" class="field-error">{{ fieldErrors.bankAccount }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">银行行号</span>
        <input v-model="draft.bankCode" class="field-input w-full font-mono">
      </label>
    </div>
  </section>

  <section id="section-work" class="panel scroll-mt-4 p-4">
    <SectionHeader title="工作信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">工种 *</span>
        <input v-model="draft.trade" :class="fieldClass('trade')" data-field="trade" @input="emit('clearError', 'trade')">
        <span v-if="fieldErrors.trade" class="field-error">{{ fieldErrors.trade }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">技能等级</span>
        <input v-model="draft.skillLevel" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">参考日工资</span>
        <input v-model.number="draft.dailyWage" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">所属班组</span>
        <LookupSelect v-model="draft.crewId" :fetch="fetchCrews" recent-key="worker-crews" placeholder="检索班组" />
      </label>
      <label class="field-block">
        <span class="field-label">亲属组 ID</span>
        <input v-model="draft.familyGroupId" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-project" class="panel scroll-mt-4 p-4">
    <SectionHeader title="项目分配" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">当前项目</span>
        <LookupSelect v-model="draft.currentProjectId" :fetch="fetchProjects" recent-key="worker-projects" placeholder="检索项目" />
      </label>
      <label class="field-block">
        <span class="field-label">在场状态</span>
        <select v-model="draft.projectStatus" class="field-input w-full">
          <option value="在场">在场</option>
          <option value="已退场">已退场</option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">进场日期</span>
        <input v-model="draft.entryDate" type="date" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">退场日期</span>
        <input v-model="draft.exitDate" type="date" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="flex items-center gap-2">
          <input v-model="draft.safetyEducation" type="checkbox" class="accent-brand">
          <span class="field-label mb-0">已完成三级安全教育</span>
        </span>
      </label>
    </div>
  </section>
</template>
