<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import CentralScheduleContractBindingScreen from './CentralScheduleContractBindingScreen.vue'
import NativeScheduleContractBindingScreen from './NativeScheduleContractBindingScreen.vue'

withDefaults(defineProps<{ projectId: string, groupId: string, origin?: DataOriginDTO | null }>(), { origin: 'real' })
const desktop = isDesktopRuntime()
</script>

<template>
  <NativeScheduleContractBindingScreen v-if="desktop" :project-id="projectId" :group-id="groupId" />
  <CentralScheduleContractBindingScreen v-else :project-id="projectId" :group-id="groupId" :origin="origin" />
</template>
