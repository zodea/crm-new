<script setup lang="ts">
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

definePageMeta({ name: 'crewForm' })
</script>

<template>
  <MasterDataFormPage kind="crew" return-to-detail />
</template>
