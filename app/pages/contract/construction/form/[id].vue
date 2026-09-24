<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

definePageMeta({
  name: 'conContractFormEdit',
})
const desktop = isDesktopRuntime()
</script>

<template>
  <ContractFormPage v-if="desktop" kind="construction" />
  <ConstructionContractFormPage v-else />
</template>
