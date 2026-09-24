<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralTargetCostDetailScreen from './CentralTargetCostDetailScreen.vue'
import NativeTargetCostDetailScreen from './NativeTargetCostDetailScreen.vue'

const native = isDesktopRuntime()
</script>

<template>
  <NativeTargetCostDetailScreen v-if="native" />
  <CentralTargetCostDetailScreen v-else />
</template>
