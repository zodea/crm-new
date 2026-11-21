<script setup lang="ts">
import ScheduleScreen from '~/components/schedule/ScheduleScreen.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.pid ?? ''))
</script>

<template>
  <ScheduleScreen :project-id="projectId" />
</template>
