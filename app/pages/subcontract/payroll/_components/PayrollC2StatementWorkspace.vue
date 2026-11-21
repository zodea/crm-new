<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollC2Statement } from '~/composables/usePayrollC2Statement'
import { createPayrollC2Workbook } from '~/lib/payroll/c2-export'
import PayrollC2FrozenPrint from '../../../../components/payroll/PayrollC2FrozenPrint.vue'
import PayrollC2SourceReview from '../../../../components/payroll/PayrollC2SourceReview.vue'
import PayrollTierStatementWorkspace from '../../../../components/payroll/PayrollTierStatementWorkspace.vue'

const props = defineProps<{
  statementId: string
  origin: 'real' | 'demo'
  returnTo: string
}>()
const emit = defineEmits<{ changed: [] }>()
const ui = usePayrollC2Statement({ id: () => props.statementId, origin: () => props.origin, changed: () => emit('changed') })
const { matching, output } = ui
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: props.origin, format: 'C2', project: matching.value?.draft.projectId || '', leader: matching.value?.draft.leaderWorkerId || '', month: matching.value?.draft.month || '', crew: matching.value?.draft.crewId || '', returnTo: props.returnTo } }))

function createWorkbook() {
  const value = output.value
  return value?.state === 'available' ? createPayrollC2Workbook(value.document) : null
}
</script>

<template>
  <section class="grid min-w-0 gap-4" aria-label="C2工资核对与发放">
    <PayrollTierStatementWorkspace v-bind="props" tier="C2" :ui="ui" :config="config" :create-workbook="createWorkbook">
      <template #source>
        <PayrollC2SourceReview v-if="matching" :read="matching" :return-to="returnTo" />
      </template>
      <template #print>
        <PayrollC2FrozenPrint v-if="output?.state === 'available'" :document="output.document" />
      </template>
    </PayrollTierStatementWorkspace>
  </section>
</template>
