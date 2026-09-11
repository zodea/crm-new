<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <FinanceListScreen v-if="desktop" kind="receipt" />
  <ReceiptRegistrationListScreen v-else />
</template>
