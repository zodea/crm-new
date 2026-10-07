<script setup lang="ts">
import type { AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'

const props = defineProps<{ kind: AuxiliaryContractKind }>()
const { draft, title, files, errors, loading, loadError, saveError, loadingAction, closeAfterSave, dirty, initialize, save, leave, patch, pending, pendingCommandId, recover, constructionMain, selectMain, fetchMains, fetchSignatories, selectSignatory, fetchProjects, fetchSuppliers } = useAuxiliaryContractForm(() => props.kind)
const { attachments, pendingAttachments, pendingRemoveIds, pendingRestoreIds, desktopAttachmentPicker, handleFiles, pickNativeFiles, toggleExisting, removePending, patchPending } = files
const actions = computed(() => draft.value.status && draft.value.status !== '草稿' ? ['cancel', 'save'] as const : ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'] as const)
</script>

<template>
  <EntityFormShell :title="title" back-label="返回来源" :sections="[{ key: 'basic', label: '基本信息' }, { key: 'amount', label: '合同金额' }, { key: 'terms', label: '合同条款' }, { key: 'attachments', label: '附件与备注' }]" :state="loading ? 'loading' : loadError ? 'error' : 'ready'" :state-title="loadError" state-action-label="重新加载" @back="leave" @state-action="initialize">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent="save('save')">
      <p v-if="saveError" role="alert" class="rounded border border-danger/30 bg-danger/5 p-3 text-13px text-danger">
        {{ saveError }}；当前输入及原提交编号已保留。
      </p>
      <div v-if="pending" role="status" class="panel flex min-w-0 flex-wrap items-center gap-3 p-3">
        <span class="min-w-0 break-all text-12px">原提交编号：{{ pendingCommandId }}。先核对结果，已保存时只重试读取。</span>
        <KitButton :disabled="Boolean(loadingAction)" @click="recover">
          核对原提交结果
        </KitButton>
      </div>
      <fieldset :disabled="pending || Boolean(loadingAction)" class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <AuxiliaryContractFormFields :draft="draft" :errors="errors" :fetch-projects="fetchProjects" :fetch-suppliers="fetchSuppliers" :construction-main="constructionMain" :fetch-mains="fetchMains" :fetch-signatories="fetchSignatories" @patch="patch" @select-main="selectMain" @select-signatory="selectSignatory" />
        <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :desktop-picker="desktopAttachmentPicker" :note="draft.note ?? ''" @files="handleFiles" @pick-native="pickNativeFiles" @toggle-existing="toggleExisting" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patch({ note: $event })" />
      </fieldset>
      <FormFooter v-model="closeAfterSave" :actions="[...actions]" :dirty="dirty" close-after-save :loading-action="loadingAction" :write-disabled="pending || files.readingFiles.value" @action="save" />
    </form>
  </EntityFormShell>
</template>
