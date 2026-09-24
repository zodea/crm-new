<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <QuantityHollowDetailScreen :project-id="String(route.params.pid ?? '')" :unit-id="String(route.params.uid ?? '')" :record-id="String(route.params.id ?? '')" />
</template>
