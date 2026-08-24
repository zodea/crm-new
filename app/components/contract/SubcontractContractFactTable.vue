<script setup lang="ts">
import type { SubcontractContractFactDTO } from '~/lib/subcontract-contract/repository'
import ContractFactTable from './ContractFactTable.vue'

defineProps<{
  rows: readonly SubcontractContractFactDTO[]
  emptyLabel: string
  focusId?: string | null
}>()
</script>

<template>
  <ContractFactTable
    data-testid="subcontract-contract-fact-scroll"
    :rows="rows"
    :empty-label="emptyLabel"
    :focus-id="focusId"
    anchor-prefix="subcontract-contract-fact"
  />
</template>
