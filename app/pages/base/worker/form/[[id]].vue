<script setup lang="ts">
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

definePageMeta({ name: 'workerForm' })
</script>

<template>
  <MasterDataFormPage kind="worker" return-to-detail />
</template>
