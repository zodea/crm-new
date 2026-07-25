<script setup lang="ts">
import type {
  CompanyExpenseContractFormDraft,
  ContractAttachmentOwnerType,
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
  ExpenditureSettlementFormDraft,
  F2FormKind,
  F2SaveAction,
  ProjectContractFormDraft,
} from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import { isTauri } from '@tauri-apps/api/core'
import { onBeforeRouteLeave } from 'vue-router'
import {
  listContractFormAttachments,
  loadContractSupplementForm,
  loadF2Form,
} from '~/lib/contract/forms'
import {
  F2_FORM_META,
  f2FormDefaults,
  formPath,
} from '~/lib/contract/page'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

type PageDraft
  = ProjectContractFormDraft
    & CompanyExpenseContractFormDraft
    & ExpenditureSettlementFormDraft

interface PendingAttachment extends ContractFormAttachmentDraft {
  localId: string
}

const props = defineProps<{
  kind: F2FormKind
}>()

const route = useRoute()
const contractStore = useContractStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => F2_FORM_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})
const isSupplementRoute = computed(() => route.query.supplement === '1')
const isEditing = computed(() => Boolean(routeId.value))
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() =>
  `${isEditing.value ? '编辑' : '新建'} · ${meta.value.label}`,
)
useTabTitle(title)

const draft = ref<PageDraft>(f2FormDefaults(props.kind) as PageDraft)
const attachments = shallowRef<ContractFormAttachment[]>([])
const pendingAttachments = shallowRef<PendingAttachment[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const pendingRestoreIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const desktopAttachmentPicker = shallowRef(false)
let allowLeave = false

const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0,
)

const sections = computed(() => {
  if (!draft.value.isSupplement)
    return meta.value.sections
  return meta.value.sections.filter(section =>
    ['basic', 'amount', 'attachments'].includes(section.key),
  )
})

const aggregate = computed(() => {
  if (!draft.value.id || draft.value.isSupplement)
    return null
  const contract = contractStore.byId(draft.value.id)
  if (!contract)
    return null
  return {
    changed: contract.changed,
    settled: contract.settled,
    invoiced: contract.invoiced,
    paid: contract.paid,
  }
})

const selectedContractAmount = computed(() => {
  if (!draft.value.contractId)
    return null
  return contractStore.byId(draft.value.contractId)?.amount ?? null
})

function kindName(kind: F2FormKind): string {
  const values: Partial<Record<F2FormKind, string>> = {
    construction: '施工',
    subcontract: '分包',
    material: '材采',
    other_expense: '其他支出',
  }
  return values[kind] ?? ''
}

async function lookup(
  table: 'projects' | 'customers' | 'suppliers',
  keyword: string,
): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
    [pattern],
  )
  return rows.map(row => ({ id: row.id, label: row.name }))
}

const fetchProjects = (keyword: string) => lookup('projects', keyword)
const fetchCustomers = (keyword: string) => lookup('customers', keyword)
const fetchSuppliers = (keyword: string) => lookup('suppliers', keyword)

async function fetchOriginalContracts(keyword: string): Promise<LookupOption[]> {
  const rows = await select<{
    id: string
    name: string
    no: string
  }>(selectVisibleSql('contracts', `
      AND kind = ?
      AND (name LIKE ? OR no LIKE ?)
    ORDER BY sign_date DESC, created_at DESC
    LIMIT 50
  `), [kindName(props.kind), `%${keyword.trim()}%`, `%${keyword.trim()}%`])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: row.no,
  }))
}

async function fetchOtherExpenseContracts(keyword: string): Promise<LookupOption[]> {
  if (!draft.value.projectId)
    return []
  const rows = await select<{
    id: string
    name: string
    no: string
    amount: number
  }>(selectVisibleSql('contracts', `
      AND kind = '其他支出'
      AND project_id = ?
      AND (name LIKE ? OR no LIKE ?)
    ORDER BY sign_date DESC, created_at DESC
    LIMIT 50
  `), [
    draft.value.projectId,
    `%${keyword.trim()}%`,
    `%${keyword.trim()}%`,
  ])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no} · ${Number(row.amount).toFixed(2)}`,
  }))
}

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
  try {
    await contractStore.load()
    const id = routeId.value
    if (!id) {
      draft.value = f2FormDefaults(props.kind) as PageDraft
      attachments.value = []
    }
    else {
      const recordPromise = isSupplementRoute.value
        ? loadContractSupplementForm(id)
        : loadF2Form(props.kind, id)
      const ownerType: ContractAttachmentOwnerType = isSupplementRoute.value
        ? 'contract_supplement'
        : props.kind === 'company_expense'
          ? 'company_expense_contract'
          : props.kind === 'other_settlement'
            ? 'expenditure_settlement'
            : 'contract'
      const [record, files] = await Promise.all([
        recordPromise,
        listContractFormAttachments(ownerType, id, true),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...f2FormDefaults(props.kind),
        ...record,
      } as PageDraft
      attachments.value = files
    }
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  catch (cause) {
    error(`载入失败：${toErrorMessage(cause)}`)
  }
  finally {
    loading.value = false
  }
}

function patchDraft(patch: Partial<PageDraft>) {
  const next = { ...draft.value, ...patch }
  if ('projectId' in patch && props.kind === 'other_settlement')
    next.contractId = null
  draft.value = next
}

function clearFieldError(field: string) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function validateRequired(): boolean {
  const errors: Record<string, string> = {}
  const required: Array<[keyof PageDraft, string]> = []
  if (['construction', 'subcontract', 'material', 'other_expense'].includes(props.kind)) {
    if (draft.value.isSupplement) {
      required.push(
        ['originalContractId', '原合同'],
        ['name', '协议名称'],
        ['content', '协议内容'],
        ['signDate', '签约日期'],
      )
    }
    else {
      required.push(
        ['name', '合同名称'],
        ['projectId', '项目'],
        [props.kind === 'construction' ? 'customerId' : 'supplierId', props.kind === 'construction' ? '甲方客户' : '乙方分供方'],
        ['content', '合同内容简述'],
        ['signDate', '签约日期'],
      )
    }
  }
  else if (props.kind === 'company_expense') {
    required.push(
      ['name', '合同名称'],
      ['counterparty', '对方单位'],
      ['signDate', '签订日期'],
    )
  }
  else {
    required.push(
      ['name', '结算名称'],
      ['projectId', '项目'],
      ['contractId', '其他支出合同'],
      ['settlementDate', '结算日期'],
    )
  }

  for (const [field, label] of required) {
    const value = draft.value[field]
    if (typeof value === 'string' ? !value.trim() : value == null)
      errors[String(field)] = `${label}为必填项`
  }
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
  return messages.length === 0
}

function attachmentChanges(): ContractFormAttachmentChanges {
  return {
    add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
    removeIds: pendingRemoveIds.value,
    restoreIds: pendingRestoreIds.value,
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToList()
    return
  }
  const saveAction: F2SaveAction
    = action === 'draft'
      ? 'draft'
      : action === 'saveSubmit'
        ? 'submit'
        : 'save'
  if (saveAction !== 'draft' && !validateRequired())
    return

  loadingAction.value = action
  try {
    const result = await contractStore.saveForm(
      props.kind,
      draft.value,
      saveAction,
      attachmentChanges(),
    )
    success(saveAction === 'draft' ? '草稿已保存' : saveAction === 'submit' ? '已保存并提交' : '保存成功')
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
    fieldErrors.value = {}

    if (action === 'saveNew') {
      allowLeave = true
      if (routeId.value)
        await navigateTo(meta.value.newPath, { replace: true })
      draft.value = f2FormDefaults(props.kind) as PageDraft
      attachments.value = []
      await nextTick()
      savedSnapshot.value = JSON.stringify(draft.value)
      allowLeave = false
      return
    }
    if (closeAfterSave.value) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(meta.value.listPath)
      return
    }

    allowLeave = true
    const target = {
      path: formPath(props.kind, result.id),
      query: draft.value.isSupplement ? { supplement: '1' } : {},
    }
    await navigateTo(target, { replace: true })
    await initialize()
    allowLeave = false
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

function appendPendingAttachments(files: ContractFormAttachmentDraft[]) {
  pendingAttachments.value = [
    ...pendingAttachments.value,
    ...files.map((file, index) => ({
      ...file,
      localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
      category: file.category || '合同附件',
    })),
  ]
}

function handleFiles(files: File[]) {
  appendPendingAttachments(files.map(file => ({
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  })))
}

async function pickNativeFiles() {
  try {
    const [{ open }, { stat }, { basename }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ])
    const selected = await open({ multiple: true, directory: false })
    const paths = selected == null
      ? []
      : Array.isArray(selected) ? selected : [selected]
    const files = await Promise.all(paths.map(async filePath => ({
      fileName: await basename(filePath),
      filePath,
      fileSize: (await stat(filePath)).size,
    })))
    appendPendingAttachments(files)
  }
  catch (cause) {
    error(`选择附件失败：${toErrorMessage(cause)}`)
  }
}

function removePending(localId: string) {
  pendingAttachments.value = pendingAttachments.value.filter(file => file.localId !== localId)
}

function patchPending(
  localId: string,
  patch: Partial<PendingAttachment>,
) {
  pendingAttachments.value = pendingAttachments.value.map(file =>
    file.localId === localId ? { ...file, ...patch } : file,
  )
}

function toggleExistingAttachment(id: string) {
  const attachment = attachments.value.find(file => file.id === id)
  if (attachment?.deletedAt) {
    pendingRestoreIds.value = pendingRestoreIds.value.includes(id)
      ? pendingRestoreIds.value.filter(item => item !== id)
      : [...pendingRestoreIds.value, id]
    return
  }
  pendingRemoveIds.value = pendingRemoveIds.value.includes(id)
    ? pendingRemoveIds.value.filter(item => item !== id)
    : [...pendingRemoveIds.value, id]
}

async function leaveToList() {
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认放弃并返回列表？',
      confirmLabel: '放弃修改',
    })
    if (!leave)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(meta.value.listPath)
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  if (tabsStore.tabs.some(tab => tab.key === pageKey))
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  if (!leave)
    tabsStore.open({ fullPath: pageFullPath, title: title.value })
  return leave
})

onMounted(() => {
  desktopAttachmentPicker.value = isTauri()
  void initialize()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      v-if="sections.length >= 3"
      class="sticky top-4 hidden w-44 shrink-0 rounded-[var(--radius-card)] border border-line bg-panel p-2 xl:block"
      aria-label="表单分区"
    >
      <a
        v-for="section in sections"
        :key="section.key"
        :href="`#section-${section.key}`"
        class="block rounded-[var(--radius-control)] px-3 py-2 text-12px text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-deep"
      >
        {{ section.label }}
      </a>
    </aside>

    <main class="min-w-0 flex-1">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            class="mb-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep"
            @click="leaveToList"
          >
            <span class="i-lucide-arrow-left" aria-hidden="true" />
            返回{{ meta.listLabel }}
          </button>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            {{ meta.subtitle }}；草稿允许缺项，提交时校验真实关联与金额勾稽。
          </p>
        </div>
        <span v-if="draft.status" class="chip bg-surface-3 text-ink-soft">
          {{ draft.status }}
        </span>
      </header>

      <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent>
        <ContractFormFields
          :kind="kind"
          :editing="isEditing"
          :draft="draft"
          :field-errors="fieldErrors"
          :fetch-projects="fetchProjects"
          :fetch-customers="fetchCustomers"
          :fetch-suppliers="fetchSuppliers"
          :fetch-original-contracts="fetchOriginalContracts"
          :fetch-other-expense-contracts="fetchOtherExpenseContracts"
          :aggregate="aggregate"
          :selected-contract-amount="selectedContractAmount"
          @patch="patchDraft"
          @clear-error="clearFieldError"
        />

        <ContractLineItemsEditor
          v-if="kind === 'material' && !draft.isSupplement"
          :lines="draft.lineItems ?? []"
          @update="patchDraft({ lineItems: $event })"
        />

        <ContractAttachmentSection
          :attachments="attachments"
          :pending-attachments="pendingAttachments"
          :pending-remove-ids="pendingRemoveIds"
          :pending-restore-ids="pendingRestoreIds"
          :desktop-picker="desktopAttachmentPicker"
          :note="draft.note ?? ''"
          @pick-native="pickNativeFiles"
          @files="handleFiles"
          @toggle-existing="toggleExistingAttachment"
          @remove-pending="removePending"
          @patch-pending="patchPending"
          @update-note="patchDraft({ note: $event })"
        />

        <FormFooter
          v-model="closeAfterSave"
          :dirty="dirty"
          close-after-save
          :loading-action="loadingAction"
          @action="handleFooterAction"
        />
      </form>
    </main>
  </div>
</template>
