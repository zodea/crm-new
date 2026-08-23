<script setup lang="ts">
import { computed } from 'vue'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import {
  loadProjectReturnOrigin,
  resolveProjectReturnContext,
} from '~/lib/nav/return-to'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const dataVisibilityStore = useDataVisibilityStore()
const projectId = computed(() => String(route.params.id ?? ''))
const originHint = computed(() => isDataOriginDTO(route.query.origin)
  ? route.query.origin
  : dataVisibilityStore.includeDemo ? 'demo' : 'real')
const returnResolution = computed(() => resolveProjectReturnContext({
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  now: Date.now(),
  load: id => typeof sessionStorage === 'undefined'
    ? null
    : loadProjectReturnOrigin(id),
}))
const crewWorkerReturnTo = computed(() => validateCrewWorkerReturnTo(route.query.returnTo))
const returnTo = computed(() => crewWorkerReturnTo.value ?? returnResolution.value.to)
const returnExpiresAt = computed(() => crewWorkerReturnTo.value ? undefined : returnResolution.value.origin?.expiresAt)
</script>

<template>
  <ProjectDetailScreen
    :project-id="projectId"
    :origin-hint="originHint"
    :include-demo="dataVisibilityStore.includeDemo"
    :return-to="returnTo"
    :return-expires-at="returnExpiresAt"
    :return-label="crewWorkerReturnTo ? '返回来源详情' : undefined"
  />
</template>
