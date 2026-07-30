<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()
const projectId = computed(() => String(route.params.id ?? ''))
</script>

<template>
  <ProjectDetailScreen :project-id="projectId" />
</template>
