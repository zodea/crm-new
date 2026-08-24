<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <ContractListScreen v-if="desktop" kind="施工" />
  <ConstructionContractListScreen v-else />
</template>
