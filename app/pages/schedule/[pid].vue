<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => String(route.params.pid ?? ''))
</script>

<template>
  <ScheduleScreen :project-id="projectId" />
</template>
