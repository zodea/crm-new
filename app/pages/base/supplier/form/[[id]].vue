<script setup lang="ts">
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

definePageMeta({ name: 'supplierForm' })
</script>

<template>
  <MasterDataFormPage kind="supplier" :return-to-detail="true" />
</template>
