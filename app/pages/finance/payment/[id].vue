<script setup lang="ts">
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'

definePageMeta({ name: 'payApplyFormEdit' })

const route = useRoute()
const isDetailRoute = computed(() => route.path.endsWith('/detail'))
</script>

<template>
  <NuxtPage v-if="isDetailRoute" />
  <FinanceFormPage v-else kind="payment_application" />
</template>
