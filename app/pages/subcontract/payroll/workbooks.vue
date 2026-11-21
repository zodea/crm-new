<script setup lang="ts">
import PayrollWorkbookScreen from '~/components/payroll/PayrollWorkbookScreen.vue'

const route = useRoute()
</script>

<template>
  <section v-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    请从正式工资台账进入完整工作簿。
  </section>
  <PayrollWorkbookScreen v-else />
</template>
