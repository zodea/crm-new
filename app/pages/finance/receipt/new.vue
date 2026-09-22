<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
definePageMeta({ name: 'receiptForm' })
</script>

<template>
  <FinanceFormPage v-if="desktop" kind="receipt" />
  <ReceiptFormScreen v-else />
</template>
