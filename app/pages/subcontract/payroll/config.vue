<script setup lang="ts">
import PayrollAConfigScreen from '~/pages/subcontract/payroll/_components/PayrollAConfigScreen.vue'
import PayrollC1ConfigScreen from '~/pages/subcontract/payroll/_components/PayrollC1ConfigScreen.vue'
import PayrollC2ConfigScreen from '~/pages/subcontract/payroll/_components/PayrollC2ConfigScreen.vue'

const route = useRoute()
</script>

<template>
  <PayrollC2ConfigScreen v-if="route.query.format === 'C2'" />
  <PayrollC1ConfigScreen v-else-if="route.query.format === 'C1'" />
  <PayrollAConfigScreen v-else-if="route.query.format == null || route.query.format === 'A'" />
  <section v-else class="panel p-4 text-warn" role="status">
    该格式的中央配置尚未开放。
  </section>
</template>
