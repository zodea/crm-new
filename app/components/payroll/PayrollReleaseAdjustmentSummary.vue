<script setup lang="ts">
import type { PayrollReleaseAdjustmentApplication } from '~/lib/payroll/central-release-adjustment-contract'
import { payrollAmount } from '~/lib/payroll/read-presentation'

defineProps<{ applications?: PayrollReleaseAdjustmentApplication[] }>()
</script>

<template>
  <section v-if="applications?.length" class="grid gap-2 border border-line p-3 text-12px" aria-label="本次更正处理摘要">
    <h3 class="font-700">
      本次同时处理的原更正
    </h3><p v-for="row in applications" :key="row.adjustmentId" class="break-all">
      {{ row.adjustmentId }}：{{ payrollAmount(row.amount) }}
    </p><p>以上是处理关系，只有本次真实发放成功才生效，不另计一次退款。处理选择在原工资整页核对。</p>
  </section>
</template>
