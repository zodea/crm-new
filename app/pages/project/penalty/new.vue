<script setup lang="ts">
import OwnerDocumentFormPage from '~/components/owner-document/OwnerDocumentFormPage.vue'

const kind = 'project_penalty' as const
</script>

<template>
  <OwnerDocumentFormPage :kind="kind" />
</template>
