<script setup lang="ts">
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const routeKind = Array.isArray(route.params.kind) ? route.params.kind[0] : route.params.kind
const kind = ownerDocumentKindFromRoute('owner', routeKind ?? '')
if (!kind)
  throw createError({ statusCode: 404, statusMessage: '未知甲方单据类型' })
const documentId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '')
})
const centralKind = computed(() => documentId.value !== 'new'
  && (kind === 'owner_change' || kind === 'owner_report' || kind === 'acceptance'
    || kind === 'final_settlement' || kind === 'owner_penalty')
  ? kind
  : null)
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const acceptanceVariant = computed(() => route.query.variant === 'warranty' ? 'warranty' : 'acceptance')
</script>

<template>
  <OwnerAcceptanceDetailScreen
    v-if="centralKind === 'acceptance'"
    :document-id="documentId"
    :origin="origin"
    :variant="acceptanceVariant"
  />
  <OwnerCommercialDocumentDetailScreen
    v-else-if="centralKind && centralKind !== 'final_settlement' && centralKind !== 'owner_penalty'"
    :kind="centralKind"
    :document-id="documentId"
    :origin="origin"
  />
  <OwnerFinalSettlementDetailScreen
    v-else-if="centralKind === 'final_settlement'"
    :document-id="documentId"
    :origin="origin"
  />
  <OwnerPenaltyDetailScreen
    v-else-if="centralKind === 'owner_penalty'"
    :document-id="documentId"
    :origin="origin"
  />
  <OwnerDocumentFormPage v-else :kind="kind" />
</template>
