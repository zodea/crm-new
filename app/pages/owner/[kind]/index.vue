<script setup lang="ts">
import OwnerDocumentListScreen from '~/components/owner-document/OwnerDocumentListScreen.vue'
import { ownerDocumentKindFromRoute } from '~/lib/owner-document/page'

const route = useRoute()
const routeKind = Array.isArray(route.params.kind) ? route.params.kind[0] : route.params.kind
const kind = ownerDocumentKindFromRoute('owner', routeKind ?? '')
if (!kind)
  throw createError({ statusCode: 404, statusMessage: '未知甲方单据类型' })
</script>

<template>
  <OwnerDocumentListScreen :kind="kind" />
</template>
