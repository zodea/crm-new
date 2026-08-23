<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const crewId = computed(() => String(route.params.id ?? ''))
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const returnTo = computed(() => typeof route.query.returnTo === 'string' ? route.query.returnTo : undefined)
const visibility = useDataVisibilityStore()
const desktop = isDesktopRuntime()
</script>

<template>
  <CrewDetailScreen v-if="desktop" :crew-id="crewId" />
  <CrewWorkerCentralDetailScreen v-else :id="crewId" kind="crew" :origin="origin" :include-demo="visibility.includeDemo" :return-to="returnTo" />
</template>
