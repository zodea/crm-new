<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollFormPage from './CentralPayrollFormPage.vue'
import NativePayrollDraftFormPage from './NativePayrollDraftFormPage.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativePayrollDraftFormPage v-if="native" />
  <CentralPayrollFormPage v-else />
</template>
