<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => String(route.query.project ?? ''))
const returnSource = computed(() => route.query.return === 'schedule' ? 'schedule' : 'quantity')
const resumeSchedule = computed(() => (
  returnSource.value === 'schedule' && route.query.resume === 'region'
))
</script>

<template>
  <QuantityRegionFormPage
    :project-id="projectId"
    :return-source="returnSource"
    :resume-schedule="resumeSchedule"
  />
</template>
