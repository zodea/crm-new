<script setup lang="ts">
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { isDataOriginDTO } from '~/types/read-model'

const kind = 'project_penalty' as const
const route = useRoute()
const visibility = useDataVisibilityStore()
const centralContext = computed(() => {
  const origin = isDataOriginDTO(route.query.origin) ? route.query.origin : null
  const ownerKind: 'crew' | 'worker' | null = route.query.ownerKind === 'crew' || route.query.ownerKind === 'worker' ? route.query.ownerKind : null
  const ownerId = typeof route.query.ownerId === 'string' && route.query.ownerId ? route.query.ownerId : null
  return origin && ownerKind && ownerId ? { origin, ownerKind, ownerId } : null
})
const penaltyId = computed(() => String(route.params.id ?? ''))
const returnTo = computed(() => validateCrewWorkerReturnTo(route.query.returnTo) ?? `/base/${centralContext.value?.ownerKind ?? 'worker'}`)
</script>

<template>
  <CrewWorkerRelationFactDetailScreen
    v-if="centralContext"
    fact-kind="penalty"
    :fact-id="penaltyId"
    :owner-kind="centralContext.ownerKind"
    :owner-id="centralContext.ownerId"
    :origin="centralContext.origin"
    :include-demo="visibility.includeDemo"
    :return-to="returnTo"
  />
  <OwnerDocumentFormPage v-else :kind="kind" />
</template>
