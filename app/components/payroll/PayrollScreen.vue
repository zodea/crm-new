<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollScreen from './CentralPayrollScreen.vue'
import NativePayrollScreen from './NativePayrollScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativePayrollScreen v-if="native" />
  <CentralPayrollScreen v-else />
</template>
