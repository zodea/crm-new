<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollSourcesScreen from './CentralPayrollSourcesScreen.vue'
import NativeSignedDayworkScreen from './NativeSignedDayworkScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeSignedDayworkScreen v-if="native" />
  <CentralPayrollSourcesScreen v-else initial-tab="daywork" />
</template>
