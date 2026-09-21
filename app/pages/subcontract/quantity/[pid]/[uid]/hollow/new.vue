<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <QuantityHollowFormPage :project-id="String(route.params.pid ?? '')" :unit-id="String(route.params.uid ?? '')" />
</template>
