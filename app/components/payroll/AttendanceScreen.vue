<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralPayrollSourcesScreen from './CentralPayrollSourcesScreen.vue'
import NativeAttendanceScreen from './NativeAttendanceScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeAttendanceScreen v-if="native" />
  <CentralPayrollSourcesScreen v-else initial-tab="attendance" />
</template>
