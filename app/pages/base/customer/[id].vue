<script setup lang="ts">
import CustomerDetailScreen from '~/pages/base/customer/_components/CustomerDetailScreen.vue'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const customerId = computed(() => String(route.params.id ?? ''))
const visibility = useDataVisibilityStore()
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const returnTo = computed(() => typeof route.query.returnTo === 'string' ? route.query.returnTo : undefined)
const returnContext = computed(() => typeof route.query.returnContext === 'string' ? route.query.returnContext : undefined)
</script>

<template>
  <CustomerDetailScreen
    :customer-id="customerId"
    :origin="origin"
    :include-demo="visibility.includeDemo"
    :return-to="returnTo"
    :return-context="returnContext"
  />
</template>
