<script setup lang="ts">
definePageMeta({ name: 'payApplyFormEdit' })

const route = useRoute()
const isDetailRoute = computed(() => route.path.endsWith('/detail'))
</script>

<template>
  <NuxtPage v-if="isDetailRoute" />
  <FinanceFormPage v-else kind="payment_application" />
</template>
