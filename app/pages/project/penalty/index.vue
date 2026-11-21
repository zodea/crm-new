<script setup lang="ts">
import OwnerDocumentListScreen from '~/components/owner-document/OwnerDocumentListScreen.vue'

const kind = 'project_penalty' as const
</script>

<template>
  <OwnerDocumentListScreen :kind="kind" />
</template>
