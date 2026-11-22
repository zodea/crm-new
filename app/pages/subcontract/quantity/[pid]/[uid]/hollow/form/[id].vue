<script setup lang="ts">
import QuantityHollowFormPage from '~/components/quantity/QuantityHollowFormPage.vue'

const route = useRoute()
</script>

<template>
  <QuantityHollowFormPage :project-id="String(route.params.pid ?? '')" :unit-id="String(route.params.uid ?? '')" :record-id="String(route.params.id ?? '')" />
</template>
