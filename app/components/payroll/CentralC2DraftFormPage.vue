<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollC2Form } from '~/composables/usePayrollC2Form'
import PayrollC2FormFields from './PayrollC2FormFields.vue'
import PayrollC2SourceReview from './PayrollC2SourceReview.vue'
import PayrollTierDraftFormPage from './PayrollTierDraftFormPage.vue'

const route = useRoute()
const ui = usePayrollC2Form()
const { id, matchingRead, draft, fieldErrors, editable } = ui
const title = computed(() => id.value ? '编辑 C2 工资草稿' : '新建 C2 工资草稿')
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { format: 'C2', origin: 'real', project: draft.value.projectId, leader: draft.value.leaderWorkerId, month: draft.value.month, crew: draft.value.crewId || '', returnTo: route.fullPath } }))
useTabTitle(title)
</script>

<template>
  <PayrollTierDraftFormPage tier="C2" :title="title" :ui="ui" :return-to="route.fullPath">
    <template #fields="{ change }">
      <PayrollC2FormFields v-if="matchingRead" :draft="draft" :options="matchingRead.options" :disabled="!editable" :field-errors="fieldErrors" @patch="change" />
    </template>
    <template #config>
      <NuxtLink v-if="draft.projectId && draft.leaderWorkerId" :to="config" class="btn-secondary">
        C2 主体配置
      </NuxtLink>
    </template>
    <template #source>
      <PayrollC2SourceReview v-if="matchingRead" :read="matchingRead" :return-to="route.fullPath" />
    </template>
  </PayrollTierDraftFormPage>
</template>
