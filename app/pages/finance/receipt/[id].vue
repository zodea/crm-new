<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'

definePageMeta({ name: 'receiptDetail' })
const route = useRoute()
const visibility = useDataVisibilityStore()
const origin = computed<DataOriginDTO>(() => route.query.origin === 'demo' ? 'demo' : 'real')
const customerId = computed(() => typeof route.query.customerId === 'string' ? route.query.customerId : '')
const returnTo = computed(() => typeof route.query.returnTo === 'string' ? route.query.returnTo : undefined)
const returnContext = computed(() => typeof route.query.returnContext === 'string' ? route.query.returnContext : undefined)
</script>

<template>
  <ReceiptDetailScreen
    :receipt-id="String(route.params.id ?? '')"
    :customer-id="customerId"
    :origin="origin"
    :include-demo="visibility.includeDemo"
    :return-to="returnTo"
    :return-context="returnContext"
  />
</template>
