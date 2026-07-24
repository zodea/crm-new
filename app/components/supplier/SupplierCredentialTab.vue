<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierCredentialCategory } from '~/lib/supplier/detail'
import type { SupplierCredential, SupplierDetailSnapshot } from '~/stores/supplier-detail'
import {
  REQUIRED_SUPPLIER_CREDENTIALS,
  SUPPLIER_CREDENTIAL_CATEGORIES,
} from '~/lib/supplier/detail'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  supplierId: string
  snapshot: SupplierDetailSnapshot
}>()

const detailStore = useSupplierDetailStore()
const { confirm, formModal, undoToast, success, warning, error } = useKitUI()

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'category', title: '证照类别', width: 150, slot: 'category' },
  { field: 'required', title: '要求', width: 80, slot: 'required' },
  { field: 'fileName', title: '文件', minWidth: 210, slot: 'fileName' },
  { field: 'ocrConfidence', title: 'OCR 置信度', width: 115, slot: 'confidence' },
  { field: 'verifiedAt', title: '审核状态', width: 110, slot: 'verified' },
  { field: 'addedAt', title: '添加时间', width: 165, slot: 'addedAt' },
  { title: '操作', type: 'action', width: 132, fixed: 'right' },
]

const credentials = computed(() => [...props.snapshot.credentials])
const missingRequired = computed(() =>
  REQUIRED_SUPPLIER_CREDENTIALS.filter(category =>
    !credentials.value.some(credential => credential.category === category),
  ),
)

function isRequired(category: string): boolean {
  return REQUIRED_SUPPLIER_CREDENTIALS.includes(category as SupplierCredentialCategory)
}

function formatDateTime(value: string | null): string {
  return value?.slice(0, 19).replace('T', ' ') || '—'
}

function showMutationError(prefix: string, err: unknown) {
  const message = toErrorMessage(err)
  error(message.startsWith('数据已保存') ? message : `${prefix}：${message}`)
}

async function addCredential() {
  const values = await formModal({
    title: '添加证照',
    subtitle: '浏览器模式保存证照分类与文件名；Tauri 文件路径将在桌面端接管。',
    saveText: '添加',
    fields: [
      { key: 'category', label: '证照类别', type: 'select', options: [...SUPPLIER_CREDENTIAL_CATEGORIES], value: '营业执照', required: true },
      { key: 'fileName', label: '文件名', placeholder: '如：营业执照-大板东.pdf', required: true },
    ],
  })
  if (!values)
    return

  const category = values.category as SupplierCredentialCategory
  const fileName = String(values.fileName ?? '').trim()
  if (!SUPPLIER_CREDENTIAL_CATEGORIES.includes(category) || !fileName) {
    warning('请选择证照类别并填写文件名')
    return
  }

  try {
    await detailStore.addCredential({ supplierId: props.supplierId, category, fileName })
    success('证照已添加，资料状态已重新计算')
  }
  catch (err) {
    showMutationError('证照添加失败', err)
  }
}

async function removeCredential(credential: SupplierCredential) {
  const supplierId = credential.supplierId
  const confirmed = await confirm({
    variant: 'simple',
    title: '删除证照',
    message: `确认删除「${credential.fileName || credential.category}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!confirmed)
    return

  try {
    const logId = await detailStore.removeCredential(credential.id, supplierId)
    if (!logId) {
      error('删除失败：证照不存在或已删除')
      return
    }
    undoToast(
      `已删除证照「${credential.fileName || credential.category}」`,
      () => detailStore.undoCredential(logId, supplierId),
    )
  }
  catch (err) {
    showMutationError('证照删除失败', err)
  }
}

function previewCredential(credential: SupplierCredential) {
  warning(credential.filePath
    ? `正在打开 ${credential.fileName}`
    : '浏览器模式仅保存文件元数据，桌面端接入后可预览原文件')
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <div
      v-if="missingRequired.length"
      class="panel flex items-center gap-2 border-warn/30 bg-warn-soft/30 px-3 py-2 text-12px text-warn-ink"
      role="status"
    >
      <span class="i-lucide-triangle-alert text-14px" aria-hidden="true" />
      缺失必需证照：{{ missingRequired.join('、') }}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="mr-auto">
        <h3 class="text-13px font-700 text-ink">
          证照清单 · {{ credentials.length }} 份
        </h3>
        <p class="mt-0.5 text-11px text-ink-faint">
          营业执照、法人身份证、银行开户许可证齐全后自动标记为合格
        </p>
      </div>
      <button type="button" class="btn-secondary" @click="warning('桌面端文件打包能力接入后开放批量下载')">
        <span class="i-lucide-download mr-1" aria-hidden="true" />批量下载
      </button>
      <button type="button" class="btn-primary" @click="addCredential">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />添加证照
      </button>
    </div>

    <KitTable
      :columns="columns"
      :data="credentials"
      :loading="detailStore.isLoading(supplierId)"
      empty="尚未添加证照"
    >
      <template #category="{ row }">
        <span class="chip chip-brand">{{ row.category }}</span>
      </template>

      <template #required="{ row }">
        <span v-if="isRequired(row.category)" class="chip chip-warn">必需</span>
        <span v-else class="text-ink-faint">可选</span>
      </template>

      <template #fileName="{ row }">
        <button type="button" class="cell--link" @click="previewCredential(row)">
          {{ row.fileName || '待上传' }}
        </button>
      </template>

      <template #confidence="{ row }">
        <span v-if="row.ocrConfidence != null" class="font-mono">
          {{ (row.ocrConfidence * 100).toFixed(1) }}%
        </span>
        <span v-else class="text-ink-faint">—</span>
      </template>

      <template #verified="{ row }">
        <span :class="row.verifiedAt ? 'chip chip-ok' : 'chip chip-warn'">
          {{ row.verifiedAt ? '已审核' : '待审核' }}
        </span>
      </template>

      <template #addedAt="{ row }">
        <span class="font-mono text-11px text-ink-soft">{{ formatDateTime(row.addedAt) }}</span>
      </template>

      <template #action="{ row }">
        <div class="flex justify-end gap-1">
          <button type="button" class="icon-btn" :aria-label="`重新识别证照 ${row.fileName}`" title="OCR 重新识别" @click="warning('OCR 证照识别将在识别服务接入后开放')">
            <span class="i-lucide-scan-text" aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn" :aria-label="`预览证照 ${row.fileName}`" title="预览" @click="previewCredential(row)">
            <span class="i-lucide-eye" aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn-danger" :aria-label="`删除证照 ${row.fileName}`" title="删除" @click="removeCredential(row)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </div>
      </template>
    </KitTable>
  </div>
</template>
