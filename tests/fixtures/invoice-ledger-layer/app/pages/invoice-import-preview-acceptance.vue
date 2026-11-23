<script setup lang="ts">
// 仅供隔离验收构建挂载；普通应用不加载此 layer。
import CentralInvoiceImportPreviewEntry from '~/components/invoice/CentralInvoiceImportPreviewEntry.vue'
import { useProductionAccessStore } from '~/stores/production-access'

const access = useProductionAccessStore()
</script>

<template>
  <main class="p-4">
    <button type="button" @click="access.check()">
      验收：核对访问状态
    </button>
    <CentralInvoiceImportPreviewEntry />
  </main>
</template>
