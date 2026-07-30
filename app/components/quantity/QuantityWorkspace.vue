<script setup lang="ts">
import type { QuantityMatrixCell, QuantityMatrixView } from '~/lib/quantity/matrix'

defineProps<{
  matrix: QuantityMatrixView
}>()

const emit = defineEmits<{
  configure: [cell: QuantityMatrixCell]
  complete: [cell: QuantityMatrixCell]
  detail: [cell: QuantityMatrixCell]
}>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <QuantityMatrix
      :matrix="matrix"
      @configure="emit('configure', $event)"
      @complete="emit('complete', $event)"
      @detail="emit('detail', $event)"
    />
  </div>
</template>
