<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <ContractListScreen v-if="desktop" kind="分包" />
  <SubcontractContractListScreen v-else />
</template>
