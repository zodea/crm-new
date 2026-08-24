<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

definePageMeta({
  name: 'conContractForm',
})
const desktop = isDesktopRuntime()
</script>

<template>
  <ContractFormPage v-if="desktop" kind="construction" />
  <ConstructionContractFormPage v-else />
</template>
