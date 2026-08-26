<script setup lang="ts">
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const routeKind = Array.isArray(route.params.kind) ? route.params.kind[0] : route.params.kind
const kind = ownerDocumentKindFromRoute('owner', routeKind ?? '')
if (!kind)
  throw createError({ statusCode: 404, statusMessage: '未知甲方单据类型' })
const desktop = isDesktopRuntime()
const documentId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '')
})
const centralKind = computed(() => !desktop
  && documentId.value !== 'new'
  && (kind === 'owner_change' || kind === 'owner_report' || kind === 'acceptance')
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
    v-else-if="centralKind"
    :kind="centralKind"
    :document-id="documentId"
    :origin="origin"
  />
  <OwnerDocumentFormPage v-else :kind="kind" />
</template>
