<script setup lang="ts">
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'

definePageMeta({ name: 'omDirectList' })
</script>

<template>
  <MaterialListScreen kind="owner_direct" data-owner-material-kind="direct" />
</template>
