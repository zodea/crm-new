<script setup lang="ts">
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'

definePageMeta({ name: 'omRequisitionList' })
</script>

<template>
  <MaterialListScreen kind="owner_requisition" data-owner-material-kind="requisition" />
</template>
