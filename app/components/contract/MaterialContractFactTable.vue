<script setup lang="ts">
import type { MaterialContractFactDTO } from '~/lib/material-contract/repository'
import ContractFactTable from './ContractFactTable.vue'

defineProps<{
  rows: readonly MaterialContractFactDTO[]
  emptyLabel: string
  paidColumn?: boolean
}>()
</script>

<template>
  <ContractFactTable data-testid="material-contract-fact-scroll" :rows="rows" :empty-label="emptyLabel" :paid-column="paidColumn" />
</template>
