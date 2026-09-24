<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
definePageMeta({
  name: 'otherExpFormEdit',
})
</script>

<template>
  <ContractFormPage v-if="desktop" kind="other_expense" />
  <AuxiliaryContractFormPage v-else kind="other_expense" />
</template>
