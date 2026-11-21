<script setup lang="ts">
import OwnerDocumentFormPage from '~/components/owner-document/OwnerDocumentFormPage.vue'
import SubcontractChangeDetailScreen from '~/components/owner-document/SubcontractChangeDetailScreen.vue'
import SubcontractSettlementDetailScreen from '~/components/owner-document/SubcontractSettlementDetailScreen.vue'
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const routeKind = Array.isArray(route.params.kind) ? route.params.kind[0] : route.params.kind
const kind = ownerDocumentKindFromRoute('subcontract', routeKind ?? '')
if (!kind)
  throw createError({ statusCode: 404, statusMessage: '未知分包单据类型' })
const documentId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '')
})
const centralChange = computed(() => kind === 'sub_change' && documentId.value !== 'new')
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
</script>

<template>
  <SubcontractSettlementDetailScreen v-if="kind === 'sub_settlement' && documentId !== 'new'" :document-id="documentId" :origin="origin" />
  <SubcontractChangeDetailScreen v-else-if="centralChange" :document-id="documentId" :origin="origin" />
  <OwnerDocumentFormPage v-else :kind="kind" />
</template>
