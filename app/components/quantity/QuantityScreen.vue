<script setup lang="ts">
import type { QuantityMatrixCell, QuantityMatrixViewMode, QuantityOption } from '~/lib/quantity/matrix'
import type { QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import {
  ALL_QUANTITY_FILTER,
  buildQuantityMatrix,
  quantityAssigneeOptions,
  quantityMonthOptions,
  quantityTradeOptions,
} from '~/lib/quantity/matrix'

const store = useQuantityStore()

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

    <QuantityWorkspace
      v-else-if="snapshot"
      :matrix="matrix"
      @configure="configureCell"
    />

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
  </div>
</template>

<style scoped>
.quantity-screen {
  container-type: inline-size;
  overflow: hidden;
}
</style>
