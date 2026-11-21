<script setup lang="ts">
import type { PayrollC2Draft } from '~/lib/payroll/central-c2-contract'
import type { PayrollParticipantOptions } from '~/lib/payroll/central-contract'
import PayrollTierFormFields from './PayrollTierFormFields.vue'

const props = defineProps<{
  draft: PayrollC2Draft
  options: PayrollParticipantOptions
  disabled: boolean
  fieldErrors: Record<string, string>
}>()
const emit = defineEmits<{ patch: [patch: Partial<PayrollC2Draft>] }>()
</script>

<template>
  <PayrollTierFormFields v-bind="props" tier="C2" @patch="emit('patch', $event)" />
</template>
