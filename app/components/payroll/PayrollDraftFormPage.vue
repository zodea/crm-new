<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollDraftFormPage from './CentralPayrollDraftFormPage.vue'
import NativePayrollDraftFormPage from './NativePayrollDraftFormPage.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativePayrollDraftFormPage v-if="native" />
  <CentralPayrollDraftFormPage v-else />
</template>
