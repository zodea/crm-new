<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()
const projectId = computed(() => String(route.params.pid ?? ''))
const groupId = computed(() => String(route.params.gid ?? ''))
</script>

<template>
  <ScheduleContractBindingScreen
    :project-id="projectId"
    :group-id="groupId"
  />
</template>
