<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <section v-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    请从正式工资台账进入完整工作簿。
  </section>
  <PayrollWorkbookScreen v-else />
</template>
