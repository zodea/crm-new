<script setup lang="ts">
import { computed } from 'vue'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'

const route = useRoute()
const back = computed(() => payrollReadLocation('/subcontract/payroll', payrollViewScope(route.query)))
useTabTitle('工资建单暂未开放')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <h1 class="text-20px font-800">
      工资建单暂未开放
    </h1>
    <PayrollReadNotice />
    <p class="text-13px leading-6 text-ink-soft">
      当前页面不能生成、核对或发放工资。已接管的工资与来源记录可在台账中查询。
    </p>
    <NuxtLink :to="back" class="btn-secondary justify-self-start">
      返回工资台账
    </NuxtLink>
  </main>
</template>
