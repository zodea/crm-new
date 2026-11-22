<script setup lang="ts">
import type { PayrollC1Options } from '~/lib/payroll/central-attendance-contract'
import type { PayrollC1Draft } from '~/lib/payroll/central-c1-contract'
import PayrollTierFormFields from './PayrollTierFormFields.vue'

const props = defineProps<{
  draft: PayrollC1Draft
  options: PayrollC1Options
  disabled: boolean
  fieldErrors: Record<string, string>
}>()
const emit = defineEmits<{ patch: [patch: Partial<PayrollC1Draft>] }>()
</script>

<template>
  <PayrollTierFormFields v-bind="props" tier="C1" @patch="emit('patch', $event)" />
</template>
