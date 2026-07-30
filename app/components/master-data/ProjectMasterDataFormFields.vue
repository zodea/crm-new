<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { ProjectFormDraft } from '~/lib/master-data/forms'
import { PROJECT_STATUSES } from '~/lib/project/status'

const props = defineProps<{
  fieldErrors: Record<string, string>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  clearError: [field: keyof ProjectFormDraft]
}>()

const draft = defineModel<ProjectFormDraft>({ required: true })

function fieldClass(field: keyof ProjectFormDraft) {
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
        <span class="field-label">项目名称 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">项目合同名称</span>
        <input v-model="draft.contractName" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">项目编号</span>
        <input v-model="draft.code" class="field-input w-full font-mono">
      </label>
      <label class="field-block">
        <span class="field-label">客户（甲方） *</span>
        <LookupSelect
          v-model="draft.customerId"
          :fetch="fetchCustomers"
          field="customerId"
          :invalid="!!fieldErrors.customerId"
          :description-id="fieldErrors.customerId ? 'project-customer-error' : undefined"
          recent-key="project-customers"
          placeholder="检索客户"
          @update:model-value="emit('clearError', 'customerId')"
        />
        <span v-if="fieldErrors.customerId" id="project-customer-error" class="field-error">{{ fieldErrors.customerId }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">客户2</span>
        <LookupSelect
          v-model="draft.secondaryCustomerId"
          :fetch="fetchCustomers"
          field="secondaryCustomerId"
          recent-key="project-secondary-customers"
          placeholder="检索次客户"
        />
      </label>
      <label class="field-block">
        <span class="field-label">工程地域</span>
        <input v-model="draft.region" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">详细地址</span>
        <input v-model="draft.address" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">经营类型</span>
        <select v-model="draft.operationType" class="field-input w-full">
          <option value="自营">自营</option>
          <option value="联营">联营</option>
          <option value="挂靠">挂靠</option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">工程类型</span>
        <input v-model="draft.type" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">建筑面积</span>
        <input v-model.number="draft.area" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">合同金额</span>
        <input v-model.number="draft.contractAmount" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">工程概况</span>
        <textarea v-model="draft.overview" rows="3" class="field-input w-full" />
      </label>
    </div>
  </section>

  <section id="section-schedule" class="panel scroll-mt-4 p-4">
    <SectionHeader title="工期与阶段" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">业务流程阶段</span>
        <select v-model="draft.status" class="field-input w-full">
          <option v-for="status in PROJECT_STATUSES" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">计划开工</span>
        <input v-model="draft.startDate" type="date" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">计划竣工</span>
        <input v-model="draft.plannedEnd" type="date" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">计划工期（天）</span>
        <input v-model.number="draft.plannedDuration" type="number" min="0" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">实际竣工</span>
        <input v-model="draft.actualEnd" type="date" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-team" class="panel scroll-mt-4 p-4">
    <SectionHeader title="参建单位" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">项目经理 *</span>
        <input v-model="draft.manager" :class="fieldClass('manager')" data-field="manager" @input="emit('clearError', 'manager')">
        <span v-if="fieldErrors.manager" class="field-error">{{ fieldErrors.manager }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">项目经理电话</span>
        <input v-model="draft.managerPhone" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">执行经理</span>
        <input v-model="draft.execManager" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">施工员</span>
        <input v-model="draft.builder" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">承包单位</span>
        <input v-model="draft.contractor" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">监理单位</span>
        <input v-model="draft.supervisor" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">设计单位</span>
        <input v-model="draft.designer" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">甲方代表</span>
        <input v-model="draft.developerSupervisor" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">现场负责人</span>
        <input v-model="draft.siteLeader" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">现场负责人电话</span>
        <input v-model="draft.siteLeaderPhone" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-risk" class="panel scroll-mt-4 p-4">
    <SectionHeader title="风控与立项" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">项目风险级别</span>
        <select v-model="draft.riskLevel" class="field-input w-full">
          <option value="低">低</option>
          <option value="中">中</option>
          <option value="高">高</option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">立项文件时间</span>
        <input v-model="draft.filingDate" type="date" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">验收日期</span>
        <input v-model="draft.acceptanceDate" type="date" class="field-input w-full">
      </label>
    </div>
  </section>
</template>
