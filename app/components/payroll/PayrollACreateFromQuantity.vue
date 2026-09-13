<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAEntryReturn } from '~/lib/payroll/a-navigation'
import { generateId } from '~/lib/util/id'

const props = defineProps<{ projectId: string, origin: DataOriginDTO, returnTo: string, month?: string }>()
const store = usePayrollStore()
const draftKey = generateId('payroll-a-draft')
const { current, error } = usePayrollRead(() => JSON.stringify([props.projectId, props.origin]), () => store.loadAForm({ origin: props.origin }, { statementId: null, draftKey, draft: { projectId: props.projectId } }))
const target = computed(() => {
  const back = payrollAEntryReturn(props.returnTo, props.origin, props.projectId)
  if (error.value || !back || props.origin !== 'real' || current.value?.context.origin !== props.origin || !current.value.context.capabilities.includes('payroll:write') || !current.value.options.projects.some(project => project.id === props.projectId))
    return null
  return { path: '/subcontract/payroll/new', query: { origin: props.origin, draftKey, project: props.projectId, ...(props.month && /^\d{4}-\d{2}$/.test(props.month) ? { month: props.month } : {}), returnTo: back } }
})
</script>

<template>
  <NuxtLink v-if="target" :to="target" class="btn-secondary self-start">
    按实际完成量新建 A 工资
  </NuxtLink>
</template>
