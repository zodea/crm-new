<script setup lang="ts">
import AuxiliaryContractDetailScreen from '~/components/contract/AuxiliaryContractDetailScreen.vue'

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
</script>

<template>
  <AuxiliaryContractDetailScreen kind="company_expense" :contract-id="id" />
</template>
