<script setup lang="ts">
import CrewWorkerRelationFactDetailScreen from '~/components/crew-worker/CrewWorkerRelationFactDetailScreen.vue'
import QuantityUnitDetailScreen from '~/components/quantity/QuantityUnitDetailScreen.vue'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { quantityUnitReturnPath, readQuantityOrigin } from '~/lib/quantity/navigation'
import { isDataOriginDTO } from '~/types/read-model'

// 薄路由（#103 切片 6A）：参数身份已冻结为 pid=项目 id、uid=户 id（见 ADR 0010 / handoff 决策门）。
const route = useRoute()
const hollowPage = computed(() => /^\/subcontract\/quantity\/[^/]+\/[^/]+\/hollow\//.test(route.path))

const projectId = computed(() => String(route.params.pid ?? ''))
const unitId = computed(() => String(route.params.uid ?? ''))
const visibility = useDataVisibilityStore()
const centralContext = computed(() => {
  const origin = isDataOriginDTO(route.query.origin) ? route.query.origin : null
  const ownerKind: 'crew' | 'worker' | null = route.query.ownerKind === 'crew' || route.query.ownerKind === 'worker' ? route.query.ownerKind : null
  const ownerId = typeof route.query.ownerId === 'string' && route.query.ownerId ? route.query.ownerId : null
  return origin && ownerKind && ownerId ? { origin, ownerKind, ownerId } : null
})
const returnTo = computed(() => centralContext.value
  ? validateCrewWorkerReturnTo(route.query.returnTo) ?? `/base/${centralContext.value.ownerKind}`
  : quantityUnitReturnPath(projectId.value, route.query))
</script>

<template>
  <NuxtPage v-if="hollowPage" />
  <CrewWorkerRelationFactDetailScreen
    v-else-if="centralContext"
    fact-kind="assignment"
    :fact-id="unitId"
    :project-id="projectId"
    :owner-kind="centralContext.ownerKind"
    :owner-id="centralContext.ownerId"
    :origin="centralContext.origin"
    :include-demo="visibility.includeDemo"
    :return-to="returnTo"
  />
  <QuantityUnitDetailScreen v-else :project-id="projectId" :unit-id="unitId" :origin="readQuantityOrigin(route.query)" :return-to="returnTo" :payroll-query="route.query" />
</template>
