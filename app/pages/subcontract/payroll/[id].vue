<script setup lang="ts">
import CrewWorkerRelationFactDetailScreen from '~/components/crew-worker/CrewWorkerRelationFactDetailScreen.vue'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import PayrollStatementDetailScreen from '~/pages/subcontract/payroll/_components/PayrollStatementDetailScreen.vue'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const visibility = useDataVisibilityStore()
const centralContext = computed(() => {
  const origin = isDataOriginDTO(route.query.origin) ? route.query.origin : null
  const ownerKind: 'crew' | 'worker' | null = route.query.ownerKind === 'crew' || route.query.ownerKind === 'worker' ? route.query.ownerKind : null
  const ownerId = typeof route.query.ownerId === 'string' && route.query.ownerId ? route.query.ownerId : null
  return origin && ownerKind && ownerId ? { origin, ownerKind, ownerId } : null
})
const statementId = computed(() => String(route.params.id ?? ''))
const invalidOwnerContext = computed(() => (route.query.ownerKind != null || route.query.ownerId != null) && !centralContext.value)
const returnTo = computed(() => validateCrewWorkerReturnTo(route.query.returnTo) ?? '/base/worker')
</script>

<template>
  <section v-if="invalidOwnerContext" role="alert" class="panel p-4 text-danger">
    工资来源身份不完整，请从原工人或工资台账重新打开。不会改用其他记录。
  </section>
  <CrewWorkerRelationFactDetailScreen
    v-else-if="centralContext"
    fact-kind="wage"
    :fact-id="statementId"
    :owner-kind="centralContext.ownerKind"
    :owner-id="centralContext.ownerId"
    :origin="centralContext.origin"
    :include-demo="visibility.includeDemo"
    :return-to="returnTo"
  />
  <PayrollStatementDetailScreen v-else />
</template>
