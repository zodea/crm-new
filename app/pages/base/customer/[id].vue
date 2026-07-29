<script setup lang="ts">
const route = useRoute()
const customerId = computed(() => String(route.params.id ?? ''))
</script>

<template>
  <CustomerDetailScreen :customer-id="customerId" />
</template>
