<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { MasterDataOwnerType } from '~/lib/master-data/forms'
import type { MasterDataPageDraft } from '~/lib/master-data/page'
import CrewFormFields from '~/components/master-data/CrewFormFields.vue'
import CustomerFormFields from '~/components/master-data/CustomerFormFields.vue'
import ProjectMasterDataFormFields from '~/components/master-data/ProjectMasterDataFormFields.vue'
import SupplierFormFields from '~/components/master-data/SupplierFormFields.vue'
import TargetCostFormFields from '~/components/master-data/TargetCostFormFields.vue'
import WorkerFormFields from '~/components/master-data/WorkerFormFields.vue'

defineProps<{
  kind: MasterDataOwnerType
  fieldErrors: Record<string, string>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCrews: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  clearError: [field: keyof MasterDataPageDraft]
  verifyTaxpayer: []
}>()

const draft = defineModel<MasterDataPageDraft>({ required: true })
</script>

<template>
  <SupplierFormFields
    v-if="kind === 'supplier'"
    v-model="draft"
    :field-errors="fieldErrors"
    @clear-error="emit('clearError', $event)"
    @verify-taxpayer="emit('verifyTaxpayer')"
  />
  <CustomerFormFields
    v-else-if="kind === 'customer'"
    v-model="draft"
    :field-errors="fieldErrors"
    @clear-error="emit('clearError', $event)"
  />
  <CrewFormFields
    v-else-if="kind === 'crew'"
    v-model="draft"
    :field-errors="fieldErrors"
    @clear-error="emit('clearError', $event)"
  />
  <WorkerFormFields
    v-else-if="kind === 'worker'"
    v-model="draft"
    :field-errors="fieldErrors"
    :fetch-crews="fetchCrews"
    :fetch-projects="fetchProjects"
    @clear-error="emit('clearError', $event)"
  />
  <ProjectMasterDataFormFields
    v-else-if="kind === 'project'"
    v-model="draft"
    :field-errors="fieldErrors"
    :fetch-customers="fetchCustomers"
    @clear-error="emit('clearError', $event)"
  />
  <TargetCostFormFields
    v-else
    v-model="draft"
    :field-errors="fieldErrors"
    :fetch-projects="fetchProjects"
    @clear-error="emit('clearError', $event)"
  />
</template>
