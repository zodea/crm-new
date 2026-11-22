<script setup lang="ts">
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'

definePageMeta({ name: 'omArrivalList' })
</script>

<template>
  <MaterialListScreen kind="owner_arrival" data-owner-material-kind="arrival" />
</template>
