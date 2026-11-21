<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import type { QuantityMatrixCell, QuantityMatrixViewMode, QuantityOption } from '~/lib/quantity/matrix'
import type { QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import type { DataOriginDTO } from '~/types/read-model'
import { onActivated, onDeactivated } from 'vue'
import PayrollACreateFromQuantity from '~/components/payroll/PayrollACreateFromQuantity.vue'
import PayrollASourceReturn from '~/components/payroll/PayrollASourceReturn.vue'
import QuantityAssignmentDialog from '~/components/quantity/QuantityAssignmentDialog.vue'
import QuantityBatchCompletionDialog from '~/components/quantity/QuantityBatchCompletionDialog.vue'
import QuantityCommandRecovery from '~/components/quantity/QuantityCommandRecovery.vue'

import QuantityCompletionDialog from '~/components/quantity/QuantityCompletionDialog.vue'
import QuantityProgressCards from '~/components/quantity/QuantityProgressCards.vue'
import QuantityToolbar from '~/components/quantity/QuantityToolbar.vue'
import QuantityVarianceDialog from '~/components/quantity/QuantityVarianceDialog.vue'
import QuantityWorkspace from '~/components/quantity/QuantityWorkspace.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { payrollSourceQuery } from '~/lib/payroll/a-navigation'
import { createQuantityCategoryExport, createQuantityLedgerExport } from '~/lib/quantity/export'
import {
  ALL_QUANTITY_FILTER,
  buildQuantityMatrix,
  quantityAssigneeOptions,
  quantityMonthOptions,
  quantityTradeOptions,
} from '~/lib/quantity/matrix'
import { buildQuantityFilterQuery, quantityMatrixReturnPath, readQuantityFilterQuery, readQuantityOrigin } from '~/lib/quantity/navigation'
import { buildScheduleReturnLocation, parseScheduleDrillContext, scheduleSourceQuery, validateScheduleDrillContext } from '~/lib/schedule/navigation'
import { toErrorMessage } from '~/lib/util/error'

const store = useQuantityStore()
const productionAccess = useProductionAccessStore()
const scheduleStore = useScheduleStore()
const route = useRoute()
const router = useRouter()
const { confirm, error: toastError, exportFile, formModal, openImportTab, success, warning } = useKitUI()

const projectId = shallowRef('')
const origin = shallowRef<DataOriginDTO>('real')
const sourceError = shallowRef('')
const projectSelection = computed({
  get: () => JSON.stringify([origin.value, projectId.value]),
  set: (key: string) => {
    const project = store.catalog.find(row => JSON.stringify([row.dataOrigin, row.id]) === key)
    if (project) {
      origin.value = project.dataOrigin
      projectId.value = project.id
    }
  },
})
const buildingId = shallowRef('')
const month = shallowRef(ALL_QUANTITY_FILTER)
const viewMode = shallowRef<QuantityMatrixViewMode>('trade')
const trade = shallowRef(ALL_QUANTITY_FILTER)
const assigneeKey = shallowRef(ALL_QUANTITY_FILTER)
const initialized = shallowRef(false)
const assignmentDialogOpen = shallowRef(false)
const assignmentInitialUnitId = shallowRef('')
const assignmentInitialTrade = shallowRef(ALL_QUANTITY_FILTER)
const completionDialogOpen = shallowRef(false)
const completionUnitId = shallowRef('')
const completionInitialStageId = shallowRef('')
const batchCompletionDialogOpen = shallowRef(false)
const varianceDialogOpen = shallowRef(false)
const boqLineId = computed(() => String(route.query.boqLine ?? ''))
const fromBoq = computed(() => Boolean(boqLineId.value))

const scheduleContext = computed(() => parseScheduleDrillContext(route.query))
const scheduleReturnTo = computed(() => scheduleContext.value
  ? buildScheduleReturnLocation({ ...scheduleContext.value, filters: quantityFilterQuery() })
  : '/schedule')
const scheduleSourceLabel = computed(() => scheduleContext.value?.source === 'home'
  ? '来自首页施工进度'
  : '来自施工排程')
const scheduleReturnLabel = computed(() => scheduleContext.value?.source === 'home'
  ? '返回首页该工序'
  : '返回该工序')

const projectOptions = computed<QuantityOption[]>(() => store.catalog.map(project => ({
  key: JSON.stringify([project.dataOrigin, project.id]),
  label: `${project.name}${project.code ? ` · ${project.code}` : ''}${project.dataOrigin === 'demo' ? ' · 演示' : ''}`,
})))

const snapshot = computed(() => !sourceError.value && store.snapshot?.projectId === projectId.value && store.dataOrigin === origin.value ? store.snapshot : null)
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
    buildingIds: scheduleContext.value?.buildingIds,
    month: month.value,
    viewMode: viewMode.value,
    trade: trade.value,
    assigneeKey: assigneeKey.value,
    stageId: scheduleContext.value?.stageId || undefined,
  })
})

function normalizeFilters(next: QuantityProjectSnapshot, reset = false, restoreScheduleContext = false) {
  const requestedBuildingId = restoreScheduleContext ? scheduleContext.value?.buildingId : ''
  if (requestedBuildingId && next.buildings.some(building => building.id === requestedBuildingId))
    buildingId.value = requestedBuildingId
  else if (reset || !next.buildings.some(building => building.id === buildingId.value))
    buildingId.value = next.buildings[0]?.id ?? ''

  const months = quantityMonthOptions(next)
  const requestedMonth = restoreScheduleContext ? scheduleContext.value?.planStart.slice(0, 7) : ''
  if (requestedMonth && months.some(option => option.key === requestedMonth))
    month.value = requestedMonth
  else if (reset || !months.some(option => option.key === month.value))
    month.value = ALL_QUANTITY_FILTER

  const trades = quantityTradeOptions(next)
  const requestedStage = restoreScheduleContext
    ? next.stages.find(stage => stage.id === scheduleContext.value?.stageId)
    : null
  if (requestedStage && trades.some(option => option.key === requestedStage.trade))
    trade.value = requestedStage.trade
  else if (reset || !trades.some(option => option.key === trade.value))
    trade.value = ALL_QUANTITY_FILTER

  const assignees = quantityAssigneeOptions(next)
  if (reset || !assignees.some(option => option.key === assigneeKey.value))
    assigneeKey.value = ALL_QUANTITY_FILTER
}

async function loadSelectedProject(reset = false, restoreScheduleContext = false) {
  const requestedProject = projectId.value
  const requestedOrigin = origin.value
  await store.loadProject(requestedProject, requestedOrigin)
  if (requestedProject === projectId.value && requestedOrigin === origin.value && store.snapshot?.projectId === requestedProject)
    normalizeFilters(store.snapshot, reset, restoreScheduleContext)
}

let initializeSequence = 0
let active = true
let activated = false
async function initialize() {
  const sequence = ++initializeSequence
  initialized.value = false
  sourceError.value = ''
  if ((route.query.from === 'schedule' || route.query.from === 'home') && !scheduleContext.value) {
    sourceError.value = '排程来源参数无效，请从原工序重新打开'
    initialized.value = true
    return
  }
  const requestedOrigin = readQuantityOrigin(route.query)
  if (!requestedOrigin) {
    sourceError.value = '工程量来源无效，请从项目列表重新打开'
    initialized.value = true
    return
  }
  await store.loadCatalog()
  if (sequence !== initializeSequence || !active)
    return
  const requestedProjectId = scheduleContext.value?.projectId ?? String(route.query.project ?? '')
  const choices = store.catalog.filter(project => project.dataOrigin === requestedOrigin)
  const preferred = requestedProjectId ? choices.find(project => project.id === requestedProjectId) : choices[0]
  origin.value = requestedOrigin
  projectId.value = preferred?.id ?? ''
  if (requestedProjectId && !preferred && !store.error)
    sourceError.value = '当前来源的项目不可用、已删除或无权读取，请重新选择项目'
  if (projectId.value)
    await loadSelectedProject(true, Boolean(scheduleContext.value))
  if (sequence !== initializeSequence || !active)
    return
  if (scheduleContext.value && projectId.value && store.snapshot) {
    try {
      await scheduleStore.loadProject(projectId.value, undefined, requestedOrigin)
      if (sequence !== initializeSequence || !active)
        return
      sourceError.value = validateScheduleDrillContext(scheduleContext.value, scheduleStore.snapshot, store.snapshot)
    }
    catch (cause) {
      if (sequence === initializeSequence && active)
        sourceError.value = `排程来源无法核对：${toErrorMessage(cause)}`
    }
  }
  if (store.snapshot)
    restoreRouteFilters(store.snapshot)
  initialized.value = true
  if (fromBoq.value)
    await openTemplates()
}

watch([projectId, origin], async () => {
  if (!initialized.value || !active)
    return
  sourceError.value = ''
  assignmentDialogOpen.value = false
  completionDialogOpen.value = false
  batchCompletionDialogOpen.value = false
  varianceDialogOpen.value = false
  if (scheduleContext.value && (scheduleContext.value.projectId !== projectId.value || scheduleContext.value.origin !== origin.value)) {
    const query: LocationQueryRaw = { ...route.query, project: projectId.value, origin: origin.value }
    for (const key of ['from', 'group', 'task', 'stage', 'item', 'buildings', 'groupName', 'taskName', 'itemName', 'planStart', 'planFinish'])
      delete query[key]
    await router.replace({ query })
  }
  await loadSelectedProject(true)
})

watch(
  [projectId, origin, buildingId, month, viewMode, trade, assigneeKey],
  () => {
    if (!initialized.value || !active || sourceError.value)
      return
    void router.replace({
      query: {
        ...route.query,
        ...quantityFilterQuery(),
      },
    })
  },
  { flush: 'post' },
)

async function retry() {
  if (!store.catalog.length || sourceError.value)
    await initialize()
  else
    await loadSelectedProject(false)
}

function openAssignments(unitId = '', preferredTrade = trade.value) {
  if (!store.canWrite)
    return
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
  if (!store.canWrite)
    return
  completionUnitId.value = cell.unitId
  completionInitialStageId.value = cell.summary?.stageId ?? ''
  completionDialogOpen.value = true
}

function quantityFilterQuery() {
  return { ...payrollSourceQuery(route.query), ...scheduleSourceQuery(route.query), ...buildQuantityFilterQuery({
    project: projectId.value,
    building: buildingId.value,
    month: month.value,
    view: viewMode.value,
    trade: trade.value,
    assignee: assigneeKey.value,
    origin: origin.value,
  }) }
}

function restoreRouteFilters(next: QuantityProjectSnapshot) {
  const context = readQuantityFilterQuery(route.query)
  const requestedBuilding = context.building ?? ''
  if (requestedBuilding && next.buildings.some(row => row.id === requestedBuilding))
    buildingId.value = requestedBuilding

  const requestedMonth = context.month ?? ''
  if (requestedMonth && quantityMonthOptions(next).some(option => option.key === requestedMonth))
    month.value = requestedMonth

  const requestedView = context.view ?? ''
  if (requestedView === 'trade' || requestedView === 'crew')
    viewMode.value = requestedView

  const requestedTrade = context.trade ?? ''
  if (requestedTrade && quantityTradeOptions(next).some(option => option.key === requestedTrade))
    trade.value = requestedTrade

  const requestedAssignee = context.assignee ?? ''
  if (requestedAssignee && quantityAssigneeOptions(next).some(option => option.key === requestedAssignee))
    assigneeKey.value = requestedAssignee
}

async function openTemplates() {
  if (!projectId.value)
    return
  await router.push({
    path: '/subcontract/quantity/template',
    query: {
      ...quantityFilterQuery(),
      ...(boqLineId.value ? { boqLine: boqLineId.value } : {}),
    },
  })
}

async function openRegions() {
  if (!projectId.value)
    return
  await router.push({
    path: '/subcontract/quantity/region',
    query: { project: projectId.value, origin: origin.value },
  })
}

function openStages() {
  return router.push({ path: '/subcontract/quantity/stages', query: quantityFilterQuery() })
}

async function openUnitDetail(cell: QuantityMatrixCell) {
  await router.push({
    path: `/subcontract/quantity/${projectId.value}/${cell.unitId}`,
    query: quantityFilterQuery(),
  })
}

// 日常三类映射使用当前来源；旧合一行只做迁移预检，不写入。
const IMPORT_TARGETS = [
  { label: '户型模板量', entity: 'quantity-template' },
  { label: '责任配置', entity: 'quantity-assignment' },
  { label: '阶段完成', entity: 'quantity-completion' },
  { label: '旧合一行迁移预检（不写入）', entity: 'quantity-legacy-precheck' },
] as const

async function importData() {
  if (!store.canImport) {
    warning('请先读取具有写入权限的正式工程量项目，再开始导入。')
    return
  }
  const targets = IMPORT_TARGETS.filter(target => target.entity !== 'quantity-legacy-precheck')
  const values = await formModal({
    title: '工程量导入',
    subtitle: '按文件中的项目编码核对正式项目；责任须唯一匹配。缺少验收照片的记录请明确填 draft，稍后到户详情补齐。',
    saveText: '进入映射',
    fields: [{
      key: 'target',
      label: '导入目标',
      type: 'select',
      options: targets.map(target => target.label),
      value: targets[0]!.label,
      required: true,
    }],
  })
  if (!values)
    return
  const target = targets.find(candidate => candidate.label === values.target)
  if (target)
    openImportTab({ entity: target.entity })
}

// 导出读统一派生查询（derived.ts），与页面/工资预览同口径（蓝本§六）。
async function exportLedger() {
  if (!projectId.value)
    return
  const requestedProject = projectId.value
  const requestedOrigin = origin.value
  const requestedSequence = initializeSequence
  const projectName = store.catalog.find(project => project.id === requestedProject && project.dataOrigin === requestedOrigin)?.name ?? ''
  const requireCurrentSource = () => {
    if (!active || requestedProject !== projectId.value || requestedOrigin !== origin.value || requestedSequence !== initializeSequence)
      throw new Error('工程量来源已切换，请从当前矩阵重新导出')
  }
  try {
    await exportFile(createQuantityLedgerExport({
      projectName,
      loadData: async () => {
        requireCurrentSource()
        const { records, stageProgress: progress, monthly } = await store.readExportWorkspace(requestedProject, requestedOrigin)
        requireCurrentSource()
        if (!records.length && !progress.length)
          throw new Error('当前项目还没有可导出的工程量数据')
        return { records, progress, monthly }
      },
    }))
  }
  catch (cause) {
    toastError(`工程量导出失败：${toErrorMessage(cause)}`)
  }
}

async function exportByCategory() {
  if (!projectId.value)
    return
  const requestedProject = projectId.value
  const requestedOrigin = origin.value
  const requestedSequence = initializeSequence
  try {
    const { records } = await store.readExportWorkspace(requestedProject, requestedOrigin)
    if (!active || requestedProject !== projectId.value || requestedOrigin !== origin.value || requestedSequence !== initializeSequence)
      return
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
  if (!projectId.value || !snapshot.value || !store.canWrite)
    return
  const confirmedProjectId = projectId.value
  const confirmedOrigin = origin.value
  const confirmedSnapshot = snapshot.value
  const confirmedSequence = initializeSequence
  const archived = Boolean(confirmedSnapshot.matrixArchivedAt)
  const approved = await confirm({
    variant: 'simple',
    title: archived ? '解除矩阵归档' : '归档工程量矩阵',
    message: archived
      ? '解除归档后，模板、责任与完成事实恢复正常编辑。'
      : '归档后修改户型模板、责任指派或完成事实都需要二次确认，操作日志全程保留。确认归档当前项目矩阵？',
    confirmLabel: archived ? '解除归档' : '确认归档',
  })
  if (!approved || !active || !store.canWrite || projectId.value !== confirmedProjectId
    || origin.value !== confirmedOrigin || snapshot.value !== confirmedSnapshot || initializeSequence !== confirmedSequence) {
    return
  }
  try {
    const logId = archived
      ? await store.unarchiveMatrix(confirmedProjectId)
      : await store.archiveMatrix(confirmedProjectId)
    if (logId)
      success(archived ? '已解除矩阵归档' : '矩阵已归档锁定')
  }
  catch {
    toastError(store.error || '归档操作失败')
  }
}

onMounted(initialize)
onActivated(() => {
  active = true
  if (activated)
    void initialize()
  activated = true
})
onDeactivated(() => {
  active = false
  initializeSequence++
  store.cancelProject()
})
watch(() => [route.query.project, route.query.origin, route.query.from, route.query.group, route.query.task, route.query.stage, route.query.item, route.query.buildings], (next, previous) => {
  if (active && initialized.value && route.path === '/subcontract/quantity'
    && (route.query.project !== projectId.value || readQuantityOrigin(route.query) !== origin.value || next.slice(2).some((value, index) => value !== previous?.[index + 2]))) {
    void initialize()
  }
})
</script>

<template>
  <QuantityCommandRecovery surface="matrix" :project-id="projectId" />
  <QuantityCommandRecovery surface="assignments" :project-id="projectId" />
  <QuantityCommandRecovery surface="batch" :project-id="projectId" />
  <div class="quantity-screen flex min-w-0 flex-col gap-4">
    <NuxtLink v-if="productionAccess.status?.mode === 'production'" to="/subcontract/quantity/import" class="self-start text-12px text-brand">
      工程量原库接管
    </NuxtLink>
    <QuantityToolbar
      v-if="store.catalog.length"
      v-model:project-id="projectSelection"
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
      :can-write="store.canWrite && !sourceError"
      :can-import="store.canImport"
      :active-units="matrix.activeUnits"
      :total-units="matrix.totalUnits"
      :matrix-archived-at="snapshot?.matrixArchivedAt ?? null"
      :schedule-scope-label="scheduleContext?.groupName ?? ''"
      @batch-complete="batchCompletionDialogOpen = true"
      @import-data="importData"
      @export-ledger="exportLedger"
      @export-by-category="exportByCategory"
      @toggle-archive="toggleArchive"
      @manage-regions="openRegions"
      @manage-templates="openTemplates"
      @manage-stages="openStages"
      @view-variance="varianceDialogOpen = true"
      @manage-assignments="openAssignments()"
      @refresh="retry"
    />

    <PayrollASourceReturn v-if="snapshot && route.query.payrollReturnTo" kind="quantity-project" :source-id="projectId" :project-id="projectId" :origin="origin" />
    <PayrollACreateFromQuantity v-if="snapshot && !route.query.payrollReturnTo" :project-id="projectId" :origin="origin" :month="month" :return-to="quantityMatrixReturnPath(buildQuantityFilterQuery({ project: projectId, building: buildingId, month, view: viewMode, trade, assignee: assigneeKey, origin }))" />
    <p v-if="origin === 'demo'" class="panel px-4 py-3 text-12px text-ink-soft" role="status">
      演示工程量只读。切换正式项目后可按权限配置模板、阶段和施工记录。
    </p>

    <section v-if="scheduleContext" class="panel flex flex-wrap items-center gap-3 border-brand/30 bg-brand-soft/35 px-4 py-3">
      <span class="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand-soft text-brand">
        <span class="i-lucide-corner-down-right" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-12px font-800 text-ink">
          {{ scheduleSourceLabel }} · {{ scheduleContext.groupName }}
        </div>
        <div class="truncate text-11px text-ink-soft">
          正在核对「{{ scheduleContext.taskName }}」的工程量完成事实
          <span v-if="scheduleContext.itemName" class="ml-1 rounded bg-panel px-1.5 py-0.5 font-700 text-brand-deep">映射分项：{{ scheduleContext.itemName }}</span>
          <span v-if="scheduleContext.planStart" class="ml-1 font-mono">计划 {{ scheduleContext.planStart }} — {{ scheduleContext.planFinish }}</span>
        </div>
      </div>
      <NuxtLink :to="scheduleReturnTo" class="btn-primary ">
        <span class="i-lucide-arrow-left mr-1" /> {{ scheduleReturnLabel }}
      </NuxtLink>
    </section>

    <section v-else-if="fromBoq" class="panel flex flex-wrap items-center gap-3 border-brand/30 bg-brand-soft/35 px-4 py-3">
      <span class="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand-soft text-brand">
        <span class="i-lucide-calculator" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-12px font-800 text-ink">
          来自合同工程量清单
        </div>
        <div class="truncate text-11px text-ink-soft">
          若该 BOQ 行已唯一命中户型模板，系统会直接定位；可在“三量明细”中维护现场复核算式。
        </div>
      </div>
      <NuxtLink :to="{ path: '/contract/boq', query: { project: projectId } }" class="btn-primary ">
        <span class="i-lucide-arrow-left mr-1" /> 返回合同清单
      </NuxtLink>
    </section>

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
      v-else-if="sourceError || store.error"
      class="panel flex min-h-64 flex-col items-center justify-center gap-3 border-danger/35 px-6 text-center"
      role="alert"
    >
      <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
      <div class="text-14px font-800 text-ink">
        工程量数据暂时无法读取
      </div>
      <p class="max-w-xl text-12px text-ink-soft">
        {{ sourceError || store.error }}
      </p>
      <KitButton type="button" variant="primary" class="" @click="retry">
        重新加载
      </KitButton>
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
      <NuxtLink to="/project" class="btn-primary  mt-1">
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
        这里只展示真实区域数据。先建立楼栋、楼层和户，再继续责任配置或排程。
      </p>
      <KitButton type="button" variant="primary" class=" mt-1" @click="openRegions">
        配置项目区域
      </KitButton>
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
        切换其他楼栋，或补齐当前楼栋下的楼层和户。
      </p>
      <KitButton type="button" variant="primary" class=" mt-1" @click="openRegions">
        配置楼层与户
      </KitButton>
    </section>

    <template v-else-if="snapshot">
      <QuantityProgressCards :progress="store.stageProgress" />
      <QuantityWorkspace
        :matrix="matrix"
        :readonly="!store.canWrite"
        @configure="configureCell"
        @complete="completeCell"
        @detail="openUnitDetail"
      />
    </template>

    <QuantityAssignmentDialog
      v-if="projectId"
      v-model:open="assignmentDialogOpen"
      :project-id="projectId"
      :origin="origin"
      :initial-building-id="buildingId"
      :initial-trade="assignmentInitialTrade"
      :initial-unit-id="assignmentInitialUnitId"
    />

    <QuantityCompletionDialog
      v-if="projectId && completionUnitId"
      v-model:open="completionDialogOpen"
      :project-id="projectId"
      :origin="origin"
      :unit-id="completionUnitId"
      :initial-stage-id="completionInitialStageId"
    />

    <QuantityBatchCompletionDialog
      v-if="projectId"
      v-model:open="batchCompletionDialogOpen"
      :project-id="projectId"
      :origin="origin"
      :initial-building-id="buildingId"
      :initial-trade="trade"
    />

    <QuantityVarianceDialog
      v-if="projectId"
      v-model:open="varianceDialogOpen"
      :project-id="projectId"
      :origin="origin"
      :initial-building-id="buildingId"
    />
  </div>
</template>

<style scoped>
.quantity-screen {
  container-type: inline-size;
  overflow: hidden;
}
</style>
