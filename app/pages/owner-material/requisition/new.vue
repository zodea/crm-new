<script setup lang="ts">
import MaterialFormPage from '~/components/material/MaterialFormPage.vue'

definePageMeta({ name: 'omRequisitionForm' })
</script>

<template>
  <MaterialFormPage kind="owner_requisition" data-owner-material-kind="requisition" />
</template>
