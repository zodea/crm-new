<script setup lang="ts">
import type { QuantityMatrixCell, QuantityMatrixViewMode, QuantityOption } from '~/lib/quantity/matrix'
import type { QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import { db } from '~/lib/db/client'
import {
  loadQuantityConstructionRecords,
  loadQuantityMonthlyOutput,
  loadQuantityStageProgress,
} from '~/lib/quantity/derived'
import { createQuantityCategoryExport, createQuantityLedgerExport } from '~/lib/quantity/export'
import {
  ALL_QUANTITY_FILTER,
  buildQuantityMatrix,
  quantityAssigneeOptions,
  quantityMonthOptions,
  quantityTradeOptions,
} from '~/lib/quantity/matrix'
import { toErrorMessage } from '~/lib/util/error'

const store = useQuantityStore()
const { confirm, error: toastError, exportFile, formModal, openImportTab, success, warning } = useKitUI()

const projectId = shallowRef('')
const buildingId = shallowRef('')
const month = shallowRef(ALL_QUANTITY_FILTER)
const viewMode = shallowRef<QuantityMatrixViewMode>('trade')
const trade = shallowRef(ALL_QUANTITY_FILTER)
const assigneeKey = shallowRef(ALL_QUANTITY_FILTER)
const initialized = shallowRef(false)
const templateDialogOpen = shallowRef(false)
const assignmentDialogOpen = shallowRef(false)
const assignmentInitialUnitId = shallowRef('')
const assignmentInitialTrade = shallowRef(ALL_QUANTITY_FILTER)
const completionDialogOpen = shallowRef(false)
const completionUnitId = shallowRef('')
const completionInitialStageId = shallowRef('')
const batchCompletionDialogOpen = shallowRef(false)

const projectOptions = computed<QuantityOption[]>(() => store.catalog.map(project => ({
  key: project.id,
  label: project.code ? `${project.name} · ${project.code}` : project.name,
})))

const snapshot = computed(() => store.snapshot)
const buildingOptions = computed<QuantityOption[]>(() => (snapshot.value?.buildings ?? []).map(building => ({
  key: building.id,
  label: building.name,
})))
const monthOptions = computed(() => snapshot.value ? quantityMonthOptions(snapshot.value) : [])
const tradeOptions = computed(() => snapshot.value ? quantityTradeOptions(snapshot.value) : [])
const assigneeOptions = computed(() => snapshot.value ? quantityAssigneeOptions(snapshot.value) : [])

const matrix = computed(() => {
  if (!snapshot.value) {
    return {
      columns: [],
      rows: [],
      positions: [],
      totalUnits: 0,
      activeUnits: 0,
    }
  }
  return buildQuantityMatrix(snapshot.value, {
    buildingId: buildingId.value,
    month: month.value,
    viewMode: viewMode.value,
    trade: trade.value,
    assigneeKey: assigneeKey.value,
  })
})

function normalizeFilters(next: QuantityProjectSnapshot, reset = false) {
  if (reset || !next.buildings.some(building => building.id === buildingId.value))
    buildingId.value = next.buildings[0]?.id ?? ''

  const months = quantityMonthOptions(next)
  if (reset || !months.some(option => option.key === month.value))
    month.value = ALL_QUANTITY_FILTER

  const trades = quantityTradeOptions(next)
  if (reset || !trades.some(option => option.key === trade.value))
    trade.value = ALL_QUANTITY_FILTER

  const assignees = quantityAssigneeOptions(next)
  if (reset || !assignees.some(option => option.key === assigneeKey.value))
    assigneeKey.value = ALL_QUANTITY_FILTER
}

async function loadSelectedProject(reset = false) {
  const requestedProject = projectId.value
  await store.loadProject(requestedProject)
  if (store.snapshot?.projectId === requestedProject)
    normalizeFilters(store.snapshot, reset)
}

async function initialize() {
  initialized.value = false
  await store.loadCatalog()
  const preferred = store.catalog.find(project => project.hasQuantityData) ?? store.catalog[0]
  projectId.value = preferred?.id ?? ''
  if (projectId.value)
    await loadSelectedProject(true)
  initialized.value = true
}

watch(projectId, async (next, previous) => {
  if (!initialized.value || next === previous)
    return
  await loadSelectedProject(true)
})

async function retry() {
  if (!store.catalog.length)
    await initialize()
  else
    await loadSelectedProject(false)
}

function openAssignments(unitId = '', preferredTrade = trade.value) {
  assignmentInitialUnitId.value = unitId
  assignmentInitialTrade.value = preferredTrade
  assignmentDialogOpen.value = true
}

function configureCell(cell: QuantityMatrixCell): void {
  const preferredTrade = trade.value !== ALL_QUANTITY_FILTER
    ? trade.value
    : cell.summary?.stageTrade ?? cell.assignments[0]?.trade ?? ALL_QUANTITY_FILTER
  openAssignments(cell.unitId, preferredTrade)
}

function completeCell(cell: QuantityMatrixCell): void {
  completionUnitId.value = cell.unitId
  completionInitialStageId.value = cell.summary?.stageId ?? ''
  completionDialogOpen.value = true
}

// 导入走 ADR 0005 映射页签：三类目标 + 旧合一行迁移预检（蓝本§六）。
const IMPORT_TARGETS = [
  { label: '户型模板量', entity: 'quantity-template' },
  { label: '责任配置', entity: 'quantity-assignment' },
  { label: '阶段完成', entity: 'quantity-completion' },
  { label: '旧合一行迁移预检（不写入）', entity: 'quantity-legacy-precheck' },
] as const

async function importData() {
  const values = await formModal({
    title: '工程量导入',
    subtitle: '选择导入目标后进入映射页签；旧合一行只做迁移预检，不会写入。',
    saveText: '进入映射',
    fields: [{
      key: 'target',
      label: '导入目标',
      type: 'select',
      options: IMPORT_TARGETS.map(target => target.label),
      value: IMPORT_TARGETS[0].label,
      required: true,
    }],
  })
  if (!values)
    return
  const target = IMPORT_TARGETS.find(candidate => candidate.label === values.target)
  if (target)
    openImportTab({ entity: target.entity })
}

// 导出读统一派生查询（derived.ts），与页面/工资预览同口径（蓝本§六）。
async function exportLedger() {
  if (!projectId.value)
    return
  try {
    const [records, progress, monthly] = await Promise.all([
      loadQuantityConstructionRecords(db, projectId.value),
      loadQuantityStageProgress(db, projectId.value),
      loadQuantityMonthlyOutput(db, projectId.value),
    ])
    if (!records.length && !progress.length) {
      warning('当前项目还没有可导出的工程量数据')
      return
    }
    const projectName = store.catalog.find(project => project.id === projectId.value)?.name ?? ''
    await exportFile(createQuantityLedgerExport({ projectName, records, progress, monthly }))
  }
  catch (cause) {
    toastError(`工程量导出失败：${toErrorMessage(cause)}`)
  }
}

async function exportByCategory() {
  if (!projectId.value)
    return
  try {
    const records = await loadQuantityConstructionRecords(db, projectId.value)
    if (!records.length) {
      warning('当前项目还没有施工记录可分类导出')
      return
    }
    await exportFile(createQuantityCategoryExport(records))
  }
  catch (cause) {
    toastError(`工程量导出失败：${toErrorMessage(cause)}`)
  }
}

// 归档锁定/解除都要二次确认并落 projects 操作日志（蓝本§六）。
async function toggleArchive() {
  if (!projectId.value || !snapshot.value)
    return
  const archived = Boolean(snapshot.value.matrixArchivedAt)
  const approved = await confirm({
    variant: 'simple',
    title: archived ? '解除矩阵归档' : '归档工程量矩阵',
    message: archived
      ? '解除归档后，模板、责任与完成事实恢复正常编辑。'
      : '归档后修改户型模板、责任指派或完成事实都需要二次确认，操作日志全程保留。确认归档当前项目矩阵？',
    confirmLabel: archived ? '解除归档' : '确认归档',
  })
  if (!approved)
    return
  try {
    const logId = archived
      ? await store.unarchiveMatrix(projectId.value)
      : await store.archiveMatrix(projectId.value)
    if (logId)
      success(archived ? '已解除矩阵归档' : '矩阵已归档锁定')
  }
  catch {
    toastError(store.error || '归档操作失败')
  }
}

onMounted(initialize)
</script>

<template>
  <div class="quantity-screen flex min-w-0 flex-col gap-4">
    <QuantityToolbar
      v-if="store.catalog.length"
      v-model:project-id="projectId"
      v-model:building-id="buildingId"
      v-model:month="month"
      v-model:view-mode="viewMode"
      v-model:trade="trade"
      v-model:assignee-key="assigneeKey"
      :project-options="projectOptions"
      :building-options="buildingOptions"
      :month-options="monthOptions"
      :trade-options="tradeOptions"
      :assignee-options="assigneeOptions"
      :loading="store.loading"
      :active-units="matrix.activeUnits"
      :total-units="matrix.totalUnits"
      :matrix-archived-at="snapshot?.matrixArchivedAt ?? null"
      @batch-complete="batchCompletionDialogOpen = true"
      @import-data="importData"
      @export-ledger="exportLedger"
      @export-by-category="exportByCategory"
      @toggle-archive="toggleArchive"
      @manage-templates="templateDialogOpen = true"
      @manage-assignments="openAssignments()"
      @refresh="retry"
    />

    <section
      v-if="(!initialized || store.loading) && !snapshot"
      class="panel flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"
      role="status"
      aria-busy="true"
    >
      <span class="i-lucide-loader-circle animate-spin text-24px text-brand" aria-hidden="true" />
      <div class="text-13px font-700 text-ink">
        正在读取工程量矩阵…
      </div>
    </section>

    <section
      v-else-if="store.error"
      class="panel flex min-h-64 flex-col items-center justify-center gap-3 border-danger/35 px-6 text-center"
      role="alert"
    >
      <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
      <div class="text-14px font-800 text-ink">
        工程量数据暂时无法读取
      </div>
      <p class="max-w-xl text-12px text-ink-soft">
        {{ store.error }}
      </p>
      <button type="button" class="btn-primary" @click="retry">
        重新加载
      </button>
    </section>

    <section
      v-else-if="!store.catalog.length"
      class="panel flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <span class="i-lucide-building-2 text-24px text-ink-faint" aria-hidden="true" />
      <div class="text-14px font-800 text-ink">
        尚无可用项目
      </div>
      <p class="text-12px text-ink-soft">
        请先建立项目，再配置楼栋、楼层、户与户型模板。
      </p>
      <NuxtLink to="/project" class="btn-primary mt-1">
        前往项目列表
      </NuxtLink>
    </section>

    <section
      v-else-if="snapshot && !snapshot.buildings.length"
      class="panel flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <span class="i-lucide-grid-2x-2-x text-24px text-ink-faint" aria-hidden="true" />
      <div class="text-14px font-800 text-ink">
        当前项目尚未配置楼栋和户
      </div>
      <p class="text-12px text-ink-soft">
        这里只展示真实区域数据，不在组件内补 mock 矩阵。
      </p>
    </section>

    <section
      v-else-if="snapshot && !matrix.totalUnits"
      class="panel flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <span class="i-lucide-house-plug text-24px text-ink-faint" aria-hidden="true" />
      <div class="text-14px font-800 text-ink">
        当前楼栋尚未配置楼层和户
      </div>
      <p class="text-12px text-ink-soft">
        切换其他楼栋，或在后续区域配置入口补齐结构。
      </p>
    </section>

    <template v-else-if="snapshot">
      <QuantityProgressCards :progress="store.stageProgress" />
      <QuantityWorkspace
        :project-id="projectId"
        :matrix="matrix"
        @configure="configureCell"
        @complete="completeCell"
      />
    </template>

    <QuantityTemplateDialog
      v-if="projectId"
      v-model:open="templateDialogOpen"
      :project-id="projectId"
    />

    <QuantityAssignmentDialog
      v-if="projectId"
      v-model:open="assignmentDialogOpen"
      :project-id="projectId"
      :initial-building-id="buildingId"
      :initial-trade="assignmentInitialTrade"
      :initial-unit-id="assignmentInitialUnitId"
    />

    <QuantityCompletionDialog
      v-if="projectId && completionUnitId"
      v-model:open="completionDialogOpen"
      :project-id="projectId"
      :unit-id="completionUnitId"
      :initial-stage-id="completionInitialStageId"
    />

    <QuantityBatchCompletionDialog
      v-if="projectId"
      v-model:open="batchCompletionDialogOpen"
      :project-id="projectId"
      :initial-building-id="buildingId"
      :initial-trade="trade"
    />
  </div>
</template>

<style scoped>
.quantity-screen {
  container-type: inline-size;
  overflow: hidden;
}
</style>
