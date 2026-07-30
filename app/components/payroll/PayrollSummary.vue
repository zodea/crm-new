<script setup lang="ts">
import type { WageStatement } from '~/lib/payroll/statements'
import { computed } from 'vue'

const props = defineProps<{ statements: readonly WageStatement[] }>()

const summary = computed(() => ({
  total: props.statements.length,
  drafts: props.statements.filter(item => item.status === 'draft').length,
  checked: props.statements.filter(item => item.status === 'checked').length,
  released: props.statements.filter(item => item.status === 'released').length,
  paid: props.statements.reduce((sum, item) => sum + (item.actualAmount ?? 0), 0),
}))
</script>

<template>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="工资汇总">
    <StatCard label="月度单据" :value="summary.total" unit="份" />
    <StatCard label="待核对" :value="summary.drafts" unit="份" />
    <StatCard label="已核对" :value="summary.checked" unit="份" />
    <StatCard label="已发放" :value="summary.released" unit="份" />
    <StatCard label="实际已发" :value="summary.paid" unit="元" tone="brand" />
  </div>
</template>
