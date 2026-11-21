<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollC1Statement } from '~/composables/usePayrollC1Statement'
import { createPayrollC1Workbook } from '~/lib/payroll/c1-export'
import PayrollC1FrozenPrint from '../../../../components/payroll/PayrollC1FrozenPrint.vue'
import PayrollC1SourceReview from '../../../../components/payroll/PayrollC1SourceReview.vue'
import PayrollTierStatementWorkspace from '../../../../components/payroll/PayrollTierStatementWorkspace.vue'

const props = defineProps<{
  statementId: string
  origin: 'real' | 'demo'
  returnTo: string
}>()
const emit = defineEmits<{ changed: [] }>()
const ui = usePayrollC1Statement({ id: () => props.statementId, origin: () => props.origin, changed: () => emit('changed') })
const { matching, output } = ui
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: props.origin, format: 'C1', project: matching.value?.draft.projectId || '', month: matching.value?.draft.month || '', crew: matching.value?.draft.crewId || '', leader: matching.value?.draft.leaderWorkerId || '', returnTo: props.returnTo } }))

function createWorkbook() {
  const value = output.value
  return value?.state === 'available' ? createPayrollC1Workbook(value.document) : null
}
</script>

<template>
  <section class="grid min-w-0 gap-4" aria-label="C1工资核对与发放">
    <PayrollTierStatementWorkspace v-bind="props" tier="C1" :ui="ui" :config="config" :create-workbook="createWorkbook">
      <template #source>
        <PayrollC1SourceReview v-if="matching" :read="matching" :return-to="returnTo" />
      </template>
      <template #print>
        <PayrollC1FrozenPrint v-if="output?.state === 'available'" :document="output.document" />
      </template>
    </PayrollTierStatementWorkspace>
  </section>
</template>
