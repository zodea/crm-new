<script setup lang="ts">
import type { F3FormKind } from '~/lib/finance/forms'
import type { FinancePageDraft } from '~/lib/finance/page'
import type { LookupOption } from '~/lib/kit/lookup'
import FinanceGeneralFormFields from './FinanceGeneralFormFields.vue'
import FinanceIncomingFormFields from './FinanceIncomingFormFields.vue'
import FinancePaymentFormFields from './FinancePaymentFormFields.vue'

defineProps<{
  kind: F3FormKind
  draft: FinancePageDraft
  fieldErrors?: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchWorkers?: (keyword: string) => Promise<LookupOption[]>
  fetchOriginalExpenses?: (keyword: string) => Promise<LookupOption[]>
  fetchIncomeContracts: (keyword: string) => Promise<LookupOption[]>
  fetchExpenseContracts: (keyword: string) => Promise<LookupOption[]>
  fetchSettlements: (keyword: string) => Promise<LookupOption[]>
  fetchInvoices: (keyword: string) => Promise<LookupOption[]>
  fetchPaymentApplications: (keyword: string) => Promise<LookupOption[]>
}>()

defineEmits<{
  patch: [patch: Partial<FinancePageDraft>]
  clearError: [field: string]
}>()
</script>

<template>
  <FinanceIncomingFormFields
    v-if="kind === 'receipt' || kind === 'invoice_application'"
    :kind="kind"
    :draft="draft"
    :field-errors="fieldErrors"
    :fetch-projects="fetchProjects"
    :fetch-customers="fetchCustomers"
    :fetch-income-contracts="fetchIncomeContracts"
    @patch="$emit('patch', $event)"
    @clear-error="$emit('clearError', $event)"
  />
  <FinanceGeneralFormFields
    v-else-if="kind === 'current' || kind === 'reimbursement'"
    :kind="kind"
    :draft="draft"
    :field-errors="fieldErrors"
    :fetch-projects="fetchProjects"
    :fetch-workers="fetchWorkers"
    :fetch-original-expenses="fetchOriginalExpenses"
    :fetch-suppliers="fetchSuppliers"
    @patch="$emit('patch', $event)"
    @clear-error="$emit('clearError', $event)"
  />
  <FinancePaymentFormFields
    v-else
    :kind="kind"
    :draft="draft"
    :field-errors="fieldErrors"
    :fetch-projects="fetchProjects"
    :fetch-suppliers="fetchSuppliers"
    :fetch-workers="fetchWorkers"
    :fetch-expense-contracts="fetchExpenseContracts"
    :fetch-settlements="fetchSettlements"
    :fetch-invoices="fetchInvoices"
    :fetch-payment-applications="fetchPaymentApplications"
    @patch="$emit('patch', $event)"
    @clear-error="$emit('clearError', $event)"
  />
</template>
