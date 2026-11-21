<script setup lang="ts">
import { computed } from 'vue'
import PayrollActualLedgerSection from '~/components/payroll/PayrollActualLedgerSection.vue'
import TargetCostSourceReturn from '~/components/target-cost/TargetCostSourceReturn.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'

const route = useRoute()
const router = useRouter()
const store = usePayrollStore()
const project = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const statementId = computed(() => typeof route.query.statementId === 'string' ? route.query.statementId : undefined)
const origin = computed(() => route.query.origin == null || route.query.origin === 'real' ? 'real' : route.query.origin === 'demo' ? 'demo' : null)
const { current, error } = usePayrollRead(() => String(origin.value), async () => {
  if (!origin.value)
    throw new Error('工资来源无效。')
  return store.loadRead({ origin: origin.value })
})
const back = computed(() => origin.value ? payrollAdjustmentReturn(route.query.returnTo, origin.value) || '/subcontract/payroll' : '/subcontract/payroll')
function changeProject(value: string) {
  void router.replace({ path: route.path, query: { ...route.query, project: value, statementId: undefined, budgetId: undefined, budgetProject: undefined, budgetReturnTo: undefined, projectId: undefined } })
}
const findProject = computed(() => {
  const projects = current.value?.projects || []
  return async (keyword: string) => projects.filter(row => `${row.name} ${row.code}`.includes(keyword.trim())).map(row => ({ id: row.id, label: row.name, hint: row.code }))
})
useTabTitle('工资实际收付')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap justify-between gap-3">
      <h1 class="text-20px font-800">
        工资实际收付
      </h1><NuxtLink :to="back" class="btn-secondary">
        返回来源
      </NuxtLink>
    </header><TargetCostSourceReturn /><section class="panel p-4">
      <label class="grid max-w-md gap-1 text-12px">项目<LookupSelect :model-value="project || null" :fetch="findProject" placeholder="查找工资项目" @update:model-value="changeProject($event || '')" /></label><p v-if="error" role="alert" class="mt-2 text-12px text-danger">
        {{ error }}
      </p>
    </section><PayrollActualLedgerSection v-if="project && origin" :project-id="project" :original-statement-id="statementId" :origin="origin" :return-to="route.fullPath" />
  </main>
</template>
