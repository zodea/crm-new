<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralSignedDayworkScreen from './CentralSignedDayworkScreen.vue'
import NativeSignedDayworkScreen from './NativeSignedDayworkScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeSignedDayworkScreen v-if="native" />
  <CentralSignedDayworkScreen v-else />
</template>
