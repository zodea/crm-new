<script setup lang="ts">
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const workerId = computed(() => String(route.params.id ?? ''))
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const returnTo = computed(() => typeof route.query.returnTo === 'string' ? route.query.returnTo : undefined)
const visibility = useDataVisibilityStore()
</script>

<template>
  <CrewWorkerCentralDetailScreen :id="workerId" kind="worker" :origin="origin" :include-demo="visibility.includeDemo" :return-to="returnTo" />
</template>
