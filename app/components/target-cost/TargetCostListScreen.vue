<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralTargetCostListScreen from './CentralTargetCostListScreen.vue'
import NativeTargetCostListScreen from './NativeTargetCostListScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeTargetCostListScreen v-if="native" />
  <CentralTargetCostListScreen v-else />
</template>
