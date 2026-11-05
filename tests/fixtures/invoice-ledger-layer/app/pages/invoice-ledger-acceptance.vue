<script setup lang="ts">
// The normal application does not extend this test-only layer.
import CentralInvoiceEntry from '~/components/invoice/CentralInvoiceEntry.vue'
</script>

<template>
  <CentralInvoiceEntry mode="ledger" />
</template>
