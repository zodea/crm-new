<script setup lang="ts">
import type { ConstructionContractFactDTO } from '~/lib/construction-contract/repository'
import ContractFactTable from './ContractFactTable.vue'

defineProps<{
  rows: readonly ConstructionContractFactDTO[]
  emptyLabel: string
  focusId?: string | null
}>()
</script>

<template>
  <ContractFactTable
    data-testid="construction-contract-fact-scroll"
    :rows="rows"
    :empty-label="emptyLabel"
    :focus-id="focusId"
    anchor-prefix="construction-contract-fact"
  />
</template>
