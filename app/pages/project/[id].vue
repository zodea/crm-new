<script setup lang="ts">
import { computed } from 'vue'
import { validateAuxiliaryDetailReturnTo } from '~/lib/auxiliary-contract/navigation'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { validateCustomerDetailReturnTo } from '~/lib/customer/return-context'
import {
  loadProjectReturnOrigin,
  resolveProjectReturnContext,
} from '~/lib/nav/return-to'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { validateProjectSupplierIdentityReturnTo } from '~/lib/project-supplier/return-context'
import ProjectDetailScreen from '~/pages/project/_components/ProjectDetailScreen.vue'
import TargetCostProjectReturn from '~/pages/project/_components/TargetCostProjectReturn.vue'
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
const customerReturnTo = computed(() => validateCustomerDetailReturnTo(route.query.returnTo, originHint.value))
const projectSupplierReturnTo = computed(() => validateProjectSupplierIdentityReturnTo(route.query.returnTo, {
  entity: 'project',
  id: projectId.value,
  origin: originHint.value,
}))
const auxiliaryReturnTo = computed(() => validateAuxiliaryDetailReturnTo(route.query.returnTo, originHint.value))
const returnTo = computed(() => auxiliaryReturnTo.value ?? ownerDocumentReturnTo.value ?? crewWorkerReturnTo.value ?? projectSupplierReturnTo.value ?? returnResolution.value.to)
const returnExpiresAt = computed(() => auxiliaryReturnTo.value || ownerDocumentReturnTo.value || crewWorkerReturnTo.value || projectSupplierReturnTo.value ? undefined : returnResolution.value.origin?.expiresAt)
</script>

<template>
  <div class="min-w-0">
    <TargetCostProjectReturn :project-id="projectId" :origin="originHint" :return-to="route.query.returnTo" />
    <ProjectDetailScreen
      :project-id="projectId"
      :origin-hint="originHint"
      :include-demo="dataVisibilityStore.includeDemo"
      :return-to="returnTo"
      :customer-return-to="customerReturnTo || undefined"
      :return-expires-at="returnExpiresAt"
      :return-label="projectSupplierReturnTo ? '返回项目分供方工作台' : auxiliaryReturnTo || ownerDocumentReturnTo || crewWorkerReturnTo ? '返回来源详情' : undefined"
      :current-route="route.fullPath"
    />
  </div>
</template>
