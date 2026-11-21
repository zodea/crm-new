<script setup lang="ts">
import QuantityHollowDetailScreen from '~/components/quantity/QuantityHollowDetailScreen.vue'

const route = useRoute()
</script>

<template>
  <QuantityHollowDetailScreen :project-id="String(route.params.pid ?? '')" :unit-id="String(route.params.uid ?? '')" :record-id="String(route.params.id ?? '')" />
</template>
