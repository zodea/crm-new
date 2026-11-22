<script setup lang="ts">
import { computed } from 'vue'
import ScheduleContractBindingScreen from '~/pages/schedule/[pid]/bind/_components/ScheduleContractBindingScreen.vue'

const route = useRoute()
const projectId = computed(() => typeof route.params.pid === 'string' ? route.params.pid : '')
const groupId = computed(() => typeof route.params.gid === 'string' ? route.params.gid : '')
const origin = computed(() => route.query.origin === undefined || route.query.origin === 'real' ? 'real' : route.query.origin === 'demo' ? 'demo' : null)
</script>

<template>
  <ScheduleContractBindingScreen
    :project-id="projectId"
    :group-id="groupId"
    :origin="origin"
  />
</template>
