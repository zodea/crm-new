<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => String(route.query.project ?? ''))
</script>

<template>
  <QuantityRegionFormPage :project-id="projectId" />
</template>
