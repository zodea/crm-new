<script setup lang="ts">
import type { AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'

const props = defineProps<{ kind: AuxiliaryContractKind }>()
const { draft, title, files, errors, loading, loadError, saveError, loadingAction, closeAfterSave, dirty, initialize, save, leave, patch, fetchProjects, fetchSuppliers } = useAuxiliaryContractForm(() => props.kind)
const { attachments, pendingAttachments, pendingRemoveIds, pendingRestoreIds, desktopAttachmentPicker, handleFiles, pickNativeFiles, toggleExisting, removePending, patchPending } = files
const actions = computed(() => draft.value.status && draft.value.status !== '草稿' ? ['cancel', 'save'] as const : ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'] as const)
</script>

<template>
  <EntityFormShell :title="title" back-label="返回来源" :sections="[{ key: 'basic', label: '基本信息' }, { key: 'amount', label: '合同金额' }, { key: 'terms', label: '合同条款' }, { key: 'attachments', label: '附件与备注' }]" :state="loading ? 'loading' : loadError ? 'error' : 'ready'" :state-title="loadError" state-action-label="重新加载" @back="leave" @state-action="initialize">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent="save('save')">
      <p v-if="saveError" role="alert" class="rounded border border-danger/30 bg-danger/5 p-3 text-13px text-danger">
        {{ saveError }}；当前输入已保留，可重试。
      </p>
      <AuxiliaryContractFormFields :draft="draft" :errors="errors" :fetch-projects="fetchProjects" :fetch-suppliers="fetchSuppliers" @patch="patch" />
      <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :desktop-picker="desktopAttachmentPicker" :note="draft.note ?? ''" @files="handleFiles" @pick-native="pickNativeFiles" @toggle-existing="toggleExisting" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patch({ note: $event })" />
      <FormFooter v-model="closeAfterSave" :actions="[...actions]" :dirty="dirty" close-after-save :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
