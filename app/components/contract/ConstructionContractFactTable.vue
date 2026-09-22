<script setup lang="ts">
import type { ConstructionContractFactDTO } from '~/lib/construction-contract/repository'
import { computed } from 'vue'
import ContractFactTable from './ContractFactTable.vue'

const props = defineProps<{
  rows: readonly ConstructionContractFactDTO[]
  emptyLabel: string
  focusId?: string | null
  returnTo?: string | null
  anchorScope?: 'acceptance' | 'warranty'
  returnFocusView?: 'acceptance' | 'warranty'
  restoreScrollLeft?: number
}>()
defineEmits<{ viewRestored: [] }>()

const anchorPrefix = computed(() => props.anchorScope
  ? `construction-contract-fact-${props.anchorScope}`
  : 'construction-contract-fact')
</script>

<template>
  <ContractFactTable
    data-testid="construction-contract-fact-scroll"
    :rows="rows"
    :empty-label="emptyLabel"
    :focus-id="focusId"
    :return-to="returnTo"
    :return-focus-view="returnFocusView"
    :anchor-prefix="anchorPrefix"
    :restore-scroll-left="restoreScrollLeft"
    @view-restored="$emit('viewRestored')"
  />
</template>
