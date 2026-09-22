<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollDetailScreen from './CentralPayrollDetailScreen.vue'
import NativePayrollStatementDetailScreen from './NativePayrollStatementDetailScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativePayrollStatementDetailScreen v-if="native" />
  <CentralPayrollDetailScreen v-else />
</template>
