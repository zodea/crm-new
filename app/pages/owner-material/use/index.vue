<script setup lang="ts">
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'

definePageMeta({ name: 'omUseList' })
</script>

<template>
  <MaterialListScreen kind="owner_use" data-owner-material-kind="use" />
</template>
