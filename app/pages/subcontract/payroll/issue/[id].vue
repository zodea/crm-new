<script setup lang="ts">
import PayrollNumberingScreen from '~/components/payroll/PayrollNumberingScreen.vue'

const route = useRoute()
</script>

<template>
  <section v-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    正式工资编号需要明确正式来源，请从原工资详情进入。
  </section>
  <PayrollNumberingScreen v-else />
</template>
