<script setup lang="ts">
import { readQuantityOrigin } from '~/lib/quantity/navigation'

const route = useRoute()
const projectId = computed(() => String(route.query.project ?? ''))
const origin = computed(() => readQuantityOrigin(route.query))
const returnSource = computed(() => route.query.return === 'schedule' ? 'schedule' : 'quantity')
const resumeSchedule = computed(() => (
  returnSource.value === 'schedule' && route.query.resume === 'region'
))
</script>

<template>
  <QuantityRegionFormPage
    :project-id="projectId"
    :origin="origin"
    :return-source="returnSource"
    :resume-schedule="resumeSchedule"
  />
</template>
