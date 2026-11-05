<script setup lang="ts">
import { computed } from 'vue'
import CentralInvoiceEntry from '~/components/invoice/CentralInvoiceEntry.vue'
import CentralInvoiceManualEntry from '~/components/invoice/CentralInvoiceManualEntry.vue'

const route = useRoute()
const router = useRouter()
const invoiceId = computed(() => typeof route.query.invoice === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(route.query.invoice) ? route.query.invoice : null)
async function saved(id: string) {
  await router.replace({ query: { invoice: id } })
}
</script>

<template>
  <CentralInvoiceEntry v-if="invoiceId" mode="workspace" :initial-selected-id="invoiceId" />
  <CentralInvoiceManualEntry v-else @saved="saved" />
</template>
