<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { createDefaultPhaseTasks } from '~/lib/project/phases'

const props = defineProps<{
  projectId: string
}>()

const store = usePhaseTaskStore()
const tasks = computed(() => {
  const persisted = store.byProject(props.projectId)
  return persisted.length ? persisted : createDefaultPhaseTasks(props.projectId)
})

onMounted(() => store.load())
</script>

<template>
  <ProjectFileList :project-id="props.projectId" :tasks="tasks" />
</template>
