<script setup lang="ts">
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

definePageMeta({ name: 'customerForm' })
</script>

<template>
  <MasterDataFormPage kind="customer" return-to-detail />
</template>
