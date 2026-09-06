<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
definePageMeta({
  name: 'companyExpFormEdit',
})
</script>

<template>
  <ContractFormPage v-if="desktop" kind="company_expense" />
  <AuxiliaryContractFormPage v-else kind="company_expense" />
</template>
