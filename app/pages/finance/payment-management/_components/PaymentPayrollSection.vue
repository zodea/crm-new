<script setup lang="ts">
import { computed } from 'vue'
import PayrollActualLedgerSection from '~/components/payroll/PayrollActualLedgerSection.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const route = useRoute()
const router = useRouter()
const payrollProject = computed({
  get: () => isStableRouteIdentity(route.query.payrollProject) ? route.query.payrollProject : null,
  set: (value: string | null) => {
    if (value !== null && !isStableRouteIdentity(value))
      return
    void router.replace({ path: route.path, query: { ...route.query, payrollProject: value || undefined } })
  },
})
const payrollStore = usePayrollStore()
const { current, error } = usePayrollRead(() => 'payment-management-payroll-projects', () => payrollStore.loadRead({ origin: 'real' }))
const findProject = computed(() => {
  const projects = current.value?.projects || []
  return async (keyword: string) => projects.filter(row => `${row.name} ${row.code}`.includes(keyword.trim())).map(row => ({ id: row.id, label: row.name, hint: row.code }))
})
</script>

<template>
  <section class="panel grid gap-3 p-4" aria-label="工资收付独立来源">
    <SectionHeader title="工资收付" />
    <p class="text-12px text-ink-soft">
      单独读取工资已发与实际补退；金额不计入上方付款申请、待支付或银行流水。
    </p>
    <label class="grid max-w-md gap-1 text-12px">工资项目<LookupSelect v-model="payrollProject" :fetch="findProject" placeholder="查找工资项目" /></label>
    <p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p>
    <NuxtLink :to="{ path: '/subcontract/payroll/payments', query: { origin: 'real', project: payrollProject, returnTo: route.fullPath } }" class="btn-secondary w-fit">
      打开工资实际收付
    </NuxtLink>
    <PayrollActualLedgerSection v-if="payrollProject" :project-id="payrollProject" origin="real" :return-to="route.fullPath" />
  </section>
</template>
