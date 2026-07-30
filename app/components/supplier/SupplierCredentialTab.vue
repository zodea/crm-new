<script setup lang="ts">
import type { FileRefRecord } from '~/lib/forms/file-refs'
import type { OcrRecognitionResult } from '~/lib/recognize/engine'
import type {
  CredentialOcrFieldKey,
  CredentialOcrReviewField,
  ParsedCredentialOcr,
} from '~/lib/supplier/credential-ocr'
import type {
  SupplierCredentialCategory,
  SupplierCredentialRequirement,
} from '~/lib/supplier/detail'
import type { Supplier } from '~/stores/supplier'
import type { SupplierCredential, SupplierDetailSnapshot } from '~/stores/supplier-detail'
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue'
import { fileRefDraftFromFile, loadFileRefContent } from '~/lib/forms/file-refs'
import { recognizeDocument } from '~/lib/recognize/engine'
import { assertSupplierCredentialUpload } from '~/lib/supplier/credential-files'
import {
  buildCredentialOcrReview,
  parseCredentialOcr,
} from '~/lib/supplier/credential-ocr'
import {
  credentialExpiryState,
  defaultCredentialRequirement,
  REQUIRED_SUPPLIER_CREDENTIALS,
  shanghaiBusinessDate,
  SUPPLIER_CREDENTIAL_CATEGORIES,
} from '~/lib/supplier/detail'
import { CREDENTIAL_STATUS_LABEL } from '~/lib/supplier/status'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
import { toErrorMessage } from '~/lib/util/error'
import SupplierCredentialOcrReview from './SupplierCredentialOcrReview.vue'

const props = defineProps<{
  supplierId: string
  snapshot: SupplierDetailSnapshot
}>()

interface ActiveOcrReview {
  credentialId: string
  fileName: string
  rawResult: Awaited<ReturnType<typeof recognizeDocument>>
  parsed: ParsedCredentialOcr
  fields: CredentialOcrReviewField[]
  currentCategory: SupplierCredentialCategory
  currentLongTerm: boolean
  recognizedLongTerm: boolean | null
}

interface PendingOcrFile {
  credentialId: string
  file: File
}

const detailStore = useSupplierDetailStore()
const supplierStore = useSupplierStore()
const { confirm, formModal, undoToast, success, warning, error } = useKitUI()
const { preview, download } = useFileRefAccess()

const fileInput = useTemplateRef<HTMLInputElement>('credentialFileInput')
const uploadButton = useTemplateRef<HTMLButtonElement>('uploadButton')
const uploadCategory = shallowRef<SupplierCredentialCategory>('营业执照')
const uploading = shallowRef(false)
const recognizingId = shallowRef('')
const recognitionProgress = shallowRef(0)
const activeOcrReview = shallowRef<ActiveOcrReview | null>(null)
const pendingOcrFiles = shallowRef<PendingOcrFile[]>([])
const ocrReturnFocusElement = shallowRef<HTMLElement | null>(null)

const supplier = computed(() => supplierStore.byId(props.supplierId))
const credentials = computed(() => [...props.snapshot.credentials])
const requirementCategories = computed(() =>
  SUPPLIER_CREDENTIAL_CATEGORIES.filter(category =>
    REQUIRED_SUPPLIER_CREDENTIALS.includes(category)
    || ['签约代表身份证', '资质证书', '品牌授权书'].includes(category),
  ),
)
const missingRequired = computed(() =>
  requirementCategories.value.filter((category) => {
    if (effectiveRequirement(category) !== 'required')
      return false
    return !credentials.value.some(credential =>
      credential.category === category
      && credential.hasAccessibleFile
      && credentialExpiryState(credential) !== 'expired',
    )
  }),
)

function effectiveRequirement(category: SupplierCredentialCategory): SupplierCredentialRequirement {
  return props.snapshot.requirements.find(item => item.category === category)?.requirement
    ?? defaultCredentialRequirement(category)
}

function requirementReason(category: SupplierCredentialCategory): string {
  return props.snapshot.requirements.find(item => item.category === category)?.reason ?? ''
}

function requirementLabel(requirement: SupplierCredentialRequirement): string {
  return {
    required: '需提供',
    optional: '可选',
    not_applicable: '不适用',
  }[requirement]
}

function formatDateTime(value: string | null): string {
  return formatShanghaiDateTime(value)
}

function fileRefFor(credential: SupplierCredential): FileRefRecord | null {
  return credential.fileRef
}

function showMutationError(prefix: string, cause: unknown) {
  const message = toErrorMessage(cause)
  error(message.startsWith('数据已保存') ? message : `${prefix}：${message}`)
}

function openFilePicker() {
  fileInput.value?.click()
}

async function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files ?? [])]
  input.value = ''
  if (!selected.length)
    return

  uploading.value = true
  try {
    await Promise.all(selected.map(assertSupplierCredentialUpload))
    const drafts = await Promise.all(selected.map(file =>
      fileRefDraftFromFile(file, {
        category: uploadCategory.value,
        uploader: '当前用户',
      }),
    ))
    const ids = await detailStore.addCredentials({
      supplierId: props.supplierId,
      category: uploadCategory.value,
      files: drafts,
    })
    success(`已保存 ${ids.length} 份真实证照文件`)
    pendingOcrFiles.value = ids.flatMap((credentialId, index) => {
      const file = selected[index]
      return file ? [{ credentialId, file }] : []
    })
    ocrReturnFocusElement.value = uploadButton.value
    await recognizeNextUploadedFile()
    await restoreOcrTriggerFocus()
  }
  catch (cause) {
    showMutationError('证照上传失败', cause)
  }
  finally {
    uploading.value = false
  }
}

async function restoreOcrTriggerFocus() {
  await nextTick()
  if (activeOcrReview.value)
    return
  const target = ocrReturnFocusElement.value
  ocrReturnFocusElement.value = null
  if (target?.isConnected)
    target.focus()
}

async function recognizeNextUploadedFile() {
  const [next, ...rest] = pendingOcrFiles.value
  pendingOcrFiles.value = rest
  if (!next)
    return
  const recognized = await recognizeFile(next.credentialId, next.file.name, next.file)
  if (!recognized)
    await recognizeNextUploadedFile()
}

function supplierOcrValues(
  currentSupplier: Supplier | undefined,
  credential?: SupplierCredential,
): Partial<Record<CredentialOcrFieldKey, string>> {
  return {
    name: currentSupplier?.name ?? '',
    uniqueCode: currentSupplier?.uniqueCode || currentSupplier?.taxNo || '',
    taxNo: currentSupplier?.taxNo ?? '',
    legalRep: currentSupplier?.legalRep ?? '',
    address: currentSupplier?.address ?? '',
    bank: currentSupplier?.bank ?? '',
    bankAccount: currentSupplier?.bankAccount ?? '',
    validFrom: credential?.validFrom ?? '',
    expiresAt: credential?.expiresAt ?? '',
  }
}

function buildOcrReviewFields(
  parsed: ParsedCredentialOcr,
  credential?: SupplierCredential,
): CredentialOcrReviewField[] {
  const currentValues = supplierOcrValues(supplier.value, credential)
  const fields = buildCredentialOcrReview(parsed.fields, currentValues)
  for (const dateField of [
    { key: 'validFrom' as const, label: '生效日期' },
    { key: 'expiresAt' as const, label: '到期日期' },
  ]) {
    if (fields.some(field => field.key === dateField.key))
      continue
    const currentValue = currentValues[dateField.key] ?? ''
    fields.push({
      ...dateField,
      value: '',
      confidence: 0,
      currentValue,
      decision: currentValue ? 'keep-current' : 'manual',
      manualValue: '',
      conflict: false,
    })
  }
  return fields
}

async function recognizeFile(
  credentialId: string,
  fileName: string,
  file: File,
  credential?: SupplierCredential,
) {
  recognizingId.value = credentialId
  recognitionProgress.value = 0
  activeOcrReview.value = null
  try {
    const rawResult = await recognizeDocument(file, {
      onProgress: value => recognitionProgress.value = value,
    })
    const parsed = parseCredentialOcr(rawResult, fileName)
    await detailStore.recordCredentialOcrRecognition({
      supplierId: props.supplierId,
      credentialId,
      rawOcrResult: rawResult as unknown as Record<string, unknown>,
      confidence: parsed.category.confidence,
    })
    activeOcrReview.value = {
      credentialId,
      fileName,
      rawResult,
      parsed,
      fields: buildOcrReviewFields(parsed, credential),
      currentCategory: credential?.category ?? uploadCategory.value,
      currentLongTerm: credential?.longTerm ?? false,
      recognizedLongTerm: parsed.longTerm
        ? true
        : parsed.fields.some(field => field.key === 'expiresAt')
          ? false
          : null,
    }
    return true
  }
  catch (cause) {
    error(`OCR 识别失败，文件仍已安全保存，可稍后重试或人工分类：${toErrorMessage(cause)}`)
    return false
  }
  finally {
    recognizingId.value = ''
  }
}

function openPersistedOcrReview(credential: SupplierCredential, event: MouseEvent): boolean {
  ocrReturnFocusElement.value = event.currentTarget as HTMLElement
  try {
    if (!Object.keys(credential.ocrResult).length)
      throw new Error('已保存的 OCR 原始结果为空')
    if (!Array.isArray(credential.ocrResult.markdownPages))
      throw new Error('已保存的 OCR 结果来自旧格式')
    const rawResult = credential.ocrResult as unknown as OcrRecognitionResult
    const parsed = parseCredentialOcr(rawResult, credential.fileName)
    activeOcrReview.value = {
      credentialId: credential.id,
      fileName: credential.fileName,
      rawResult,
      parsed,
      fields: buildOcrReviewFields(parsed, credential),
      currentCategory: credential.category,
      currentLongTerm: credential.longTerm,
      recognizedLongTerm: parsed.longTerm
        ? true
        : parsed.fields.some(field => field.key === 'expiresAt')
          ? false
          : null,
    }
    return true
  }
  catch (cause) {
    warning(`已保存的 OCR 结果无法继续核对，将从原文件重新识别：${toErrorMessage(cause)}`)
    return false
  }
}

async function handleOcrAction(credential: SupplierCredential, event: MouseEvent) {
  if (credential.ocrReviewStatus === 'pending' && openPersistedOcrReview(credential, event))
    return
  await recognizeExisting(credential, event)
}

async function recognizeExisting(credential: SupplierCredential, event: MouseEvent) {
  ocrReturnFocusElement.value = event.currentTarget as HTMLElement
  if (!credential.hasAccessibleFile) {
    warning('历史证照未保存原件，旧路径不会被读取，请重新上传原文件')
    await restoreOcrTriggerFocus()
    return
  }
  const fileRef = fileRefFor(credential)
  if (!fileRef) {
    error('OCR 无法开始：证照文件引用缺失，请重新上传原文件')
    await restoreOcrTriggerFocus()
    return
  }
  try {
    const content = await loadFileRefContent(fileRef)
    if (!content) {
      error('OCR 无法开始：原文件丢失或当前无权读取，请检查文件后重试')
      await restoreOcrTriggerFocus()
      return
    }
    const file = new File([content.bytes.slice().buffer], credential.fileName, {
      type: content.mimeType,
    })
    const recognized = await recognizeFile(credential.id, credential.fileName, file, credential)
    if (!recognized)
      await restoreOcrTriggerFocus()
  }
  catch (cause) {
    error(`OCR 无法读取原文件：${toErrorMessage(cause)}`)
    await restoreOcrTriggerFocus()
  }
}

async function saveOcrReview(payload: {
  category: SupplierCredentialCategory
  fields: Partial<Record<CredentialOcrFieldKey, string>>
  decisions: Record<string, string>
  longTerm: boolean
}) {
  const review = activeOcrReview.value
  if (!review)
    return
  try {
    const supplierFieldKeys = [
      'name',
      'uniqueCode',
      'taxNo',
      'legalRep',
      'address',
      'bank',
      'bankAccount',
    ] as const
    const supplierFields = Object.fromEntries(
      supplierFieldKeys
        .filter(key =>
          payload.decisions[key] !== 'keep-current'
          && typeof payload.fields[key] === 'string',
        )
        .map(key => [key, payload.fields[key]]),
    )
    await detailStore.updateCredentialReview({
      supplierId: props.supplierId,
      credentialId: review.credentialId,
      category: payload.category,
      confirmedFields: {
        ...payload.fields,
        decisions: payload.decisions,
        candidates: review.parsed.fields,
        sourceFile: review.fileName,
      },
      validFrom: payload.fields.validFrom,
      expiresAt: payload.fields.expiresAt,
      longTerm: payload.longTerm,
      supplierFields,
    })
    success('OCR 核对结果已保存')
    activeOcrReview.value = null
    await recognizeNextUploadedFile()
    await restoreOcrTriggerFocus()
  }
  catch (cause) {
    showMutationError('OCR 核对结果保存失败', cause)
  }
}

async function postponeOcrReview() {
  activeOcrReview.value = null
  await recognizeNextUploadedFile()
  await restoreOcrTriggerFocus()
}

async function previewCredential(credential: SupplierCredential) {
  const file = fileRefFor(credential)
  if (!file) {
    error('无法预览：证照文件引用缺失，请重新上传原文件')
    return
  }
  if (!credential.hasAccessibleFile) {
    warning('历史证照未保存原件，旧路径不会被读取，请重新上传原文件')
    return
  }
  await preview(file)
}

async function downloadCredential(credential: SupplierCredential) {
  const file = fileRefFor(credential)
  if (!file) {
    error('无法下载：证照文件引用缺失，请重新上传原文件')
    return
  }
  if (!credential.hasAccessibleFile) {
    warning('历史证照未保存原件，旧路径不会被读取，请重新上传原文件')
    return
  }
  await download(file)
}

async function downloadAll() {
  const available = credentials.value
    .filter(credential => credential.hasAccessibleFile)
    .map(fileRefFor)
    .filter((file): file is FileRefRecord => file != null)
  if (!available.length) {
    warning('没有可下载的真实证照文件')
    return
  }
  for (const file of available)
    await download(file)
}

async function editCredentialValidity(credential: SupplierCredential) {
  const values = await formModal({
    title: `编辑「${credential.fileName || credential.category}」有效期`,
    subtitle: 'OCR 未识别或识别失败时可在此人工补录；未录入不会伪装成有效。',
    saveText: '保存有效期',
    cols: 2,
    fields: [
      {
        key: 'validFrom',
        label: '生效日期（选填）',
        type: 'date',
        value: credential.validFrom,
      },
      {
        key: 'validityType',
        label: '有效期类型',
        type: 'select',
        value: credential.longTerm ? '长期有效' : '固定到期日',
        options: ['固定到期日', '长期有效'],
      },
      {
        key: 'expiresAt',
        label: '到期日期（固定期限时填写）',
        type: 'date',
        value: credential.expiresAt,
        full: true,
      },
    ],
  })
  if (!values)
    return
  const longTerm = values.validityType === '长期有效'
  try {
    await detailStore.updateCredentialValidity({
      supplierId: props.supplierId,
      credentialId: credential.id,
      validFrom: String(values.validFrom ?? ''),
      expiresAt: longTerm ? '' : String(values.expiresAt ?? ''),
      longTerm,
    })
    success('证照有效期已更新')
  }
  catch (cause) {
    showMutationError('证照有效期更新失败', cause)
  }
}

async function changeRequirement(
  category: SupplierCredentialCategory,
  event: Event,
) {
  const select = event.target as HTMLSelectElement
  const requirement = select.value as SupplierCredentialRequirement
  let reason = requirementReason(category)
  if (requirement === 'required' && defaultCredentialRequirement(category) !== 'required') {
    const values = await formModal({
      title: `设置「${category}」为需提供`,
      subtitle: '条件性资料只有在业务明确要求时才影响资料齐全度。',
      saveText: '确认要求',
      fields: [{
        key: 'reason',
        label: '要求原因',
        type: 'textarea',
        value: reason,
        required: true,
      }],
    })
    if (!values) {
      select.value = effectiveRequirement(category)
      return
    }
    reason = String(values.reason ?? '').trim()
  }
  try {
    await detailStore.updateCredentialRequirement({
      supplierId: props.supplierId,
      category,
      requirement,
      reason,
    })
    success(`「${category}」已设为${requirementLabel(requirement)}`)
  }
  catch (cause) {
    select.value = effectiveRequirement(category)
    showMutationError('资料要求更新失败', cause)
  }
}

async function reviewCredentials(decision: 'qualified' | 'rejected') {
  const values = await formModal({
    title: decision === 'qualified' ? '人工核验通过' : '退回证照资料',
    subtitle: decision === 'qualified'
      ? '通过后将记录核验时间；关键资料变化会使本结论失效。'
      : '退回原因将作为整改依据，重新提交后仍需人工核验。',
    saveText: decision === 'qualified' ? '确认通过' : '确认退回',
    fields: [{
      key: 'note',
      label: decision === 'qualified' ? '核验备注（选填）' : '退回原因',
      type: 'textarea',
      required: decision === 'rejected',
    }],
  })
  if (!values)
    return
  try {
    await detailStore.reviewCredentials({
      supplierId: props.supplierId,
      decision,
      note: String(values.note ?? '').trim(),
    })
    success(decision === 'qualified' ? '证照资料已人工核验通过' : '证照资料已退回')
  }
  catch (cause) {
    showMutationError('资料核验失败', cause)
  }
}

async function removeCredential(credential: SupplierCredential) {
  const confirmed = await confirm({
    variant: 'simple',
    title: '删除证照',
    message: `确认删除「${credential.fileName || credential.category}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!confirmed)
    return

  try {
    const logId = await detailStore.removeCredential(credential.id, credential.supplierId)
    if (!logId) {
      error('删除失败：证照不存在或已删除')
      return
    }
    undoToast(
      `已删除证照「${credential.fileName || credential.category}」`,
      () => detailStore.undoCredential(logId, credential.supplierId),
    )
  }
  catch (cause) {
    showMutationError('证照删除失败', cause)
  }
}

function expiryPresentation(credential: SupplierCredential): {
  className: string
  label: string
} {
  const state = credentialExpiryState(credential)
  if (state === 'expired')
    return { className: 'chip-danger', label: `已过期 · ${credential.expiresAt}` }
  if (state === 'expiring') {
    const today = shanghaiBusinessDate()
    const days = Math.max(0, Math.round(
      (Date.parse(credential.expiresAt) - Date.parse(today)) / 86_400_000,
    ))
    return { className: 'chip-warn', label: `即将到期 · 剩余 ${days} 天` }
  }
  if (credential.longTerm)
    return { className: 'chip-ok', label: '长期有效' }
  if (state === 'valid')
    return { className: 'chip-ok', label: `有效 · ${credential.expiresAt}` }
  return { className: 'chip-warn', label: '有效期未录入' }
}

function hasPersistedOcrConflict(credential: SupplierCredential): boolean {
  if (credential.ocrReviewStatus !== 'pending')
    return false
  try {
    if (!Array.isArray(credential.ocrResult.markdownPages))
      return false
    const parsed = parseCredentialOcr(
      credential.ocrResult as unknown as OcrRecognitionResult,
      credential.fileName,
    )
    return parsed.category.category !== credential.category
      || buildOcrReviewFields(parsed, credential).some(field => field.conflict)
  }
  catch {
    return false
  }
}

function ocrReviewLabel(credential: SupplierCredential): string {
  if (credential.ocrReviewStatus === 'confirmed')
    return '已核对'
  if (credential.ocrReviewStatus === 'pending')
    return hasPersistedOcrConflict(credential) ? '待核对 · 存在冲突' : '待核对'
  return '未识别'
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section class="panel grid gap-3 p-4" aria-labelledby="credential-status-title">
      <div class="flex flex-wrap items-start gap-3">
        <div class="mr-auto">
          <h3 id="credential-status-title" class="text-13px font-700 text-ink">
            资料核验状态
          </h3>
          <p class="mt-1 text-11px text-ink-faint">
            文件齐全只会进入待核验；合格与退回必须由人工产生。
          </p>
        </div>
        <span
          class="chip"
          :class="supplier?.credentialStatus === 'qualified'
            ? 'chip-ok'
            : supplier?.credentialStatus === 'rejected'
              ? 'chip-danger'
              : supplier?.credentialStatus === 'reviewing'
                ? 'chip-brand'
                : 'chip-warn'"
        >
          {{ CREDENTIAL_STATUS_LABEL[supplier?.credentialStatus ?? 'incomplete'] }}
        </span>
      </div>
      <p v-if="supplier?.credentialReviewedAt" class="text-11px text-ink-soft">
        最近人工核验：{{ formatDateTime(supplier.credentialReviewedAt) }}
        <span v-if="supplier.credentialReviewNote"> · {{ supplier.credentialReviewNote }}</span>
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="btn-secondary"
          :disabled="supplier?.credentialStatus !== 'reviewing'"
          title="仅齐全待核验状态可以人工退回"
          @click="reviewCredentials('rejected')"
        >
          退回整改
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="supplier?.credentialStatus !== 'reviewing'"
          title="仅齐全待核验状态可以人工通过"
          @click="reviewCredentials('qualified')"
        >
          人工核验通过
        </button>
      </div>
    </section>

    <section class="panel p-4" aria-labelledby="credential-requirement-title">
      <h3 id="credential-requirement-title" class="text-13px font-700 text-ink">
        证照要求
      </h3>
      <p class="mt-1 text-11px text-ink-faint">
        “是否要求”与“是否收到文件”分开记录；条件资料默认不适用。
      </p>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
        <label
          v-for="category in requirementCategories"
          :key="category"
          class="grid gap-1 border border-line bg-surface-2 p-3 text-11px text-ink-soft"
        >
          <span class="font-700 text-ink">{{ category }}</span>
          <select
            class="field-input w-full"
            :value="effectiveRequirement(category)"
            :disabled="REQUIRED_SUPPLIER_CREDENTIALS.includes(category)"
            :aria-label="`${category}要求状态`"
            @change="changeRequirement(category, $event)"
          >
            <option value="required">需提供</option>
            <option value="optional">可选</option>
            <option value="not_applicable">不适用</option>
          </select>
          <span v-if="requirementReason(category)" class="text-ink-faint">
            原因：{{ requirementReason(category) }}
          </span>
        </label>
      </div>
    </section>

    <div
      v-if="missingRequired.length"
      class="panel flex items-center gap-2 border-warn/30 bg-warn-soft/30 px-3 py-2 text-12px text-warn-ink"
      role="status"
    >
      <span class="i-lucide-triangle-alert text-14px" aria-hidden="true" />
      缺失或已过期的需提供资料：{{ missingRequired.join('、') }}
    </div>

    <section class="grid gap-3" aria-labelledby="credential-list-title">
      <div class="flex flex-wrap items-end gap-2">
        <div class="mr-auto">
          <h3 id="credential-list-title" class="text-13px font-700 text-ink">
            证照清单 · {{ credentials.length }} 份
          </h3>
          <p class="mt-0.5 text-11px text-ink-faint">
            上传会保存真实文件内容；点击“上传并识别”即同意将所选文件发送至已配置的 PaddleOCR 服务。
          </p>
        </div>
        <label class="grid gap-1 text-11px text-ink-soft">
          上传类别
          <select v-model="uploadCategory" class="field-input min-w-40" aria-label="上传证照类别">
            <option v-for="category in SUPPLIER_CREDENTIAL_CATEGORIES" :key="category" :value="category">
              {{ category }}
            </option>
          </select>
        </label>
        <button type="button" class="btn-secondary" @click="downloadAll">
          <span class="i-lucide-download mr-1" aria-hidden="true" />批量下载
        </button>
        <button ref="uploadButton" type="button" class="btn-primary" :disabled="uploading" @click="openFilePicker">
          <span class="i-lucide-upload mr-1" aria-hidden="true" />
          {{ uploading ? '正在保存…' : '上传并识别' }}
        </button>
        <input
          ref="credentialFileInput"
          class="sr-only"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          multiple
          @change="onFilesSelected"
        >
      </div>

      <div
        v-if="recognizingId"
        class="panel border-brand/30 bg-brand-soft/30 px-3 py-2 text-12px text-brand-deep"
        role="status"
      >
        PaddleOCR-VL 正在识别原文件… {{ recognitionProgress }}%
      </div>

      <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="证照文件表，可横向滚动">
        <table class="w-full min-w-[62rem] border-collapse text-left text-12px">
          <thead>
            <tr class="border-y border-line bg-surface-2 text-ink-soft">
              <th class="px-3 py-2">
                证照类别
              </th>
              <th class="px-3 py-2">
                要求
              </th>
              <th class="px-3 py-2">
                文件
              </th>
              <th class="px-3 py-2">
                有效期
              </th>
              <th class="px-3 py-2">
                OCR 核对
              </th>
              <th class="px-3 py-2">
                添加时间
              </th>
              <th class="px-3 py-2 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!credentials.length">
              <td colspan="7" class="px-3 py-8 text-center text-ink-faint">
                尚未添加证照
              </td>
            </tr>
            <tr v-for="credential in credentials" :key="credential.id" class="border-b border-line">
              <td class="px-3 py-2">
                <span class="chip chip-brand">{{ credential.category }}</span>
              </td>
              <td class="px-3 py-2">
                {{ requirementLabel(effectiveRequirement(credential.category)) }}
              </td>
              <td class="max-w-64 px-3 py-2">
                <button type="button" class="cell--link block max-w-full truncate" @click="previewCredential(credential)">
                  {{ credential.fileName || '文件引用缺失' }}
                </button>
              </td>
              <td class="px-3 py-2">
                <span class="chip" :class="expiryPresentation(credential).className">
                  {{ expiryPresentation(credential).label }}
                </span>
              </td>
              <td class="px-3 py-2">
                <span :class="credential.ocrReviewStatus === 'confirmed' ? 'chip chip-ok' : 'chip chip-warn'">
                  {{ ocrReviewLabel(credential) }}
                </span>
              </td>
              <td class="px-3 py-2 font-mono text-11px text-ink-soft">
                {{ formatDateTime(credential.addedAt) }}
              </td>
              <td class="px-3 py-2">
                <div class="flex justify-end gap-1">
                  <button type="button" class="icon-btn" :aria-label="`编辑有效期 ${credential.fileName}`" title="编辑有效期" @click="editCredentialValidity(credential)">
                    <span class="i-lucide-calendar-clock" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    :aria-label="`${credential.ocrReviewStatus === 'pending' ? '继续核对' : 'OCR 识别'} ${credential.fileName}`"
                    :title="credential.ocrReviewStatus === 'pending' ? '继续核对' : 'OCR 识别'"
                    @click="handleOcrAction(credential, $event)"
                  >
                    <span class="i-lucide-scan-text" aria-hidden="true" />
                  </button>
                  <button type="button" class="icon-btn" :aria-label="`预览 ${credential.fileName}`" title="预览" @click="previewCredential(credential)">
                    <span class="i-lucide-eye" aria-hidden="true" />
                  </button>
                  <button type="button" class="icon-btn" :aria-label="`下载 ${credential.fileName}`" title="下载" @click="downloadCredential(credential)">
                    <span class="i-lucide-download" aria-hidden="true" />
                  </button>
                  <button type="button" class="icon-btn-danger" :aria-label="`删除 ${credential.fileName}`" title="删除" @click="removeCredential(credential)">
                    <span class="i-lucide-trash-2" aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <SupplierCredentialOcrReview
      v-if="activeOcrReview"
      :file-name="activeOcrReview.fileName"
      :category="activeOcrReview.parsed.category"
      :current-category="activeOcrReview.currentCategory"
      :fields="activeOcrReview.fields"
      :current-long-term="activeOcrReview.currentLongTerm"
      :recognized-long-term="activeOcrReview.recognizedLongTerm"
      @cancel="postponeOcrReview"
      @confirm="saveOcrReview"
    />
  </div>
</template>
