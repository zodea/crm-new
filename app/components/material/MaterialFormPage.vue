<script setup lang="ts">
import type { FormFooterAction } from '~/lib/master-data/page'
import type {
  MaterialFormDraft,
  MaterialFormKind,
  MaterialSaveAction,
} from '~/lib/material/forms'
import type {
  MaterialGridLine,
  MaterialPageDraft,
} from '~/lib/material/page'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import {
  listMaterialFormAttachments,
  loadMaterialForm,
  materialFormIsFinal,
  materialFormSupportsAttachments,
} from '~/lib/material/forms'
import {
  MATERIAL_FORM_META,
  materialFormDefaults,
  materialFormPath,
} from '~/lib/material/page'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: MaterialFormKind
}>()

const route = useRoute()
const materialStore = useMaterialStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  dirty: attachmentDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  handleFiles,
  toggleExisting: toggleExistingAttachment,
  removePending,
  patchPending,
} = useMaterialFormAttachments()

const meta = computed(() => MATERIAL_FORM_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})
const isEditing = computed(() => Boolean(routeId.value))
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

const draft = ref<MaterialPageDraft>(materialFormDefaults(props.kind))
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
let allowLeave = false

const supportsAttachments = computed(() => materialFormSupportsAttachments(props.kind))
const isFinal = computed(() => materialFormIsFinal(props.kind, draft.value.status))
const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || attachmentDirty.value,
)
const footerActions = computed<FormFooterAction[]>(() => {
  if (!isFinal.value)
    return ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save']
  return supportsAttachments.value ? ['cancel', 'save'] : ['cancel']
})
const showCloseAfterSave = computed(() =>
  footerActions.value.some(action => action === 'save' || action === 'saveSubmit'),
)
const footerLabels = computed(() => ({
  saveSubmit: meta.value.postLabel,
  ...(isFinal.value ? { save: '保存附件' } : {}),
}))

const fetchProjects = materialStore.searchProjects
const fetchCustomers = materialStore.searchCustomers
function fetchSuppliers(keyword: string) {
  return materialStore.searchSuppliers(
    keyword,
    props.kind === 'mat_arrival' ? draft.value.projectId ?? null : null,
  )
}
const fetchCrews = materialStore.searchCrews
function fetchContracts(keyword: string) {
  return materialStore.searchContracts(draft.value.projectId ?? null, keyword)
}

function fetchRequisitions(keyword: string) {
  return materialStore.searchRequisitions(draft.value.projectId ?? null, keyword)
}

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
  resetAttachments()
  try {
    const id = routeId.value
    if (!id) {
      draft.value = materialFormDefaults(props.kind)
      resetAttachments()
    }
    else {
      const [record, files] = await Promise.all([
        loadMaterialForm(props.kind, id),
        listMaterialFormAttachments(props.kind, id, true),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...materialFormDefaults(props.kind),
        ...record,
      } as MaterialPageDraft
      resetAttachments(files)
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

function patchDraft(patch: Partial<MaterialPageDraft>) {
  const next = { ...draft.value, ...patch }
  if ('projectId' in patch) {
    next.supplierId = null
    next.contractId = null
    next.requisitionId = null
  }
  else if ('supplierId' in patch) {
    next.contractId = null
  }
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
  const require = (field: string, label: string, positive = false) => {
    const value = draft.value[field]
    const missing = positive
      ? !(Number(value) > 0)
      : typeof value === 'string' ? !value.trim() : value == null
    if (missing)
      errors[field] = `${label}为必填项`
  }
  const requireMaterial = () => {
    require('materialName', '材料名称')
    require('unit', '单位')
  }
  switch (props.kind) {
    case 'mat_requisition':
      require('projectId', '项目')
      require('applicant', '申请人')
      require('requisitionDate', '下料日期')
      requireMaterial()
      require('plannedQty', '计划量', true)
      break
    case 'mat_arrival':
      require('projectId', '项目')
      require('supplierId', '分供方')
      require('warehouse', '仓库')
      require('arrivalDate', '到货日期')
      if (!draft.value.lines?.some(line => line.materialName?.trim() && Number(line.qty) > 0))
        errors.lines = '至少填写一条材料名称和数量有效的到货明细'
      break
    case 'mat_use':
      require('projectId', '项目')
      require('warehouse', '仓库')
      require('useDate', '领用日期')
      requireMaterial()
      require('qty', '领用数量', true)
      require('receiver', '领用人')
      break
    case 'stock_check':
      require('warehouse', '仓库')
      require('checker', '盘点人')
      require('checkDate', '盘点日期')
      if (!draft.value.lines?.some(line => line.materialName?.trim()))
        errors.lines = '至少填写一条盘点明细'
      break
    case 'owner_control':
      require('projectId', '项目')
      require('customerId', '甲供单位')
      requireMaterial()
      require('controlQty', '总控量', true)
      break
    case 'owner_requisition':
      require('projectId', '项目')
      require('applicant', '申请人')
      require('applicationDate', '申请日期')
      requireMaterial()
      require('plannedQty', '计划量', true)
      break
    case 'owner_arrival':
      require('projectId', '项目')
      require('warehouse', '仓库')
      require('arrivalDate', '到货日期')
      requireMaterial()
      require('qty', '到货数量', true)
      break
    case 'owner_use':
      require('projectId', '项目')
      require('useDate', '领用日期')
      requireMaterial()
      require('qty', '领用数量', true)
      require('receiver', '领用人')
      break
    case 'owner_direct':
      require('projectId', '项目')
      require('customerId', '甲供单位')
      require('transactionDate', '日期')
      requireMaterial()
      require('qty', '数量', true)
      require('useLocation', '使用部位')
      break
  }
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
  return messages.length === 0
}

async function saveFinalAttachments() {
  const id = routeId.value
  if (!id)
    return
  loadingAction.value = 'save'
  try {
    await materialStore.saveAttachments(props.kind, id, attachmentChanges())
    success('附件已保存')
    await initialize()
  }
  catch (cause) {
    error(`附件保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function persist(
  action: MaterialSaveAction,
  footerAction: FormFooterAction,
) {
  if (action === 'post' && !validateRequired())
    return
  if (action === 'post') {
    const accepted = await confirm({
      variant: 'simple',
      title: meta.value.postLabel.replace('保存并', ''),
      message: meta.value.postMessage,
      confirmLabel: meta.value.postLabel.replace('保存并', ''),
    })
    if (!accepted)
      return
  }
  loadingAction.value = footerAction
  try {
    const result = await materialStore.saveForm(
      props.kind,
      draft.value as MaterialFormDraft,
      action,
      attachmentChanges(),
    )
    success(action === 'post' ? `${meta.value.postLabel.replace('保存并', '')}成功` : action === 'draft' ? '草稿已保存' : '保存成功')
    clearPendingAttachments()
    fieldErrors.value = {}
    if (footerAction === 'saveNew') {
      allowLeave = true
      if (routeId.value)
        await navigateTo(`${meta.value.listPath}/new`, { replace: true })
      draft.value = materialFormDefaults(props.kind)
      resetAttachments()
      await nextTick()
      savedSnapshot.value = JSON.stringify(draft.value)
      allowLeave = false
      return
    }
    if (closeAfterSave.value && (footerAction === 'save' || footerAction === 'saveSubmit')) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(meta.value.listPath)
      return
    }
    allowLeave = true
    await navigateTo(materialFormPath(props.kind, result.id), { replace: true })
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

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToList()
    return
  }
  if (isFinal.value) {
    await saveFinalAttachments()
    return
  }
  const saveAction: MaterialSaveAction = action === 'draft'
    ? 'draft'
    : action === 'saveSubmit'
      ? 'post'
      : 'save'
  await persist(saveAction, action)
}

async function resolveBookQty(line: MaterialGridLine): Promise<number> {
  if (!draft.value.warehouse)
    return 0
  const summary = await materialStore.getMaterialStockSummary(
    draft.value.warehouse,
    line.materialName ?? '',
    line.spec ?? '',
    line.unit ?? '',
  )
  return summary.availableQty
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

useTabCloseGuard(async () => {
  if (allowLeave || !dirty.value)
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return leave
})

onMounted(() => void initialize())
</script>

<template>
  <EntityFormShell
    :title="title"
    :subtitle="meta.subtitle"
    :back-label="`返回${meta.label}`"
    :sections="meta.sections"
    :state="loading ? 'loading' : 'ready'"
    @back="leaveToList"
  >
    <template #status>
      <span v-if="draft.status" class="chip" :class="isFinal ? 'chip-ok' : 'chip-brand'">
        {{ isFinal ? '已生效' : '草稿' }}
      </span>
    </template>

    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <MaterialFormFields
        :kind="kind"
        :draft="draft"
        :field-errors="fieldErrors"
        :readonly="isFinal"
        :fetch-projects="fetchProjects"
        :fetch-customers="fetchCustomers"
        :fetch-suppliers="fetchSuppliers"
        :fetch-contracts="fetchContracts"
        :fetch-requisitions="fetchRequisitions"
        :fetch-crews="fetchCrews"
        @patch="patchDraft"
        @clear-error="clearFieldError"
      />

      <MaterialLineGrid
        v-if="kind === 'mat_arrival' || kind === 'stock_check'"
        :kind="kind"
        :lines="draft.lines ?? []"
        :readonly="isFinal"
        :resolve-book-qty="kind === 'stock_check' ? resolveBookQty : undefined"
        @update="patchDraft({ lines: $event })"
      />

      <FileRefAttachmentSection
        v-if="supportsAttachments"
        :attachments="attachments"
        :pending-attachments="pendingAttachments"
        :pending-remove-ids="pendingRemoveIds"
        :pending-restore-ids="pendingRestoreIds"
        :note="String(draft.note ?? '')"
        :note-readonly="isFinal"
        @files="handleFiles"
        @toggle-existing="toggleExistingAttachment"
        @remove-pending="removePending"
        @patch-pending="patchPending"
        @update-note="patchDraft({ note: $event })"
      />

      <section v-else id="section-note" class="panel scroll-mt-4 p-4">
        <SectionHeader title="备注" />
        <textarea
          :value="String(draft.note ?? '')"
          :disabled="isFinal"
          rows="4"
          class="field-input mt-3 w-full"
          @input="patchDraft({ note: ($event.target as HTMLTextAreaElement).value })"
        />
      </section>

      <FormFooter
        v-model="closeAfterSave"
        :actions="footerActions"
        :labels="footerLabels"
        :dirty="dirty"
        :close-after-save="showCloseAfterSave"
        :loading-action="loadingAction"
        @action="handleFooterAction"
      />
    </form>
  </EntityFormShell>
</template>
