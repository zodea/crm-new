<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { MaterialContractInput } from '~/lib/material/price-analysis'
import type { DeliveryRecord } from '~/stores/delivery-record'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { readDeliveryMaterialContracts } from '~/lib/delivery-record/material-contracts'
import { createDeliveryArchiveZip, DELIVERY_ZIP_MIME } from '~/lib/delivery/export'
import { clampPage, paginate } from '~/lib/kit/table'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { yuan } from '~/lib/util/money'
import ArchiveScopePicker from '~/pages/material/delivery/archive/_components/ArchiveScopePicker.vue'

const store = useDeliveryRecordStore()
const contractRepository = useNuxtApp().$repositories.materialContractRead
const contractFacts = shallowRef<readonly MaterialContractInput[]>([])
const contractReadError = shallowRef('')
let contractReadController: AbortController | null = null
const { confirm, error, exportFile, warning, undoToast } = useKitUI()
const ready = shallowRef(false)
const readError = shallowRef('')
const reading = shallowRef(false)
const deleting = shallowRef('')
let generation = 0
let active = true
let exportController: AbortController | null = null
const records = computed(() => ready.value && active ? store.list : [])
const projects = computed(() => ready.value ? store.context?.projects ?? [] : [])
const canWrite = computed(() => ready.value && active && store.canWrite)

const search = shallowRef('')
const dateFrom = shallowRef('')
const dateTo = shallowRef('')
const selectedNode = shallowRef('all')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const convertImagesToPdf = shallowRef(false)
const exportingArchive = shallowRef(false)

function projectName(id: string): string {
  return store.context?.projects.find(row => row.id === id)?.name ?? records.value.find(row => row.projectId === id)?.projectName ?? '未知项目'
}

function supplierName(id: string | null): string {
  if (!id)
    return '未区分分供方'
  return store.context?.suppliers.find(row => row.id === id)?.name ?? records.value.find(row => row.supplierId === id)?.supplierName ?? '未知分供方'
}

function entityPath(prefix: string, id = '') {
  return `${prefix}${id ? `/${encodeURIComponent(id)}` : ''}?origin=${store.origin}`
}

function supplierContractDate(projectId: string, supplierId: string): string {
  return contractFacts.value
    .filter(contract => contract.kind === '材采'
      && contract.projectId === projectId
      && contract.supplierId === supplierId
      && contract.signDate)
    .map(contract => contract.signDate)
    .sort()[0] ?? '\uffff'
}

const treeItems = computed<TreeNode[]>(() => [
  { key: 'all', label: '全部送货单', icon: 'i-lucide-archive', count: records.value.length },
  ...projects.value
    .map((project) => {
      const projectRecords = records.value.filter(record => record.projectId === project.id)
      const supplierIds = [...new Set(projectRecords.map(record => record.supplierId))]
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
          key: JSON.stringify(['supplier', project.id, supplierId]),
          label: supplierName(supplierId),
          icon: supplierId ? 'i-lucide-factory' : 'i-lucide-triangle-alert',
          tone: supplierId ? undefined : 'warn' as const,
          count: projectRecords.filter(record => record.supplierId === supplierId).length,
        }))
      return {
        key: JSON.stringify(['project', project.id]),
        label: project.name,
        icon: 'i-lucide-building-2',
        count: projectRecords.length,
        children,
      }
    })
    .filter(node => node.count > 0),
])

const nodeFiltered = computed(() => {
  if (selectedNode.value === 'all')
    return records.value
  try {
    const scope: unknown = JSON.parse(selectedNode.value)
    if (!Array.isArray(scope) || typeof scope[1] !== 'string')
      return []
    if (scope[0] === 'project' && scope.length === 2)
      return records.value.filter(record => record.projectId === scope[1])
    if (scope[0] === 'supplier' && scope.length === 3 && (scope[2] === null || typeof scope[2] === 'string'))
      return records.value.filter(record => record.projectId === scope[1] && record.supplierId === scope[2])
  }
  catch {}
  return []
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

async function exportArchive() {
  if (exportingArchive.value || !ready.value || !active)
    return
  if (!filtered.value.length) {
    error('当前筛选下没有可导出的送货单')
    return
  }
  exportingArchive.value = true
  const controller = new AbortController()
  exportController = controller
  const owner = generation
  const selected = filtered.value.map(record => ({ ...record, lines: record.lines.map(line => ({ ...line })) }))
  const projectNames = new Map(selected.map(record => [record.projectId, projectName(record.projectId)]))
  const supplierNames = new Map(selected.map(record => [record.supplierId, supplierName(record.supplierId)]))
  const ensureActive = () => {
    if (controller.signal.aborted || owner !== generation || !active)
      throw new DOMException('原件包导出已取消', 'AbortError')
  }
  let missingCount = 0
  try {
    const exportResult = await exportFile({
      data: async () => {
        ensureActive()
        const result = await createDeliveryArchiveZip(selected, {
          projectName: id => projectNames.get(id) ?? '未知项目',
          supplierName: id => supplierNames.get(id) ?? '未区分分供方',
        }, {
          convertImagesToPdf: false,
          signal: controller.signal,
          loadSource: record => store.loadSourceFile(record.id, { signal: controller.signal, ...(({ assetId: record.assetId ?? null })) }),
        })
        ensureActive()
        missingCount = result.missingRecordIds.length
        return result.data
      },
      defaultName: `送货单原件包_${toLocalDateInputValue()}.zip`,
      mimeType: DELIVERY_ZIP_MIME,
      signal: controller.signal,
    })
    if (exportResult.status === 'cancelled' || controller.signal.aborted || owner !== generation)
      return
    if (missingCount)
      warning(`${missingCount} 份送货单缺少原件，异常已写入 Excel`)
  }
  catch (cause) {
    if (!controller.signal.aborted && owner === generation && !(cause instanceof Error && cause.name === 'AbortError'))
      error(cause instanceof Error ? `导出失败：${cause.message}` : '导出失败')
  }
  finally {
    if (exportController === controller) {
      exportController = null
      exportingArchive.value = false
    }
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
  if (!canWrite.value || deleting.value)
    return
  const owner = generation
  deleting.value = record.id
  const label = record.orderNo || record.id
  try {
    const ok = await confirm({
      variant: 'simple',
      title: '删除送货单',
      message: `确认删除送货单「${label}」？材料明细会随送货单一同隐藏，10 秒内可撤回。`,
      confirmLabel: '删除',
    })
    if (!ok || owner !== generation || !canWrite.value)
      return
    const logId = await store.remove(record.id)
    if (owner !== generation || !active)
      return
    if (!logId) {
      error('删除失败：送货单不存在或已删除')
      return
    }
    undoToast(`已删除送货单「${label}」`, () => owner === generation && canWrite.value ? store.undo(logId) : Promise.resolve(false))
  }
  catch (cause) {
    if (owner === generation && active)
      error(cause instanceof Error ? cause.message : '删除失败，请重试')
  }
  finally {
    deleting.value = ''
  }
}

function onPageChange(event: { page: number, pageSize: number }) {
  page.value = event.page
  pageSize.value = event.pageSize
}

async function refresh() {
  cancelExport()
  contractReadController?.abort()
  const controller = new AbortController()
  contractReadController = controller
  const owner = ++generation
  reading.value = true
  ready.value = false
  readError.value = ''
  contractFacts.value = []
  contractReadError.value = ''
  try {
    const contractTask = readDeliveryMaterialContracts(contractRepository, store.origin, controller.signal).then((facts) => {
      if (owner === generation && active)
        contractFacts.value = facts
    }).catch((cause) => {
      if (owner === generation && active && !controller.signal.aborted)
        contractReadError.value = cause instanceof Error ? cause.message : '合同日期暂不可读取'
    })
    await Promise.all([store.load(), contractTask])
    if (owner === generation && active)
      ready.value = true
  }
  catch (cause) {
    if (owner === generation && active)
      readError.value = cause instanceof Error ? cause.message : '送货归档读取失败'
  }
  finally {
    if (owner === generation)
      reading.value = false
  }
}

function cancelExport() {
  exportController?.abort()
}
function deactivate() {
  active = false
  generation += 1
  ready.value = false
  reading.value = false
  cancelExport()
  contractReadController?.abort()
  contractFacts.value = []
}

onMounted(refresh)
onActivated(() => {
  if (!active) {
    active = true
    void refresh()
  }
})
onDeactivated(deactivate)
onBeforeUnmount(deactivate)
watch(() => store.origin, () => {
  generation += 1
  ready.value = false
  selectedNode.value = 'all'
  cancelExport()
  if (active)
    void refresh()
}, { flush: 'sync' })
</script>

<template>
  <ListShell continuous class="delivery-archive-screen" data-testid="delivery-archive-list">
    <template #toolbar>
      <div class="delivery-archive__toolbar flex min-w-0 flex-wrap items-center gap-3">
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
          <button class="btn-secondary" :disabled="reading || store.loading" @click="refresh">
            <span class="i-lucide-refresh-cw mr-1 text-13px" /> 刷新
          </button>
          <label class="inline-flex items-center gap-1.5 text-11px text-ink-soft" title="勾选后另行生成仅含图片原件的 PDF；PDF 原件始终整份原样保留，不参与当前图片合并">
            <input v-model="convertImagesToPdf" type="checkbox">
            <span>图片另生成 PDF</span>
          </label>
          <button class="btn-secondary" :disabled="!ready || store.loading || exportingArchive || !filtered.length" @click="exportArchive">
            <span class="i-lucide-file-archive mr-1 text-13px" /> {{ exportingArchive ? '正在生成…' : '导出原件包' }}
          </button>
          <KitButton v-if="exportingArchive" variant="secondary" @click="cancelExport">
            取消导出
          </KitButton>
          <NuxtLink v-if="canWrite" :to="entityPath('/material/delivery/archive/form')" class="btn-accent">
            <span class="i-lucide-plus mr-1 text-13px" /> 新增送货单
          </NuxtLink>
        </div>
      </div>
    </template>

    <template #filters>
      <ArchiveScopePicker v-model="selectedNode" class="delivery-archive__mobile-scope" :items="treeItems" />
    </template>

    <template #table>
      <div v-if="readError" role="alert" class="flex flex-wrap items-center gap-3 px-3 py-2 text-danger">
        <span>{{ readError }}</span>
        <KitButton variant="secondary" @click="refresh">
          重新读取
        </KitButton>
      </div>
      <div v-if="ready && contractReadError" role="status" class="flex flex-wrap items-center gap-3 px-3 py-2 text-warn">
        <span>{{ contractReadError }}。分供方暂按名称排序。</span>
        <KitButton variant="secondary" @click="refresh">
          重新读取合同日期
        </KitButton>
      </div>

      <div class="delivery-archive__layout flex items-start">
        <div class="delivery-archive__desktop-tree w-64 shrink-0 p-2">
          <TreeNav v-model="selectedNode" title="归档库 · 项目 → 分供方" :items="treeItems" />
        </div>

        <div class="min-w-0 flex-1">
          <KitTable
            data-testid="delivery-archive-table"
            :columns="columns"
            :data="pageRows"
            :loading="reading || store.loading"
            :page="{ page: currentPage, pageSize, total: filtered.length }"
            empty="当前节点暂无送货单"
            @page-change="onPageChange"
          >
            <template #orderNo="{ row }">
              <NuxtLink :to="entityPath('/material/delivery/archive', row.id)" class="cell--link font-mono">
                {{ row.orderNo || '未编号送货单' }}
              </NuxtLink>
            </template>
            <template #project="{ row }">
              <NuxtLink :to="entityPath('/project', row.projectId)" class="cell--link">
                {{ projectName(row.projectId) }}
              </NuxtLink>
            </template>
            <template #supplier="{ row }">
              <NuxtLink v-if="row.supplierId" :to="entityPath('/base/supplier', row.supplierId)" class="cell--link">
                {{ supplierName(row.supplierId) }}
              </NuxtLink>
              <KitStatusTag v-else tone="warn">
                未区分分供方
              </KitStatusTag>
            </template>
            <template #materials="{ row }">
              <span :title="row.lines.map(line => `${line.materialName} ${line.spec}`).join('、')">
                {{ materialSummary(row) }}
              </span>
            </template>
            <template #source="{ row }">
              <KitStatusTag :tone="row.hasSourceFile ? 'ok' : 'danger'">
                {{ row.hasSourceFile ? '可核对' : '缺原件' }}
              </KitStatusTag>
            </template>
            <template #action="{ row }">
              <div class="flex items-center gap-1">
                <NuxtLink
                  :to="entityPath('/material/delivery/archive', row.id)"
                  class="icon-btn"
                  title="详情"
                  :aria-label="`查看送货单 ${row.orderNo || row.id}`"
                >
                  <span class="i-lucide-file-text text-14px" />
                </NuxtLink>
                <NuxtLink
                  v-if="canWrite"
                  :to="entityPath('/material/delivery/archive/form', row.id)"
                  class="icon-btn"
                  title="编辑"
                  :aria-label="`编辑送货单 ${row.orderNo || row.id}`"
                >
                  <span class="i-lucide-square-pen text-14px" />
                </NuxtLink>
                <button
                  v-if="canWrite"
                  :disabled="!!deleting"
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
        </div>
      </div>
    </template>

    <template v-if="ready" #summary>
      <div class="ml-auto flex flex-wrap justify-end gap-x-6 gap-y-1">
        <span>当前筛选：<b class="font-mono text-ink">{{ filtered.length }}</b> 份</span>
        <span>金额合计：<b class="font-mono text-ink">{{ yuan(totalAmount) }}</b></span>
      </div>
    </template>
  </ListShell>
</template>

<style scoped>
.delivery-archive-screen {
  container-type: inline-size;
}

.delivery-archive__mobile-scope {
  display: none;
}

@container (min-width: 60rem) {
  .delivery-archive-screen :deep([data-list-shell-filters]) {
    display: none;
  }
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
