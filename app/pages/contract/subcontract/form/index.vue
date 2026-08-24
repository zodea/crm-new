<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

definePageMeta({
  name: 'subContractForm',
})
const desktop = isDesktopRuntime()
</script>

<template>
  <ContractFormPage v-if="desktop" kind="subcontract" />
  <SubcontractContractFormPage v-else />
</template>
