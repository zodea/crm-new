<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
definePageMeta({ name: 'otherSettleForm' })
</script>

<template>
  <ContractFormPage v-if="desktop" kind="other_settlement" />
  <OtherSettlementFormPage v-else />
</template>
