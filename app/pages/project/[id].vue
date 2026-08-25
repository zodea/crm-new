<script setup lang="ts">
import { computed } from 'vue'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import {
  loadProjectReturnOrigin,
  resolveProjectReturnContext,
} from '~/lib/nav/return-to'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
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
const ownerDocumentReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(route.query.returnTo, originHint.value))
const returnTo = computed(() => ownerDocumentReturnTo.value ?? crewWorkerReturnTo.value ?? returnResolution.value.to)
const returnExpiresAt = computed(() => ownerDocumentReturnTo.value || crewWorkerReturnTo.value ? undefined : returnResolution.value.origin?.expiresAt)
</script>

<template>
  <ProjectDetailScreen
    :project-id="projectId"
    :origin-hint="originHint"
    :include-demo="dataVisibilityStore.includeDemo"
    :return-to="returnTo"
    :return-expires-at="returnExpiresAt"
    :return-label="ownerDocumentReturnTo || crewWorkerReturnTo ? '返回来源详情' : undefined"
    :current-route="route.fullPath"
  />
</template>
