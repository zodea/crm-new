<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <ContractAuxListScreen v-if="desktop" kind="other_expense" />
  <AuxiliaryContractListScreen v-else kind="other_expense" />
</template>
