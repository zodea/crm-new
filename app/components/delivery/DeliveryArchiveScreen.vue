<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { DeliveryRecord } from '~/stores/delivery-record'
import { createDeliveryArchiveZip, DELIVERY_ZIP_MIME } from '~/lib/delivery/export'
import { clampPage, paginate } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const store = useDeliveryRecordStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const contractStore = useContractStore()
const { confirm, error, success, warning, undoToast } = useKitUI()

const search = shallowRef('')
const dateFrom = shallowRef('')
const dateTo = shallowRef('')
const selectedNode = shallowRef('all')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const convertImagesToPdf = shallowRef(false)
const exportingArchive = shallowRef(false)

function projectName(id: string): string {
  return projectStore.byId(id)?.name ?? '未知项目'
}

function supplierName(id: string | null): string {
  return id ? supplierStore.byId(id)?.name ?? '未知分供方' : '未区分分供方'
}

function supplierContractDate(projectId: string, supplierId: string): string {
  return contractStore.list
    .filter(contract => contract.kind === '材采'
      && contract.projectId === projectId
      && contract.supplierId === supplierId
      && contract.signDate)
    .map(contract => contract.signDate)
    .sort()[0] ?? '\uffff'
}

const treeItems = computed<TreeNode[]>(() => [
  { key: 'all', label: '全部送货单', icon: 'i-lucide-archive', count: store.list.length },
  ...projectStore.list
    .map((project) => {
      const records = store.list.filter(record => record.projectId === project.id)
      const supplierIds = [...new Set(records.map(record => record.supplierId))]
      const children = supplierIds
        .sort((a, b) => {
          if (a == null)
            return 1
          if (b == null)
            return -1
          return supplierContractDate(project.id, a).localeCompare(supplierContractDate(project.id, b))
            || supplierName(a).localeCompare(supplierName(b), 'zh-CN')
        })
        .map(supplierId => ({
          key: `supplier:${project.id}:${supplierId ?? 'un'}`,
          label: supplierName(supplierId),
          icon: supplierId ? 'i-lucide-factory' : 'i-lucide-triangle-alert',
          tone: supplierId ? undefined : 'warn' as const,
          count: records.filter(record => record.supplierId === supplierId).length,
        }))
      return {
        key: `project:${project.id}`,
        label: project.name,
        icon: 'i-lucide-building-2',
        count: records.length,
        children,
      }
    })
    .filter(node => node.count > 0),
])

const nodeFiltered = computed(() => {
  if (selectedNode.value === 'all')
    return store.list
  if (selectedNode.value.startsWith('project:')) {
    const projectId = selectedNode.value.slice('project:'.length)
    return store.list.filter(record => record.projectId === projectId)
  }
  const [, projectId, supplierId] = selectedNode.value.split(':')
  return store.list.filter(record =>
    record.projectId === projectId
    && (supplierId === 'un' ? record.supplierId == null : record.supplierId === supplierId),
  )
})

const filtered = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  return nodeFiltered.value.filter(record => [
    record.orderNo,
    record.fileName,
    record.note,
    projectName(record.projectId),
    supplierName(record.supplierId),
    ...record.lines.map(line => `${line.materialName} ${line.spec}`),
  ].some(value => (!keyword || value.toLocaleLowerCase('zh-CN').includes(keyword))
    && (!dateFrom.value || record.deliveryDate >= dateFrom.value)
    && (!dateTo.value || record.deliveryDate <= dateTo.value)))
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate([...filtered.value], currentPage.value, pageSize.value))
const totalAmount = computed(() => filtered.value.reduce((sum, record) => sum + record.totalAmount, 0))

watch([search, dateFrom, dateTo, selectedNode], () => {
  page.value = 1
})

function downloadFile(data: Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function exportArchive() {
  if (!filtered.value.length) {
    error('当前筛选下没有可导出的送货单')
    return
  }
  exportingArchive.value = true
  try {
    const result = await createDeliveryArchiveZip(filtered.value, { projectName, supplierName }, {
      convertImagesToPdf: convertImagesToPdf.value,
      loadSource: record => store.loadSourceFile(record.id),
    })
    downloadFile(result.data, `送货单原件包_${new Date().toISOString().slice(0, 10)}.zip`, DELIVERY_ZIP_MIME)
    success(`送货单原件包已下载，包含 ${result.sources.length} 份原件`)
    if (result.missingRecordIds.length)
      warning(`${result.missingRecordIds.length} 份送货单缺少原件，异常已写入 Excel`)
  }
  catch (cause) {
    error(cause instanceof Error ? `导出失败：${cause.message}` : '导出失败')
  }
  finally {
    exportingArchive.value = false
  }
}

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'orderNo', title: '送货单号', minWidth: 160, fixed: 'left', slot: 'orderNo' },
  { field: 'deliveryDate', title: '送货日期', type: 'date', width: 112 },
  { field: 'hasSourceFile', title: '原件', width: 96, align: 'center', slot: 'source' },
  { field: 'projectId', title: '所属项目', minWidth: 150, slot: 'project' },
  { field: 'supplierId', title: '分供方', minWidth: 200, slot: 'supplier' },
  { field: 'materials', title: '材料明细', minWidth: 220, slot: 'materials' },
  { field: 'totalAmount', title: '金额', type: 'money', width: 130 },
  { field: 'note', title: '备注', minWidth: 160 },
  { title: '操作', type: 'action', width: 126, fixed: 'right' },
]

function materialSummary(record: DeliveryRecord): string {
  const names = record.lines.map(line => line.spec ? `${line.materialName} ${line.spec}` : line.materialName)
  if (names.length <= 2)
    return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`
}

async function handleDelete(record: DeliveryRecord) {
  const label = record.orderNo || record.id
  const ok = await confirm({
    variant: 'simple',
    title: '删除送货单',
    message: `确认删除送货单「${label}」？材料明细会随送货单一同隐藏，10 秒内可撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  const logId = await store.remove(record.id)
  if (!logId) {
    error('删除失败：送货单不存在或已删除')
    return
  }
  undoToast(`已删除送货单「${label}」`, () => store.undo(logId))
}

function onPageChange(event: { page: number, pageSize: number }) {
  page.value = event.page
  pageSize.value = event.pageSize
}

async function refresh() {
  await Promise.all([store.load(), projectStore.load(), supplierStore.load(), contractStore.load()])
}

onMounted(refresh)
</script>

<template>
  <div class="delivery-archive-screen flex min-w-0 flex-col gap-4">
    <div class="delivery-archive__toolbar panel flex items-center gap-3 px-4 py-3">
      <div class="min-w-0">
        <div class="text-16px font-800 text-ink">
          送货单归档库
        </div>
        <div class="mt-0.5 text-12px text-ink-faint">
          手工录入 · 项目 → 分供方 · 详情与材料明细
        </div>
      </div>
      <div class="delivery-archive__actions ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
        <SearchInput
          v-model="search"
          class="delivery-archive__search max-w-full"
          placeholder="搜索单号、项目、分供方、材料"
          :width="288"
        />
        <label class="inline-flex items-center gap-1.5 text-11px text-ink-soft">
          <span>从</span>
          <input v-model="dateFrom" type="date" class="field-input h-8 text-11px" aria-label="开始日期">
        </label>
        <label class="inline-flex items-center gap-1.5 text-11px text-ink-soft">
          <span>至</span>
          <input v-model="dateTo" type="date" class="field-input h-8 text-11px" aria-label="结束日期">
        </label>
        <button class="btn-secondary" :disabled="store.loading" @click="refresh">
          <span class="i-lucide-refresh-cw mr-1 text-13px" /> 刷新
        </button>
        <label class="inline-flex items-center gap-1.5 text-11px text-ink-soft" title="勾选后另行生成仅含图片原件的 PDF；PDF 原件始终整份原样保留，不参与当前图片合并">
          <input v-model="convertImagesToPdf" type="checkbox">
          <span>图片另生成 PDF</span>
        </label>
        <button class="btn-secondary" :disabled="store.loading || exportingArchive || !filtered.length" @click="exportArchive">
          <span class="i-lucide-file-archive mr-1 text-13px" /> {{ exportingArchive ? '正在生成…' : '导出原件包' }}
        </button>
        <NuxtLink to="/material/delivery/archive/form" class="btn-accent">
          <span class="i-lucide-plus mr-1 text-13px" /> 新增送货单
        </NuxtLink>
      </div>
    </div>

    <div class="delivery-archive__layout flex items-start gap-3">
      <ArchiveScopePicker v-model="selectedNode" class="delivery-archive__mobile-scope" :items="treeItems" />

      <div class="delivery-archive__desktop-tree w-64 shrink-0">
        <TreeNav v-model="selectedNode" title="归档库 · 项目 → 分供方" :items="treeItems" />
      </div>

      <div class="min-w-0 flex-1">
        <KitTable
          data-testid="delivery-archive-table"
          :columns="columns"
          :data="pageRows"
          :loading="store.loading"
          :page="{ page: currentPage, pageSize, total: filtered.length }"
          empty="当前节点暂无送货单"
          @page-change="onPageChange"
        >
          <template #orderNo="{ row }">
            <NuxtLink :to="`/material/delivery/archive/${row.id}`" class="cell--link font-mono">
              {{ row.orderNo || '未编号送货单' }}
            </NuxtLink>
          </template>
          <template #project="{ row }">
            <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
              {{ projectName(row.projectId) }}
            </NuxtLink>
          </template>
          <template #supplier="{ row }">
            <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
              {{ supplierName(row.supplierId) }}
            </NuxtLink>
            <span v-else class="chip-warn">未区分分供方</span>
          </template>
          <template #materials="{ row }">
            <span :title="row.lines.map(line => `${line.materialName} ${line.spec}`).join('、')">
              {{ materialSummary(row) }}
            </span>
          </template>
          <template #source="{ row }">
            <span v-if="row.hasSourceFile" class="chip-ok">可核对</span>
            <span v-else class="chip-danger">缺原件</span>
          </template>
          <template #action="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink
                :to="`/material/delivery/archive/${row.id}`"
                class="icon-btn"
                title="详情"
                :aria-label="`查看送货单 ${row.orderNo || row.id}`"
              >
                <span class="i-lucide-file-text text-14px" />
              </NuxtLink>
              <NuxtLink
                :to="`/material/delivery/archive/form/${row.id}`"
                class="icon-btn"
                title="编辑"
                :aria-label="`编辑送货单 ${row.orderNo || row.id}`"
              >
                <span class="i-lucide-square-pen text-14px" />
              </NuxtLink>
              <button
                class="icon-btn-danger"
                title="删除"
                :aria-label="`删除送货单 ${row.orderNo || row.id}`"
                @click="handleDelete(row)"
              >
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </KitTable>

        <div class="mt-2 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 rounded-[var(--radius-card)] bg-surface-2 px-4 py-2 text-12px text-ink-soft">
          <span>当前筛选：<b class="font-mono text-ink">{{ filtered.length }}</b> 份</span>
          <span>金额合计：<b class="font-mono text-ink">{{ yuan(totalAmount) }}</b></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.delivery-archive-screen {
  container-type: inline-size;
}

.delivery-archive__mobile-scope {
  display: none;
}

@container (max-width: 59.999rem) {
  .delivery-archive__layout {
    display: block;
  }

  .delivery-archive__desktop-tree {
    display: none;
  }

  .delivery-archive__mobile-scope {
    display: block;
    margin-bottom: 0.75rem;
  }
}

@container (max-width: 47.999rem) {
  .delivery-archive__toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .delivery-archive__actions {
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }

  .delivery-archive__search {
    min-width: min(100%, 16rem);
    flex: 1 1 16rem;
  }

  .delivery-archive__search :deep(input) {
    width: 100% !important;
    max-width: 100%;
  }
}

@container (max-width: 31rem) {
  .delivery-archive__search {
    flex-basis: 100%;
    width: 100%;
  }

  .delivery-archive__actions > :deep(button) {
    flex: 1 1 auto;
  }
}
</style>
