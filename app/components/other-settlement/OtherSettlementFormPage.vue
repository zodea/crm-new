<script setup lang="ts">
const { draft, context, title, files, loading, loadError, saveError, errors, loadingAction, closeAfterSave, dirty, selectedContract, fetchProjects, fetchContracts, patch, initialize, leave, save } = useOtherSettlementForm()
const { attachments, pendingAttachments, pendingRemoveIds, pendingRestoreIds, desktopAttachmentPicker, handleFiles, pickNativeFiles, toggleExisting, removePending, patchPending } = files
</script>

<template>
  <EntityFormShell :title="title" back-label="返回来源" :sections="[{ key: 'basic', label: '结算资料' }, { key: 'attachments', label: '附件与备注' }]" :state="loading ? 'loading' : loadError ? 'error' : 'ready'" :state-title="loadError" state-action-label="重新加载" @back="leave" @state-action="initialize">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent="save('save')">
      <p v-if="saveError" role="alert" class="rounded border border-danger/30 bg-danger/5 p-3 text-13px text-danger">
        {{ saveError }}；当前输入已保留，可重试。
      </p>
      <OtherSettlementFormFields :draft="draft" :errors="errors" :contract="selectedContract" :supplier-label="context?.suppliers.find(s => s.id === draft.supplierId)?.label" :fetch-projects="fetchProjects" :fetch-contracts="fetchContracts" @patch="patch" />
      <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :desktop-picker="desktopAttachmentPicker" :note="draft.note ?? ''" @files="handleFiles" @pick-native="pickNativeFiles" @toggle-existing="toggleExisting" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patch({ note: $event })" />
    </form>
    <template #footer>
      <FormFooter v-model="closeAfterSave" close-after-save :actions="draft.status === 'pending' ? ['cancel', 'saveNew', 'saveSubmit', 'save'] : ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save']" :labels="{ saveSubmit: draft.status === 'pending' ? '确认结算' : '保存并提交' }" :dirty="dirty" :loading-action="loadingAction" @action="save" />
    </template>
  </EntityFormShell>
</template>
