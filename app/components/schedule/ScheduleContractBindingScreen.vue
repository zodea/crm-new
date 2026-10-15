<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import CentralScheduleContractBindingScreen from './CentralScheduleContractBindingScreen.vue'

withDefaults(defineProps<{ projectId: string, groupId: string, origin?: DataOriginDTO | null }>(), { origin: 'real' })
</script>

<template>
  <CentralScheduleContractBindingScreen :project-id="projectId" :group-id="groupId" :origin="origin" />
</template>
