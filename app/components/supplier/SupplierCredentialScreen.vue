<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import SupplierCredentialCentralPanel from './SupplierCredentialCentralPanel.vue'

defineProps<{ supplierId: string, origin: DataOriginDTO, returnTo?: string }>()
</script>

<template>
  <SupplierCredentialCentralPanel :supplier-id="supplierId" :origin="origin" :return-to="returnTo" />
</template>
