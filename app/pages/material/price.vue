<script setup lang="ts">
import { onMounted } from 'vue'
import MaterialPriceAnalysisScreen from '~/components/material/price/MaterialPriceAnalysisScreen.vue'
import { useContractStore } from '~/stores/contract'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { useProjectStore } from '~/stores/project'
import { useSupplierStore } from '~/stores/supplier'

const deliveryStore = useDeliveryRecordStore()
const supplierStore = useSupplierStore()
const projectStore = useProjectStore()
const contractStore = useContractStore()

onMounted(() => {
  void Promise.all([
    deliveryStore.load(),
    supplierStore.load(),
    projectStore.load(),
    contractStore.load(),
  ])
})
</script>

<template>
  <MaterialPriceAnalysisScreen
    :records="deliveryStore.list"
    :suppliers="supplierStore.list"
    :projects="projectStore.list"
    :contracts="contractStore.list"
    :loading="
      deliveryStore.loading
        || supplierStore.loading
        || projectStore.loading
        || contractStore.loading
    "
  />
</template>
