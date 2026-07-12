<script setup lang="ts">
import type { Invoice } from '~/stores/invoice'

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { success, warning, formModal } = useKitUI()

const activeTab = ref<'docs' | 'review' | 'ledger'>('docs')
const searchText = ref('')
const selectedId = ref<string | null>(null)
const ledgerOwnerFilter = ref<'all' | 'project' | 'personal' | 'unassigned'>('all')

// 归属：项目 / 个人开支 单选中文文案 ↔ ownerKind 的映射（formModal select 只支持字符串 label=value）
const OWNER_KIND_LABEL = { project: '归属项目', personal: '个人开支' } as const
const OWNER_KIND_OPTIONS = Object.values(OWNER_KIND_LABEL)
function labelToOwnerKind(label: string): 'project' | 'personal' {
  return label === OWNER_KIND_LABEL.personal ? 'personal' : 'project'
}
/** 手动录入表单专用的第三态：不属于业务归属枚举，代表"这次先不归档"，故不放进 OWNER_KIND_LABEL。 */
const NO_ATTRIBUTION_LABEL = '暂不归属'

/** 按项目名称查具体项目（归档写入用规范名，而非发票原始 OCR/自由文本，避免 project_id/project_name 各指不同项目）。 */
function findProjectByName(name: string) {
  return projectStore.list.find(p => p.name === name)
}

/** 归档：弹出归属选择表单，校验交给 store.archiveInvoice（缺归属/项目归属未选具体项目均拒绝）。 */
async function archiveInvoiceFlow(inv: Invoice) {
  const values = await formModal({
    title: '归档发票',
    subtitle: '归档需指定归属（项目 / 个人开支），归档后计入台账统计（DATABASE.md §4.2）。',
    fields: [
      { key: 'ownerKindLabel', label: '归属', type: 'select', options: [...OWNER_KIND_OPTIONS], value: OWNER_KIND_LABEL.project, required: true },
      { key: 'projectName', label: '对应项目（归属项目时必选）', type: 'select', options: projectStore.list.map(p => p.name), value: inv.projectName || '' },
    ],
    saveText: '归档',
  })
  if (!values)
    return
  const ownerKind = labelToOwnerKind(String(values.ownerKindLabel))
  const project = ownerKind === 'project' ? findProjectByName(String(values.projectName)) : undefined
  const result = await store.archiveInvoice(inv.id, ownerKind, project?.id ?? null, project?.name)
  if (!result.ok) {
    warning(result.reason ?? '归档失败')
    return
  }
  success('已归档，计入台账')
}

// 新增弹窗
const showAddDialog = ref(false)
const addForm = reactive({
  invoiceType: '增值税专用发票',
  invoiceNumber: '',
  invoiceDate: '',
  buyer: '广州市瑞航建筑工程有限公司',
  seller: '',
  amount: 0,
  taxAmount: 0,
  totalAmount: 0,
  taxRate: '13%',
  remark: '',
  projectName: '',
  source: 'excel' as const,
  ownerKindLabel: NO_ATTRIBUTION_LABEL,
})

function resetAddForm() {
  addForm.invoiceType = '增值税专用发票'
  addForm.invoiceNumber = ''
  addForm.invoiceDate = ''
  addForm.buyer = '广州市瑞航建筑工程有限公司'
  addForm.seller = ''
  addForm.amount = 0
  addForm.taxAmount = 0
  addForm.totalAmount = 0
  addForm.taxRate = '13%'
  addForm.remark = ''
  addForm.projectName = ''
  addForm.ownerKindLabel = NO_ATTRIBUTION_LABEL
}

async function handleAdd() {
  if (!addForm.invoiceNumber && !addForm.seller) {
    warning('请至少填写发票号码或供应商')
    return
  }
  // 手动录入内容已确定，直接落「已确认」态；选了归属则立即归档，否则留到台账页按需归档。
  const { ownerKindLabel, ...invoiceData } = addForm
  const id = await store.add({
    ...invoiceData,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    confirmedAt: new Date().toISOString(),
  })
  if (ownerKindLabel === NO_ATTRIBUTION_LABEL) {
    success('发票已添加，待归档后计入台账')
  }
  else {
    const ownerKind = labelToOwnerKind(ownerKindLabel)
    const project = ownerKind === 'project' ? findProjectByName(addForm.projectName) : undefined
    const result = await store.archiveInvoice(id, ownerKind, project?.id ?? null, project?.name)
    if (result.ok)
      success('发票已添加并归档，计入台账')
    else
      warning(`发票已添加，但归档失败：${result.reason}`)
  }
  showAddDialog.value = false
  resetAddForm()
}

// 删除确认
const showDeleteConfirm = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteTargetName = ref('')

function askDelete(inv: Invoice) {
  deleteTargetId.value = inv.id
  deleteTargetName.value = inv.invoiceNumber || inv.fileName || inv.id
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (!deleteTargetId.value)
    return
  await store.remove(deleteTargetId.value)
  success('已删除')
  showDeleteConfirm.value = false
  if (selectedId.value === deleteTargetId.value)
    selectedId.value = null
  deleteTargetId.value = null
}

// 编辑弹窗（台账用）
const showEditDialog = ref(false)
const editForm = reactive<Partial<Invoice>>({})
const editId = ref('')

function openEdit(inv: Invoice) {
  editId.value = inv.id
  Object.assign(editForm, { ...inv })
  showEditDialog.value = true
}

async function handleEdit() {
  if (!editId.value)
    return
  await store.update(editId.value, editForm)
  success('已更新')
  showEditDialog.value = false
}

// 台账三分组（issue #57 验收③：项目 / 个人开支 / 未归，未归=已确认待归档）
const OWNER_FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'project', label: '项目' },
  { key: 'personal', label: '个人开支' },
  { key: 'unassigned', label: '待归档' },
] as const

const ledgerRowsByOwner = computed(() => ({
  all: [...store.ledgerGroups.project, ...store.ledgerGroups.personal, ...store.ledgerGroups.unassigned],
  project: store.ledgerGroups.project,
  personal: store.ledgerGroups.personal,
  unassigned: store.ledgerGroups.unassigned,
}))

// 统计
const tabCounts = computed(() => ({
  docs: store.documents.length,
  review: store.pendingReview.length,
  // 与台账 Tab 三分组共用同一份 ledgerRowsByOwner.all，避免两处各写一套公式算同一个数漂移
  ledger: ledgerRowsByOwner.value.all.length,
}))

const docStats = computed(() => {
  let pending = 0
  let done = 0
  let duplicate = 0
  for (const d of store.documents) {
    if (d.ocrStatus === 'pending' || d.ocrStatus === 'processing')
      pending++
    if (d.ocrStatus === 'done' && d.dupStatus === 'normal')
      done++
    if (d.dupStatus === 'duplicate')
      duplicate++
  }
  return { pending, done, duplicate }
})

const OCR_STATUS_LABEL: Record<string, string> = {
  pending: '待识别',
  processing: '识别中',
  done: '识别完成',
  failed: '识别失败',
}
const OCR_STATUS_CLASS: Record<string, string> = {
  pending: 'cell--status-warn',
  processing: 'text-brand font-600',
  done: 'cell--status-ok',
  failed: 'cell--status-danger',
}

function statusLabel(inv: Invoice): string {
  if (inv.dupStatus === 'duplicate')
    return '重复已排除'
  return OCR_STATUS_LABEL[inv.ocrStatus] || inv.ocrStatus
}
function statusClass(inv: Invoice): string {
  if (inv.dupStatus === 'duplicate')
    return 'cell--status-danger'
  return OCR_STATUS_CLASS[inv.ocrStatus] || ''
}

const docsFiltered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  let items = store.documents
  if (q) {
    items = items.filter(inv =>
      inv.fileName.toLowerCase().includes(q)
      || inv.seller.toLowerCase().includes(q)
      || inv.buyer.toLowerCase().includes(q),
    )
  }
  return items
})

const ledgerFiltered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  let items = ledgerRowsByOwner.value[ledgerOwnerFilter.value]
  if (q) {
    items = items.filter(inv =>
      inv.invoiceNumber.toLowerCase().includes(q)
      || inv.seller.toLowerCase().includes(q)
      || inv.buyer.toLowerCase().includes(q),
    )
  }
  return items
})

// 底部合计只统计已归档（accountStatus==='archived'）——精确对齐 DATABASE.md §4.2 口径。
// 台账列表本身按 issue #57 验收③展示「项目/个人开支/待归档」三分组，含未归档行，
// 但合计栏不应把「待归档」的金额混进「已归档」的统计口径，避免用户误读成 §4.2 台账总额。
const ledgerArchived = computed(() => ledgerFiltered.value.filter(inv => inv.accountStatus === 'archived'))
const ledgerTotal = computed(() =>
  ledgerArchived.value.reduce((s, inv) => s + inv.totalAmount, 0),
)
const ledgerTax = computed(() =>
  ledgerArchived.value.reduce((s, inv) => s + inv.taxAmount, 0),
)

function fmtMoney(v: number): string {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function selectForReview(inv: Invoice) {
  selectedId.value = inv.id
  activeTab.value = 'review'
}

async function confirmSelected() {
  if (!selectedId.value)
    return
  await store.confirmInvoice(selectedId.value)
  success('已确认，可在台账页归档')
}

async function archiveSelected() {
  if (!selectedId.value)
    return
  const inv = store.byId(selectedId.value)
  if (!inv)
    return
  await archiveInvoiceFlow(inv)
}

onMounted(() => {
  store.load()
  projectStore.load()
})
</script>

<template>
  <div>
    <!-- Tab 栏 -->
    <div class="flex items-center border-b border-line mb-4">
      <button
        class="content-tab"
        :class="activeTab === 'docs' ? 'content-tab-active' : ''"
        @click="activeTab = 'docs'"
      >
        文档管理 {{ tabCounts.docs }}
      </button>
      <button
        class="content-tab"
        :class="activeTab === 'review' ? 'content-tab-active' : ''"
        @click="activeTab = 'review'"
      >
        校对与排版 {{ tabCounts.review }}
      </button>
      <button
        class="content-tab"
        :class="activeTab === 'ledger' ? 'content-tab-active' : ''"
        @click="activeTab = 'ledger'"
      >
        发票台账 {{ tabCounts.ledger }}
      </button>
      <div class="flex-1" />
      <button class="btn-secondary mr-2" @click="showAddDialog = true">
        <span class="i-lucide-plus text-13px mr-1" /> 手动录入
      </button>
      <button class="btn-primary mr-1" disabled>
        <span class="i-lucide-scan-text text-13px mr-1" /> 批量识别
      </button>
    </div>

    <!-- ═══ Tab 1: 文档管理 ═══ -->
    <div v-if="activeTab === 'docs'">
      <!-- 上传区 -->
      <div class="upload-zone mb-4 py-8 cursor-pointer">
        <span class="i-lucide-upload text-24px mb-2 block mx-auto text-brand" />
        <p class="text-13px font-600">
          拖拽 PDF / 图片 / 文件夹到此处上传
        </p>
        <p class="text-11px text-ink-faint mt-1">
          上传后自动进入识别队列（需要真实文件时请上传）
        </p>
      </div>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="全部文档" :value="store.documents.length" icon="i-lucide-file-text" color="brand" />
        <StatCard
          label="待识别"
          :value="docStats.pending"
          icon="i-lucide-clock" color="warn"
        />
        <StatCard
          label="识别完成"
          :value="docStats.done"
          icon="i-lucide-circle-check" color="ok"
        />
        <StatCard
          label="重复/排除"
          :value="docStats.duplicate"
          icon="i-lucide-copy-x" color="danger"
        />
      </div>

      <!-- 搜索 -->
      <div class="mb-3">
        <input
          v-model="searchText"
          class="field-input w-64"
          placeholder="搜索文件名、公司…"
        >
      </div>

      <!-- 文档表格 -->
      <div class="border border-line">
        <vxe-table
          :data="docsFiltered"
          :loading="store.loading"
          border
          show-overflow
          height="auto"
          :row-config="{ isHover: true, keyField: 'id' }"
        >
          <vxe-column type="seq" title="#" width="52" />
          <vxe-column field="fileName" title="文件名" min-width="200">
            <template #default="{ row }">
              <span class="font-700">{{ row.fileName || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="invoiceType" title="类型" width="130">
            <template #default="{ row }">
              <span class="text-ink-soft">{{ row.invoiceType || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="seller" title="供应商" min-width="160">
            <template #default="{ row }">
              <span class="text-ink-soft">{{ row.seller || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="totalAmount" title="价税合计" width="120">
            <template #default="{ row }">
              <span class="font-mono font-700 block text-right">
                {{ row.totalAmount ? fmtMoney(row.totalAmount) : '—' }}
              </span>
            </template>
          </vxe-column>
          <vxe-column title="状态" width="110">
            <template #default="{ row }">
              <span :class="statusClass(row)">{{ statusLabel(row) }}</span>
            </template>
          </vxe-column>
          <vxe-column title="操作" width="90" fixed="right">
            <template #default="{ row }">
              <div class="flex items-center gap-1">
                <button
                  v-if="row.ocrStatus === 'done' && row.dupStatus === 'normal'"
                  class="icon-btn" title="校对"
                  @click="selectForReview(row)"
                >
                  <span class="i-lucide-file-search text-14px" />
                </button>
                <button class="icon-btn-danger" title="删除" @click="askDelete(row)">
                  <span class="i-lucide-trash-2 text-14px" />
                </button>
              </div>
            </template>
          </vxe-column>
        </vxe-table>
      </div>
    </div>

    <!-- ═══ Tab 2: 校对与排版 ═══ -->
    <div v-else-if="activeTab === 'review'">
      <div class="flex gap-3" style="height: calc(100vh - 240px); min-height: 560px">
        <!-- 左栏 — 发票列表 -->
        <div class="w-72 shrink-0 border border-line bg-panel overflow-y-auto">
          <div class="px-3 py-2 border-b border-line text-12px text-ink-soft">
            本批次 {{ store.pendingReview.length }} 张 · 待校对
          </div>
          <div
            v-for="inv in store.pendingReview"
            :key="inv.id"
            class="flex items-center gap-2.5 px-3 py-2 border-b border-line cursor-pointer transition-colors"
            :class="selectedId === inv.id ? 'bg-brand-soft' : 'hover:bg-surface-3'"
            @click="selectedId = inv.id"
          >
            <div class="w-7 h-9 bg-surface-2 rounded-[2px] flex items-center justify-center text-10px font-800 text-ink-faint shrink-0">
              票
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-12px font-700 truncate">
                {{ inv.invoiceNumber ? `…${inv.invoiceNumber.slice(-8)}` : '—' }}
              </div>
              <div class="text-11px text-ink-soft truncate">
                {{ inv.seller || inv.buyer || '—' }}
              </div>
            </div>
            <span class="chip-warn text-10px">待校对</span>
          </div>
          <div v-if="!store.pendingReview.length" class="p-4 text-center text-ink-faint text-12px">
            没有待校对的发票
          </div>
        </div>

        <!-- 中栏 — A4 打印排版预览 -->
        <div class="flex-1 border border-line bg-surface-sink overflow-y-auto p-4">
          <div class="text-12px text-ink-soft mb-3">
            打印排版 · 单击选中 · 右键旋转
          </div>
          <div class="bg-panel border border-line mx-auto p-4" style="aspect-ratio: 1/1.4142; max-width: 480px">
            <div v-if="selectedId" class="h-full flex items-center justify-center">
              <div class="text-center">
                <div class="w-20 h-28 bg-surface-2 rounded-[3px] mx-auto mb-2 flex items-center justify-center border-2 border-brand">
                  <span class="text-24px font-800 text-ink-faint">票</span>
                </div>
                <span class="text-11px text-ink-soft">{{ store.byId(selectedId)?.invoiceNumber?.slice(-8) || '—' }}</span>
              </div>
            </div>
            <div v-else class="h-full flex items-center justify-center text-ink-faint text-13px">
              从左侧列表选择发票
            </div>
          </div>
        </div>

        <!-- 右栏 — 识别结果校对 -->
        <div class="w-80 shrink-0 border border-line bg-panel overflow-y-auto">
          <div class="px-3 py-2 border-b border-line text-12px font-700 text-ink">
            识别结果提取
          </div>
          <div v-if="selectedId && store.byId(selectedId)" class="p-3">
            <InvoiceReviewForm
              :invoice="store.byId(selectedId)!"
              @confirm="confirmSelected"
              @archive="archiveSelected"
            />
          </div>
          <div v-else class="p-4 text-center text-ink-faint text-12px">
            选择一张发票开始校对
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Tab 3: 发票台账 ═══ -->
    <div v-else-if="activeTab === 'ledger'">
      <DataListToolbar
        title="发票台账"
        :count="ledgerFiltered.length"
        :show-create="false"
        @search="v => searchText = v"
      />

      <!-- 归属筛选（issue #57 验收③：项目 / 个人开支 / 待归档 分组计数） -->
      <div class="flex items-center gap-2 pb-2.5 px-1">
        <SelectFilter
          v-model="ledgerOwnerFilter"
          label="归属"
          :options="OWNER_FILTER_OPTIONS.map(o => ({ key: o.key, label: `${o.label} ${ledgerRowsByOwner[o.key].length}` }))"
          placeholder="全部"
        />
      </div>

      <div class="border border-line">
        <vxe-table
          :data="ledgerFiltered"
          :loading="store.loading"
          border
          show-overflow
          height="auto"
          :row-config="{ isHover: true, keyField: 'id' }"
          :column-config="{ resizable: true }"
        >
          <vxe-column type="seq" title="#" width="52" fixed="left" />
          <vxe-column field="invoiceNumber" title="单据编号" width="160">
            <template #default="{ row }">
              <span class="font-mono font-700">{{ row.invoiceNumber || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="invoiceDate" title="开票日期" width="100">
            <template #default="{ row }">
              <span class="font-mono">{{ row.invoiceDate }}</span>
            </template>
          </vxe-column>
          <vxe-column field="buyer" title="购买方" min-width="160" />
          <vxe-column field="seller" title="供应商" min-width="180" />
          <vxe-column field="invoiceType" title="票据类型" width="130" />
          <vxe-column field="totalAmount" title="价税合计" width="120">
            <template #default="{ row }">
              <span class="font-mono font-800 block text-right">{{ fmtMoney(row.totalAmount) }}</span>
            </template>
          </vxe-column>
          <vxe-column field="taxAmount" title="税额" width="100">
            <template #default="{ row }">
              <span class="font-mono block text-right">{{ fmtMoney(row.taxAmount) }}</span>
            </template>
          </vxe-column>
          <vxe-column field="taxRate" title="税率" width="60">
            <template #default="{ row }">
              <span class="font-mono">{{ row.taxRate }}</span>
            </template>
          </vxe-column>
          <vxe-column field="projectName" title="对应项目" min-width="120" />
          <vxe-column title="归属" width="90">
            <template #default="{ row }">
              <span v-if="row.ownerKind === 'project'" class="chip-brand">项目</span>
              <span v-else-if="row.ownerKind === 'personal'" class="chip bg-surface-3 text-ink-soft">个人开支</span>
              <span v-else class="chip-warn">待归档</span>
            </template>
          </vxe-column>
          <vxe-column field="source" title="来源" width="70">
            <template #default="{ row }">
              <span :class="row.source === 'scan' ? 'chip-brand' : 'chip bg-surface-3 text-ink-soft'">
                {{ row.source === 'scan' ? '扫描' : '导入' }}
              </span>
            </template>
          </vxe-column>
          <vxe-column title="操作" width="120" fixed="right">
            <template #default="{ row }">
              <div class="flex items-center gap-1">
                <button
                  v-if="row.accountStatus === 'none'"
                  class="icon-btn" title="归档"
                  @click="archiveInvoiceFlow(row)"
                >
                  <span class="i-lucide-archive text-14px" />
                </button>
                <button class="icon-btn" title="编辑" @click="openEdit(row)">
                  <span class="i-lucide-square-pen text-14px" />
                </button>
                <button class="icon-btn-danger" title="删除" @click="askDelete(row)">
                  <span class="i-lucide-trash-2 text-14px" />
                </button>
              </div>
            </template>
          </vxe-column>
        </vxe-table>
      </div>

      <!-- 底部汇总（仅统计已归档，对齐 §4.2 口径；当前筛选含待归档行时不计入这两个数字） -->
      <div class="flex items-center px-3 py-2 border border-t-0 border-line bg-panel text-12px">
        <span class="text-ink-soft">已归档合计: </span>
        <span class="font-mono font-700 text-ink ml-1 mr-4">¥{{ fmtMoney(ledgerTotal) }}</span>
        <span class="text-ink-soft">已归档税额: </span>
        <span class="font-mono font-700 text-ink ml-1">¥{{ fmtMoney(ledgerTax) }}</span>
      </div>
    </div>

    <!-- ═══ 删除确认弹窗 ═══ -->
    <ConfirmDialog
      :open="showDeleteConfirm"
      title="删除发票"
      :message="`确认删除发票「${deleteTargetName}」？此操作不可撤回。`"
      confirm-label="删除"
      :danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- ═══ 新增发票弹窗 ═══ -->
    <FormDialog
      :open="showAddDialog"
      title="手动录入发票"
      save-label="添加"
      width="min(640px, 95vw)"
      @save="handleAdd"
      @cancel="showAddDialog = false"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">票据类型</label>
          <select v-model="addForm.invoiceType" class="field-input w-full">
            <option value="增值税专用发票">
              增值税专用发票
            </option>
            <option value="增值税普通发票">
              增值税普通发票
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">发票号码</label>
          <input v-model="addForm.invoiceNumber" class="field-input w-full font-mono" placeholder="发票号码">
        </div>
        <div>
          <label class="field-label">开票日期</label>
          <input v-model="addForm.invoiceDate" type="date" class="field-input w-full font-mono">
        </div>
        <div>
          <label class="field-label">税率</label>
          <select v-model="addForm.taxRate" class="field-input w-full">
            <option value="13%">
              13%
            </option>
            <option value="9%">
              9%
            </option>
            <option value="6%">
              6%
            </option>
            <option value="3%">
              3%
            </option>
            <option value="1%">
              1%
            </option>
            <option value="0%">
              0%
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">购买方</label>
          <input v-model="addForm.buyer" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">供应商（销方）</label>
          <input v-model="addForm.seller" class="field-input w-full" placeholder="供应商名称">
        </div>
        <div>
          <label class="field-label">不含税金额</label>
          <input v-model.number="addForm.amount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">税额</label>
          <input v-model.number="addForm.taxAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">价税合计</label>
          <input v-model.number="addForm.totalAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">对应项目</label>
          <input v-model="addForm.projectName" class="field-input w-full" placeholder="项目名称" list="invoice-project-names">
          <datalist id="invoice-project-names">
            <option v-for="p in projectStore.list" :key="p.id" :value="p.name" />
          </datalist>
        </div>
        <div>
          <label class="field-label">发票归属</label>
          <select v-model="addForm.ownerKindLabel" class="field-input w-full">
            <option value="暂不归属">
              暂不归属（先录入，台账页再归档）
            </option>
            <option :value="OWNER_KIND_LABEL.project">
              {{ OWNER_KIND_LABEL.project }}
            </option>
            <option :value="OWNER_KIND_LABEL.personal">
              {{ OWNER_KIND_LABEL.personal }}
            </option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="field-label">票面备注</label>
          <input v-model="addForm.remark" class="field-input w-full" placeholder="备注信息">
        </div>
      </div>
    </FormDialog>

    <!-- ═══ 编辑发票弹窗 ═══ -->
    <FormDialog
      :open="showEditDialog"
      title="编辑发票"
      save-label="保存"
      width="min(640px, 95vw)"
      @save="handleEdit"
      @cancel="showEditDialog = false"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">票据类型</label>
          <select v-model="editForm.invoiceType" class="field-input w-full">
            <option value="增值税专用发票">
              增值税专用发票
            </option>
            <option value="增值税普通发票">
              增值税普通发票
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">发票号码</label>
          <input v-model="editForm.invoiceNumber" class="field-input w-full font-mono">
        </div>
        <div>
          <label class="field-label">开票日期</label>
          <input v-model="editForm.invoiceDate" type="date" class="field-input w-full font-mono">
        </div>
        <div>
          <label class="field-label">税率</label>
          <select v-model="editForm.taxRate" class="field-input w-full">
            <option value="13%">
              13%
            </option>
            <option value="9%">
              9%
            </option>
            <option value="6%">
              6%
            </option>
            <option value="3%">
              3%
            </option>
            <option value="1%">
              1%
            </option>
            <option value="0%">
              0%
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">购买方</label>
          <input v-model="editForm.buyer" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">供应商（销方）</label>
          <input v-model="editForm.seller" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">不含税金额</label>
          <input v-model.number="editForm.amount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">税额</label>
          <input v-model.number="editForm.taxAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">价税合计</label>
          <input v-model.number="editForm.totalAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">对应项目</label>
          <input v-model="editForm.projectName" class="field-input w-full">
        </div>
        <div class="col-span-2">
          <label class="field-label">票面备注</label>
          <input v-model="editForm.remark" class="field-input w-full">
        </div>
      </div>
    </FormDialog>
  </div>
</template>
