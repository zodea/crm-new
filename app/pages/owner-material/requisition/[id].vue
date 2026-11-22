<script setup lang="ts">
import MaterialFormPage from '~/components/material/MaterialFormPage.vue'

definePageMeta({ name: 'omRequisitionFormEdit' })
</script>

<template>
  <MaterialFormPage kind="owner_requisition" data-owner-material-kind="requisition" />
</template>
