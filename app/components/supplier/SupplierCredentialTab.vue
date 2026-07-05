<script setup lang="ts">
import { execute, select } from '~/lib/db/connection'
import { generateId } from '~/lib/util/id'

const props = defineProps<{
  supplierId: string
}>()

const toast = useToast()

interface Credential {
  id: string
  supplierId: string
  category: string
  fileName: string
  filePath: string
  ocrResult: Record<string, unknown>
  ocrConfidence: number | null
  verifiedAt: string | null
  addedAt: string
}

const CATEGORIES = [
  '营业执照', '法人身份证', '银行开户许可证', '签约代表身份证',
  '品牌授权证明', '合同模板', '完税证明', '过往业绩合同', '施工照片', '其他',
]
const REQUIRED = ['营业执照', '法人身份证', '银行开户许可证']

const credentials = ref<Credential[]>([])
const loading = ref(false)

async function loadCredentials() {
  loading.value = true
  try {
    const rows = await select<Record<string, unknown>>(
      'SELECT * FROM supplier_credentials WHERE supplier_id = ? ORDER BY added_at DESC',
      [props.supplierId],
    )
    credentials.value = rows.map(r => ({
      id: r.id as string,
      supplierId: r.supplier_id as string,
      category: r.category as string,
      fileName: (r.file_name ?? '') as string,
      filePath: (r.file_path ?? '') as string,
      ocrResult: JSON.parse((r.ocr_result as string) || '{}'),
      ocrConfidence: r.ocr_confidence as number | null,
      verifiedAt: r.verified_at as string | null,
      addedAt: (r.added_at ?? '') as string,
    }))
  }
  finally {
    loading.value = false
  }
}

const missingRequired = computed(() =>
  REQUIRED.filter(cat => !credentials.value.some(c => c.category === cat)),
)

const showAdd = ref(false)
const newCategory = ref('营业执照')
const newFileName = ref('')

async function addCredential() {
  if (!newFileName.value.trim()) {
    toast.warning('请填写文件名')
    return
  }
  const id = generateId('cred')
  await execute(
    `INSERT INTO supplier_credentials (id, supplier_id, category, file_name, added_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, props.supplierId, newCategory.value, newFileName.value, new Date().toISOString()],
  )
  toast.success('证照已添加（待上传文件）')
  showAdd.value = false
  newFileName.value = ''
  await loadCredentials()
}

async function removeCredential(id: string) {
  await execute('DELETE FROM supplier_credentials WHERE id = ?', [id])
  toast.success('已删除')
  await loadCredentials()
}

const categoryColor: Record<string, string> = {
  '营业执照': 'chip-brand',
  '法人身份证': 'chip-brand',
  '银行开户许可证': 'chip-brand',
}

watch(() => props.supplierId, loadCredentials, { immediate: true })
</script>

<template>
  <div>
    <!-- 缺失提示 -->
    <div
      v-if="missingRequired.length"
      class="flex items-center gap-2 px-3 py-2 mb-4 border border-line bg-warn-soft/30 text-12px text-warn-ink"
    >
      <span class="i-lucide-triangle-alert text-14px" />
      缺失必需证照: {{ missingRequired.join('、') }}
    </div>

    <!-- 工具栏 -->
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-13px font-700 text-ink">
        证照清单 · {{ credentials.length }} 份
      </h4>
      <button class="btn-primary" @click="showAdd = true">
        <span class="i-lucide-plus text-13px mr-1" /> 添加证照
      </button>
    </div>

    <!-- 证照表格 -->
    <div class="border border-line">
      <vxe-table
        :data="credentials"
        :loading="loading"
        border
        show-overflow
        height="auto"
        :row-config="{ isHover: true }"
      >
        <vxe-column type="seq" title="#" width="52" />
        <vxe-column field="category" title="类别" width="140">
          <template #default="{ row }">
            <span :class="['chip', categoryColor[row.category] || 'chip-brand']">
              {{ row.category }}
            </span>
          </template>
        </vxe-column>
        <vxe-column field="fileName" title="文件名" min-width="200">
          <template #default="{ row }">
            <span v-if="row.filePath" class="cell--link">{{ row.fileName }}</span>
            <span v-else class="text-ink-faint">{{ row.fileName || '待上传' }}</span>
          </template>
        </vxe-column>
        <vxe-column field="ocrConfidence" title="识别置信度" width="110">
          <template #default="{ row }">
            <span v-if="row.ocrConfidence != null" class="font-mono text-12px">
              {{ (row.ocrConfidence * 100).toFixed(1) }}%
            </span>
            <span v-else class="text-ink-faint">—</span>
          </template>
        </vxe-column>
        <vxe-column field="verifiedAt" title="审核时间" width="160">
          <template #default="{ row }">
            {{ row.verifiedAt?.slice(0, 19).replace('T', ' ') || '—' }}
          </template>
        </vxe-column>
        <vxe-column field="addedAt" title="添加时间" width="160">
          <template #default="{ row }">
            {{ row.addedAt?.slice(0, 19).replace('T', ' ') || '—' }}
          </template>
        </vxe-column>
        <vxe-column title="操作" width="90" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-1">
              <button class="icon-btn" title="上传文件">
                <span class="i-lucide-upload text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="removeCredential(row.id)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <!-- 添加弹窗 -->
    <ConfirmDialog
      :open="showAdd"
      title="添加证照"
      confirm-label="添加"
      @confirm="addCredential"
      @cancel="showAdd = false"
    >
      <template #default>
        <div class="space-y-3">
          <div>
            <label class="field-label">证照类别</label>
            <select v-model="newCategory" class="field-input w-full">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div>
            <label class="field-label">文件名（上传后自动填充）</label>
            <input v-model="newFileName" class="field-input w-full" placeholder="如: 营业执照-大板东.pdf">
          </div>
          <p class="text-11px text-ink-faint">
            文件上传功能需要 Tauri 环境。当前先记录证照条目，文件稍后上传。
          </p>
        </div>
      </template>
    </ConfirmDialog>
  </div>
</template>
