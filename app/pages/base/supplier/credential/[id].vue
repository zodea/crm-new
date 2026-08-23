<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { validateSupplierReturnTo } from '~/lib/supplier/return-context'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const supplierId = computed(() => String(route.params.id ?? ''))
const origin = computed<DataOriginDTO>(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const returnTo = computed(() => validateSupplierReturnTo(route.query.returnTo) ?? undefined)
</script>

<template>
  <SupplierCredentialScreen :supplier-id="supplierId" :origin="origin" :return-to="returnTo" />
</template>
