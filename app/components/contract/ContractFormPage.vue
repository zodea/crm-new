<script setup lang="ts">
import type {
  CompanyExpenseContractFormDraft,
  ContractAttachmentOwnerType,
  ExpenditureSettlementFormDraft,
  F2FormKind,
  F2SaveAction,
  ProjectContractFormDraft,
} from '~/lib/contract/forms'
import type { FormFooterAction } from '~/lib/master-data/page'
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
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

type PageDraft
  = ProjectContractFormDraft
    & CompanyExpenseContractFormDraft
    & ExpenditureSettlementFormDraft

const props = defineProps<{
  kind: F2FormKind
}>()

const route = useRoute()
const contractStore = useContractStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  desktopAttachmentPicker,
  dirty: attachmentDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  handleFiles,
  pickNativeFiles,
  removePending,
  patchPending,
  toggleExisting: toggleExistingAttachment,
} = useContractFormAttachments()

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
const lineItemsEditor = useTemplateRef<{
  validate: () => { row: number, key: string }[]
}>('lineItemsEditor')
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadError = shallowRef('')
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = useState<boolean>(
  `contract-form-close-after-save:${props.kind}`,
  () => true,
)
const savedSnapshot = shallowRef('')
let allowLeave = false

const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || attachmentDirty.value,
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

const selectedContract = computed(() => {
  if (!draft.value.contractId)
    return null
  const contract = contractStore.byId(draft.value.contractId)
  if (!contract)
    return null
  return {
    projectName: contract.projectName,
    supplierName: contract.supplierName,
    amount: contract.amount,
    paid: contract.paid,
  }
})
const eligibleSettlementContractCount = computed(() => {
  if (
    !draft.value.projectId
    || (props.kind !== 'other_settlement' && props.kind !== 'material_settlement')
  ) {
    return null
  }
  const expectedKind = props.kind === 'material_settlement' ? '材采' : '其他支出'
  return contractStore.list
    .filter(contract =>
      String(contract.kind) === expectedKind
      && contract.projectId === draft.value.projectId
      && !['draft', '草稿'].includes(contract.status),
    )
    .length
})

const pageState = computed(() => {
  if (loading.value)
    return 'loading'
  return loadError.value ? 'error' : 'ready'
})

const fetchProjects = contractStore.searchProjects
const fetchCustomers = contractStore.searchCustomers
const fetchSuppliers = contractStore.searchSuppliers

function fetchOriginalContracts(keyword: string) {
  return contractStore.searchOriginalContracts(props.kind, keyword)
}

function fetchOtherExpenseContracts(keyword: string) {
  if (props.kind !== 'other_settlement' && props.kind !== 'material_settlement')
    return Promise.resolve([])
  return contractStore.searchSettlementContracts(
    props.kind,
    draft.value.projectId ?? null,
    keyword,
  )
}

async function initialize() {
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  resetAttachments()
  try {
    await contractStore.load()
    const id = routeId.value
    if (!id) {
      draft.value = f2FormDefaults(props.kind) as PageDraft
    }
    else {
      const recordPromise = isSupplementRoute.value
        ? loadContractSupplementForm(id)
        : loadF2Form(props.kind, id)
      const ownerType: ContractAttachmentOwnerType = isSupplementRoute.value
        ? 'contract_supplement'
        : props.kind === 'company_expense'
          ? 'company_expense_contract'
          : props.kind === 'other_settlement' || props.kind === 'material_settlement'
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
      resetAttachments(files)
    }
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  catch (cause) {
    loadError.value = toErrorMessage(cause)
    error(`载入失败：${loadError.value}`)
  }
  finally {
    loading.value = false
  }
}

function patchDraft(patch: Partial<PageDraft>) {
  const next = { ...draft.value, ...patch }
  if ('projectId' in patch && (props.kind === 'other_settlement' || props.kind === 'material_settlement'))
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
    const contractLabel = props.kind === 'material_settlement' ? '材料采购合同' : '其他支出合同'
    required.push(
      ['name', '结算名称'],
      ['projectId', '项目'],
      ['contractId', contractLabel],
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
  if (messages.length) {
    warning(`${messages[0]}（共 ${messages.length} 处）`)
    void nextTick(() => {
      document
        .querySelector<HTMLElement>('form [aria-invalid="true"]')
        ?.focus()
    })
  }
  return messages.length === 0
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
  if (saveAction !== 'draft' && props.kind === 'material') {
    const lineErrors = lineItemsEditor.value?.validate() ?? []
    if (lineErrors.length) {
      warning(`采购合同明细还有 ${lineErrors.length} 处必填项未填写`)
      await nextTick()
      document.querySelector<HTMLElement>(
        '#section-lines [aria-invalid="true"]',
      )?.focus()
      return
    }
  }

  loadingAction.value = action
  try {
    const result = await contractStore.saveForm(
      props.kind,
      draft.value,
      saveAction,
      attachmentChanges(),
    )
    success(saveAction === 'draft' ? '草稿已保存' : saveAction === 'submit' ? '已保存并提交' : '保存成功')
    clearPendingAttachments()
    fieldErrors.value = {}

    if (action === 'saveNew') {
      allowLeave = true
      if (routeId.value)
        await navigateTo(meta.value.newPath, { replace: true })
      draft.value = f2FormDefaults(props.kind) as PageDraft
      resetAttachments()
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

onMounted(() => void initialize())
</script>

<template>
  <EntityFormShell
    :title="title"
    :back-label="`返回${meta.listLabel}`"
    :sections="sections"
    :state="pageState"
    :state-title="pageState === 'error' ? '表单载入失败' : '正在载入表单'"
    :state-description="loadError ? `无法载入${meta.label}：${loadError}` : ''"
    state-action-label="重新载入"
    @back="leaveToList"
    @state-action="initialize"
  >
    <template #status>
      <span v-if="draft.status" class="chip bg-surface-3 text-ink-soft">
        {{ draft.status }}
      </span>
    </template>

    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
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
        :selected-contract="selectedContract"
        :eligible-settlement-contract-count="eligibleSettlementContractCount"
        @patch="patchDraft"
        @clear-error="clearFieldError"
      />

      <ContractLineItemsEditor
        v-if="kind === 'material' && !draft.isSupplement"
        ref="lineItemsEditor"
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
  </EntityFormShell>
</template>
