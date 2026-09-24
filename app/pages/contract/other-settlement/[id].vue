<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <OtherSettlementDetailScreen :settlement-id="String(route.params.id)" />
</template>
