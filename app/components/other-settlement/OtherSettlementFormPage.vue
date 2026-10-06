<script setup lang="ts">
import OtherSettlementClearanceBindingSection from './OtherSettlementClearanceBindingSection.vue'

const { draft, context, title, files, loading, loadError, saveError, errors, loadingAction, closeAfterSave, dirty, ordinaryDirty, bindingInput, expenseAllocations, saveClearanceLink, selectedContract, fetchProjects, fetchContracts, patch, initialize, leave, save, expenses, expenseError, reloadExpenses, session, recover, canSave, frozen, latestConflict, adoptLatest } = useOtherSettlementForm()
const { attachments, pendingAttachments, pendingRemoveIds, pendingRestoreIds, desktopAttachmentPicker, handleFiles, pickNativeFiles, toggleExisting, removePending, patchPending } = files
</script>

<template>
  <EntityFormShell :title="title" back-label="返回来源" :sections="[{ key: 'basic', label: '结算资料' }, { key: 'attachments', label: '附件与备注' }]" :state="loading ? 'loading' : loadError ? 'error' : 'ready'" :state-title="loadError" state-action-label="重新加载" @back="leave" @state-action="initialize(true)">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent="save('save')">
      <p v-if="frozen" role="status" class="rounded border border-line p-3 text-13px">
        原提交已确认并冻结；后来的输入仍保留，本页不能继续改写已确认结算。
      </p>
      <p v-if="saveError" role="alert" class="rounded border border-danger/30 bg-danger/5 p-3 text-13px text-danger">
        {{ saveError }}；当前输入已保留，可重试。
      </p>
      <div v-if="session.pending" role="status" class="rounded border border-line bg-surface-2 p-3 text-13px">
        <p class="m-0 break-all">
          {{ session.pending.result ? '已保存待刷新，只重试读取' : '提交结果未知，请先核对原编号' }} · {{ session.pending.id }}
        </p>
        <KitButton class="mt-2" :disabled="session.busy" @click="recover">
          核对原提交
        </KitButton>
      </div>
      <div v-if="latestConflict" class="rounded border border-line p-3 text-13px">
        <p>服务器版本 {{ latestConflict.version }}；当前输入已保留。</p><KitButton :disabled="Boolean(session.pending)" @click="adoptLatest">
          核对后采用最新版本
        </KitButton>
      </div>
      <fieldset :disabled="frozen" class="m-0 min-w-0 border-0 p-0">
        <OtherSettlementFormFields :draft="draft" :errors="errors" :contract="selectedContract" :supplier-label="context?.suppliers.find(s => s.id === draft.supplierId)?.label" :fetch-projects="fetchProjects" :fetch-contracts="fetchContracts" :expenses="expenses" :expense-error="expenseError" @patch="patch" @reload-expenses="reloadExpenses" />
      </fieldset>
      <OtherSettlementClearanceBindingSection v-if="!loadError && !draft.contractId" v-model="bindingInput" :draft="draft" :expenses="expenses" :targets="expenseAllocations" :confirmed="frozen" :disabled="session.busy || !!session.pending || loading || !context?.capabilities.includes('other-settlement:write')" :unsaved="ordinaryDirty" @patch="patch" @link="saveClearanceLink" />
      <fieldset :disabled="frozen" class="m-0 min-w-0 border-0 p-0">
        <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :desktop-picker="desktopAttachmentPicker" :note="draft.note ?? ''" @files="handleFiles" @pick-native="pickNativeFiles" @toggle-existing="toggleExisting" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patch({ note: $event })" />
      </fieldset>
    </form>
    <template #footer>
      <FormFooter v-model="closeAfterSave" close-after-save :write-disabled="!canSave" :actions="draft.status === 'pending' ? ['cancel', 'saveNew', 'saveSubmit', 'save'] : ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save']" :labels="{ saveSubmit: draft.status === 'pending' ? '确认结算' : '保存并提交' }" :dirty="dirty" :loading-action="loadingAction" @action="save" />
    </template>
  </EntityFormShell>
</template>
