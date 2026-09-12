<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollUnavailableScreen from './CentralPayrollUnavailableScreen.vue'
import NativePayrollDraftFormPage from './NativePayrollDraftFormPage.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativePayrollDraftFormPage v-if="native" />
  <CentralPayrollUnavailableScreen v-else />
</template>
