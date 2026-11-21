<script setup lang="ts">
import CentralInvoiceCorrectionEntry from '~/components/invoice/CentralInvoiceCorrectionEntry.vue'

const route = useRoute()
const invoiceId = computed(() => typeof route.params.invoiceId === 'string' ? route.params.invoiceId : '')
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <NuxtLink :to="{ path: '/finance/invoice/manual-new', query: { invoice: invoiceId } }" class="m-2 w-fit text-sm text-brand underline">
      返回发票工作区
    </NuxtLink>
    <CentralInvoiceCorrectionEntry :key="invoiceId" :invoice-id="invoiceId" class="min-h-0 flex-1" />
  </div>
</template>
