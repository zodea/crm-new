<script setup lang="ts">
import type { PendingFileRef } from '~/components/shared/FileRefAttachmentSection.vue'
import type { FileRefRecord } from '~/lib/forms/file-refs'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { ReceiptContext, ReceiptDraft } from '~/lib/receipt/contract'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { ReceiptCommandConflict } from '~/lib/receipt/command-session'
import { emptyReceiptDraft } from '~/lib/receipt/contract'
import { validateReceiptDraft } from '~/lib/receipt/domain'
import { receiptProblemFromUnknown } from '~/lib/receipt/repository'
import { receiptFormPath, validateReceiptReturnTo } from '~/lib/receipt/return-context'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { useReceiptCommandStore } from '~/stores/receipt-command'
import ReceiptContractSummary from './ReceiptContractSummary.vue'
import ReceiptFormFields from './ReceiptFormFields.vue'

const route = useRoute()
const initialId = typeof route.params.id === 'string' ? route.params.id : null
const pagePath = route.path
const pageKey = deriveKey(route.fullPath)
const returnTo = shallowRef(validateReceiptReturnTo(route.query.returnTo, 'real') ?? '/finance/receipt')
const store = useReceiptCommandStore()
const tabs = useTabsStore()
const kit = useKitUI()
const session = reactive(store.createSession())
const draft = ref<ReceiptDraft>(emptyReceiptDraft())
const context = shallowRef<ReceiptContext | null>(null)
const attachments = shallowRef<FileRefRecord[]>([])
const pending = ref<PendingFileRef[]>([])
const removeIds = ref<string[]>([])
const restoreIds = ref<string[]>([])
const savedSnapshot = shallowRef('')
const fieldErrors = shallowRef<Record<string, string[]>>({})
const loadError = shallowRef('')
const saveError = shallowRef('')
const conflict = shallowRef<ReceiptCommandConflict | null>(null)
const loading = shallowRef(true)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const readingFiles = shallowRef(false)
const closeAfter = ref(true)
const initialized = shallowRef(false)
const formRef = useTemplateRef<HTMLFormElement>('formRef')
const title = computed(() => `${session.targetId || initialId ? '编辑' : '新建'} · 收款登记`)
const dirty = computed(() => initialized.value && (JSON.stringify(draft.value) !== savedSnapshot.value || pending.value.length > 0 || removeIds.value.length > 0 || restoreIds.value.length > 0))
const writable = computed(() => session.canWrite && !loading.value && !readingFiles.value && !loadError.value)
const footerActions = computed<FormFooterAction[]>(() => writable.value ? ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'] : ['cancel'])
let allowLeave = false
let fileGeneration = 0
let activated = false
let formActive = true
let readGeneration = 0
let resumeFailed = false
useTabTitle(title)

function syncRouteContext() {
  if (!formActive || route.path !== pagePath)
    return false
  returnTo.value = validateReceiptReturnTo(route.query.returnTo, 'real') ?? '/finance/receipt'
  if (route.query.origin != null && route.query.origin !== 'real') {
    session.generation++
    session.canWrite = false
    context.value = null
    loadError.value = '当前来源不可编辑'
    loading.value = false
    return false
  }
  return true
}

function clearAttachments() {
  pending.value = []
  removeIds.value = []
  restoreIds.value = []
  fileGeneration++
  readingFiles.value = false
}
async function initialize(id = session.targetId ?? initialId) {
  const current = ++readGeneration
  if (!syncRouteContext()) {
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const value = await store.hydrate(session, id)
    if (!value || current !== readGeneration)
      return
    context.value = value.context
    draft.value = value.detail?.record.draft ?? emptyReceiptDraft()
    attachments.value = value.detail?.record.attachments ?? []
    clearAttachments()
    savedSnapshot.value = JSON.stringify(draft.value)
    initialized.value = true
    fieldErrors.value = {}
    saveError.value = ''
    conflict.value = null
    resumeFailed = false
  }
  catch (cause) {
    if (current === readGeneration)
      loadError.value = receiptProblemFromUnknown(cause).problem.message
  }
  finally {
    if (current === readGeneration)
      loading.value = false
  }
}
async function resume() {
  const current = ++readGeneration
  if (!syncRouteContext())
    return
  loading.value = true
  loadError.value = ''
  try {
    const value = await store.revalidate(session)
    if (!value || current !== readGeneration)
      return
    context.value = value.context
    resumeFailed = false
  }
  catch (cause) {
    if (current === readGeneration) {
      resumeFailed = true
      loadError.value = receiptProblemFromUnknown(cause).problem.message
    }
  }
  finally {
    if (current === readGeneration)
      loading.value = false
  }
}
function patch(value: Partial<ReceiptDraft>) {
  draft.value = { ...draft.value, ...value }
  const errors = { ...fieldErrors.value }
  for (const key of Object.keys(value)) delete errors[key]
  fieldErrors.value = errors
}
async function selectFiles(files: File[]) {
  if (!writable.value)
    return
  const generation = ++fileGeneration
  readingFiles.value = true
  try {
    const additions = await Promise.all(files.map(async file => ({ ...await fileRefDraftFromFile(file), localId: crypto.randomUUID() })))
    if (generation === fileGeneration)
      pending.value.push(...additions)
  }
  catch (cause) {
    if (generation === fileGeneration)
      kit.error(`附件读取失败：${cause instanceof Error ? cause.message : '请重新选择'}`)
  }
  finally {
    if (generation === fileGeneration)
      readingFiles.value = false
  }
}
function toggleFile(id: string) {
  const file = attachments.value.find(row => row.id === id)
  if (!file)
    return
  const selected = file.deletedAt ? restoreIds : removeIds
  selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]
}
async function mayLeave() {
  if (allowLeave || !dirty.value)
    return true
  return kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前收款还有未保存内容，确认放弃？', confirmLabel: '放弃修改' })
}
async function leave() {
  if (!await mayLeave())
    return
  allowLeave = true
  tabs.close(pageKey)
  await navigateTo(returnTo.value)
}
async function reload() {
  if (resumeFailed)
    return resume()
  if (dirty.value && !await kit.confirm({ variant: 'simple', title: '重新读取收款', message: '重新读取将替换本页未保存资料和附件变更，是否继续？', confirmLabel: '读取最新版' }))
    return
  await initialize()
}
function keepLocalChanges() {
  const latest = conflict.value?.latest
  if (!latest)
    return
  try {
    store.adoptConflictVersion(session, latest)
    attachments.value = latest.record.attachments
    conflict.value = null
    saveError.value = ''
    kit.success('已采用服务器版本，本页输入仍保留；请核对后再次保存')
  }
  catch (cause) { saveError.value = receiptProblemFromUnknown(cause).problem.message }
}
async function save(action: FormFooterAction) {
  if (action === 'cancel')
    return leave()
  if (!writable.value || loadingAction.value || !context.value)
    return
  const saveAction = action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save'
  try {
    const amount = draft.value.amount?.trim() ?? null
    const normalized = amount && /^\d+(?:\.\d{0,2})?$/.test(amount)
      ? `${amount.split('.')[0]}.${(amount.split('.')[1] ?? '').padEnd(2, '0')}`
      : amount
    const validated = validateReceiptDraft({ ...draft.value, amount: normalized === '' ? null : normalized }, saveAction, context.value)
    loadingAction.value = action
    saveError.value = ''
    const result = await store.saveForm(session, validated, saveAction, { add: pending.value.map(({ localId: _localId, ...file }) => file), removeIds: removeIds.value, restoreIds: restoreIds.value })
    savedSnapshot.value = JSON.stringify(draft.value)
    clearAttachments()
    kit.success(saveAction === 'draft' ? '草稿已保存' : saveAction === 'submit' ? '收款已保存并提交' : '收款已保存')
    if (!formActive)
      return
    if (action === 'saveNew') {
      allowLeave = true
      if (initialId)
        await navigateTo(receiptFormPath(null, returnTo.value), { replace: true })
      else await initialize(null)
      allowLeave = false
    }
    else if (closeAfter.value && (action === 'save' || action === 'saveSubmit')) {
      allowLeave = true
      tabs.close(pageKey)
      await navigateTo(returnTo.value)
    }
    else {
      // 保存结果已经确认。重读失败只阻止继续编辑，不重发刚成功的命令。
      if (!initialId) {
        allowLeave = true
        await navigateTo(receiptFormPath(result.id, returnTo.value), { replace: true })
      }
      else {
        await initialize(result.id)
      }
    }
  }
  catch (cause) {
    conflict.value = cause instanceof ReceiptCommandConflict ? cause : null
    const problem = receiptProblemFromUnknown(cause).problem
    fieldErrors.value = problem.fieldErrors
    saveError.value = problem.message
    if (problem.code === 'forbidden')
      session.canWrite = false
    if (conflict.value?.latest && !conflict.value.latest.capabilities.includes('receipt:write'))
      session.canWrite = false
    kit.error(problem.message)
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }
  finally { loadingAction.value = null }
}
useTabCloseGuard(mayLeave)
watch([() => route.query.origin, () => route.query.returnTo], ([origin], [previousOrigin]) => {
  if (!formActive || route.path !== pagePath)
    return
  returnTo.value = validateReceiptReturnTo(route.query.returnTo, 'real') ?? '/finance/receipt'
  if (origin !== previousOrigin)
    void (dirty.value ? resume() : initialize())
}, { flush: 'sync' })
onMounted(() => {
  void initialize()
})
onActivated(() => {
  formActive = true
  allowLeave = false
  if (activated && !loadingAction.value)
    void (dirty.value ? resume() : initialize())
  activated = true
})
onDeactivated(() => {
  formActive = false
  readGeneration++
  if (!session.busy)
    session.generation++
})
onScopeDispose(() => {
  session.generation++
  fileGeneration++
})
</script>

<template>
  <EntityFormShell :title="title" subtitle="甲方客户向我方支付的收款登记" back-label="返回来源页面" :sections="[{ key: 'basic', label: '基本信息' }, { key: 'amount', label: '金额与方式' }, { key: 'contract', label: '合同情况' }, { key: 'attachments', label: '附件与备注' }]" :state="loading ? 'loading' : loadError ? 'error' : 'ready'" :state-description="loadError" state-action-label="重新读取" @back="leave" @state-action="reload">
    <template #status>
      <KitStatusTag :tone="financeStatusTone(draft.status)">
        {{ financeStatusLabel(draft.status) }}
      </KitStatusTag>
    </template>
    <form v-if="context" ref="formRef" class="grid min-w-0 gap-4" aria-label="收款登记表单" @submit.prevent>
      <StatePanel v-if="!session.canWrite" kind="forbidden" title="当前收款不可编辑" description="收款或关联记录的权限不足，请重新读取当前权限。" action-label="重新读取" compact @action="reload" />
      <StatePanel v-if="saveError" kind="error" title="收款尚未保存" :description="saveError" action-label="读取服务器最新版" compact @action="reload" />
      <section v-if="conflict" class="panel grid gap-3 p-4" aria-label="收款版本冲突">
        <p class="m-0 text-12px text-ink-soft">
          {{ conflict.latest ? `服务器版本 ${conflict.latest.record.version} 已读回。本页输入尚未覆盖服务器。` : '最新版本暂未读回，本页输入已保留，请重新读取后核对。' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <KitButton v-if="conflict.latest?.capabilities.includes('receipt:write')" @click="keepLocalChanges">
            保留我的内容，采用新版本
          </KitButton>
          <KitButton @click="reload">
            改用服务器最新版
          </KitButton>
        </div>
      </section>
      <ReceiptFormFields :draft="draft" :context="context" :field-errors="fieldErrors" :readonly="!writable || Boolean(loadingAction)" @patch="patch" />
      <ReceiptContractSummary :key="session.baseVersion ?? 'new'" :contract-id="draft.contractId" />
      <FileRefAttachmentSection :attachments="attachments" :pending-attachments="pending" :pending-remove-ids="removeIds" :pending-restore-ids="restoreIds" :desktop-picker="false" :note="draft.note" :readonly="!writable || Boolean(loadingAction)" picker-description="文件正文与收款一起保存，保存后可预览和下载" @files="selectFiles" @toggle-existing="toggleFile" @remove-pending="pending = pending.filter(file => file.localId !== $event)" @patch-pending="(id, value) => pending = pending.map(file => file.localId === id ? { ...file, ...value } : file)" @update-note="patch({ note: $event })" />
      <p v-if="readingFiles" role="status" class="text-12px text-ink-faint">
        正在读取附件正文，请稍候…
      </p>
      <FormFooter v-model="closeAfter" :actions="footerActions" :dirty="dirty" close-after-save :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
