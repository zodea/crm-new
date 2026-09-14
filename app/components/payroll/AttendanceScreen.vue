<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralAttendanceScreen from './CentralAttendanceScreen.vue'
import NativeAttendanceScreen from './NativeAttendanceScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeAttendanceScreen v-if="native" />
  <CentralAttendanceScreen v-else />
</template>
