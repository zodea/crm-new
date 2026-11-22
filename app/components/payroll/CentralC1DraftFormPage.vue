<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollC1Form } from '~/composables/usePayrollC1Form'
import PayrollC1FormFields from './PayrollC1FormFields.vue'
import PayrollC1SourceReview from './PayrollC1SourceReview.vue'
import PayrollTierDraftFormPage from './PayrollTierDraftFormPage.vue'

const route = useRoute()
const ui = usePayrollC1Form()
const { id, matchingRead, draft, fieldErrors, editable } = ui
const title = computed(() => id.value ? '编辑 C1 工资草稿' : '新建 C1 工资草稿')
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { format: 'C1', origin: 'real', project: draft.value.projectId, month: draft.value.month, crew: draft.value.crewId || '', leader: draft.value.leaderWorkerId, returnTo: route.fullPath } }))
useTabTitle(title)
</script>

<template>
  <PayrollTierDraftFormPage tier="C1" :title="title" :ui="ui" :return-to="route.fullPath">
    <template #fields="{ change }">
      <PayrollC1FormFields v-if="matchingRead" :draft="draft" :options="matchingRead.options" :disabled="!editable" :field-errors="fieldErrors" @patch="change" />
    </template>
    <template #config>
      <NuxtLink v-if="draft.projectId && draft.month" :to="config" class="btn-secondary">
        个人工资标准
      </NuxtLink>
    </template>
    <template #source>
      <PayrollC1SourceReview v-if="matchingRead" :read="matchingRead" :return-to="route.fullPath" />
    </template>
  </PayrollTierDraftFormPage>
</template>
