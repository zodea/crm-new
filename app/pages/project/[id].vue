<script setup lang="ts">
import { computed } from 'vue'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const dataVisibilityStore = useDataVisibilityStore()
const projectId = computed(() => String(route.params.id ?? ''))
const originHint = computed(() => isDataOriginDTO(route.query.origin)
  ? route.query.origin
  : dataVisibilityStore.includeDemo ? 'demo' : 'real')
</script>

<template>
  <ProjectDetailScreen
    :project-id="projectId"
    :origin-hint="originHint"
    :include-demo="dataVisibilityStore.includeDemo"
  />
</template>
