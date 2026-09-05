<script setup lang="ts">
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'
import { isDesktopRuntime } from '~/lib/platform/runtime'
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
const centralChange = computed(() => !isDesktopRuntime() && kind === 'sub_change' && documentId.value !== 'new')
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
</script>

<template>
  <SubcontractSettlementDetailScreen v-if="!isDesktopRuntime() && kind === 'sub_settlement' && documentId !== 'new'" :document-id="documentId" :origin="origin" />
  <SubcontractChangeDetailScreen v-else-if="centralChange" :document-id="documentId" :origin="origin" />
  <OwnerDocumentFormPage v-else :kind="kind" />
</template>
