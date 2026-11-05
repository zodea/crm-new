<script setup lang="ts">
import CentralInvoiceCorrectionEntry from '~/components/invoice/CentralInvoiceCorrectionEntry.vue'

const route = useRoute()
const invoiceId = computed(() => typeof route.params.invoiceId === 'string' ? route.params.invoiceId : '')
</script>

<template>
  <CentralInvoiceCorrectionEntry :key="invoiceId" :invoice-id="invoiceId" />
</template>
