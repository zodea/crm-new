<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <ContractAuxListScreen v-if="desktop" kind="company_expense" />
  <AuxiliaryContractListScreen v-else kind="company_expense" />
</template>
