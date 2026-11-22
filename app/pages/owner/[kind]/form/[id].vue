<script setup lang="ts">
import OwnerDocumentFormPage from '~/components/owner-document/OwnerDocumentFormPage.vue'
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'

const route = useRoute()
const routeKind = Array.isArray(route.params.kind) ? route.params.kind[0] : route.params.kind
const kind = ownerDocumentKindFromRoute('owner', routeKind ?? '')
if (kind !== 'owner_change' && kind !== 'owner_report' && kind !== 'acceptance'
  && kind !== 'final_settlement' && kind !== 'owner_penalty') {
  throw createError({ statusCode: 404, statusMessage: '未知甲方商务单据类型' })
}
</script>

<template>
  <OwnerDocumentFormPage :kind="kind" />
</template>
