<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

definePageMeta({
  name: 'matContractFormEdit',
})
const desktop = isDesktopRuntime()
</script>

<template>
  <ContractFormPage v-if="desktop" kind="material" />
  <MaterialContractFormPage v-else />
</template>
