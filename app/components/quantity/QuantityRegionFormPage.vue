<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { onActivated, onDeactivated } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import KitButton from '~/components/ui/KitButton.vue'
import { confirmQuantityRegionLeave } from '~/lib/quantity/region'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  returnSource?: 'quantity' | 'schedule'
  resumeSchedule?: boolean
  origin?: DataOriginDTO | null
}>()

const store = useQuantityStore()
const router = useRouter()
const { confirm, error, success, warning } = useKitUI()

const selectedBuildingId = shallowRef('')
const selectedFloorId = shallowRef('')
const buildingDraft = reactive({ code: '', name: '' })
const floorDraft = reactive({ code: '', name: '' })
const unitDraft = reactive({ code: '', name: '', templateId: '' })
const savingKind = shallowRef<'building' | 'floor' | 'unit' | null>(null)
const resumeFailed = shallowRef(false)
let active = true

const workspace = computed(() => props.origin !== null && store.regionOrigin === (props.origin ?? 'real') && store.regionWorkspace?.projectId === props.projectId
  ? store.regionWorkspace
  : null)
const buildings = computed(() => workspace.value?.buildings ?? [])
const floors = computed(() => (workspace.value?.floors ?? [])
  .filter(floor => floor.buildingId === selectedBuildingId.value))
const units = computed(() => (workspace.value?.units ?? [])
  .filter(unit => unit.floorId === selectedFloorId.value))
const templates = computed(() => workspace.value?.templates ?? [])
const selectedBuilding = computed(() =>
  buildings.value.find(building => building.id === selectedBuildingId.value) ?? null)
const selectedFloor = computed(() =>
  floors.value.find(floor => floor.id === selectedFloorId.value) ?? null)
const matrixPath = computed(() => ({
  path: '/subcontract/quantity',
  query: { project: props.projectId, origin: props.origin ?? 'real' },
}))
const schedulePath = computed(() => ({
  path: '/schedule/new',
  query: {
    project: props.projectId,
    resume: props.resumeSchedule ? 'region' : undefined,
    origin: props.origin ?? 'real',
  },
}))
const backPath = computed(() => props.returnSource === 'schedule'
  ? schedulePath.value
  : matrixPath.value)
const templatePath = computed(() => ({
  path: '/subcontract/quantity/template',
  query: {
    project: props.projectId,
    return: 'region',
    origin: props.origin ?? 'real',
    from: props.returnSource === 'schedule' ? 'schedule' : undefined,
    resume: props.resumeSchedule ? 'region' : undefined,
  },
}))
const hasDraft = computed(() => [
  buildingDraft.code,
  buildingDraft.name,
  floorDraft.code,
  floorDraft.name,
  unitDraft.code,
  unitDraft.name,
].some(value => value.trim()))
const shellState = computed(() => {
  if (!props.projectId || props.origin === null)
    return 'error'
  if (store.regionLoading && !workspace.value)
    return 'loading'
  if (store.regionError && !workspace.value)
    return 'error'
  return 'ready'
})
const shellDescription = computed(() => props.origin === null
  ? '工程量来源无效，请从项目列表重新打开。'
  : props.projectId
    ? store.regionError
    : '请从工程量管理选择项目后再配置区域。')
const locked = computed(() => !store.regionCanWrite || Boolean(workspace.value?.matrixArchivedAt))

function normalizeSelection() {
  if (!buildings.value.some(building => building.id === selectedBuildingId.value))
    selectedBuildingId.value = buildings.value[0]?.id ?? ''
  if (!floors.value.some(floor => floor.id === selectedFloorId.value))
    selectedFloorId.value = floors.value[0]?.id ?? ''
  if (!templates.value.some(template => template.id === unitDraft.templateId))
    unitDraft.templateId = templates.value[0]?.id ?? ''
}

async function initialize() {
  resumeFailed.value = false
  if (!props.projectId || props.origin === null)
    return
  try {
    await store.loadRegion(props.projectId, props.origin ?? 'real')
    normalizeSelection()
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

watch(() => [props.projectId, props.origin], () => {
  if (active)
    void initialize()
}, { immediate: true })
watch([buildings, floors, templates], normalizeSelection)
watch(selectedBuildingId, () => {
  selectedFloorId.value = floors.value[0]?.id ?? ''
})

async function createBuilding() {
  if (locked.value)
    return warning('工程量矩阵已归档，请先回到工程量管理解除归档')
  savingKind.value = 'building'
  try {
    const id = await store.createRegionBuilding(props.projectId, buildingDraft)
    selectedBuildingId.value = id
    selectedFloorId.value = ''
    buildingDraft.code = ''
    buildingDraft.name = ''
    success('楼栋已新增')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
  finally {
    savingKind.value = null
  }
}

async function createFloor() {
  if (!selectedBuildingId.value)
    return warning('请先新增或选择楼栋')
  if (locked.value)
    return warning('工程量矩阵已归档，请先回到工程量管理解除归档')
  savingKind.value = 'floor'
  try {
    const id = await store.createRegionFloor(props.projectId, selectedBuildingId.value, floorDraft)
    selectedFloorId.value = id
    floorDraft.code = ''
    floorDraft.name = ''
    success('楼层已新增')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
  finally {
    savingKind.value = null
  }
}

async function createUnit() {
  if (!selectedFloorId.value)
    return warning('请先新增或选择楼层')
  if (!unitDraft.templateId)
    return warning('请先建立户型模板')
  if (locked.value)
    return warning('工程量矩阵已归档，请先回到工程量管理解除归档')
  savingKind.value = 'unit'
  try {
    await store.createRegionUnit(props.projectId, selectedFloorId.value, unitDraft)
    unitDraft.code = ''
    unitDraft.name = ''
    success('户已新增，可返回工程量矩阵或继续建立排程')
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
  finally {
    savingKind.value = null
  }
}

async function beforeLeave() {
  if (store.regionSaving)
    return false
  const approved = await confirmQuantityRegionLeave(hasDraft.value, () => confirm({
    variant: 'simple',
    title: '放弃未提交的区域输入',
    message: '当前楼栋、楼层或户还有尚未提交的内容，确认离开？',
    confirmLabel: '放弃输入',
  }))
  if (approved) {
    buildingDraft.code = ''
    buildingDraft.name = ''
    floorDraft.code = ''
    floorDraft.name = ''
    unitDraft.code = ''
    unitDraft.name = ''
  }
  return approved
}
onBeforeRouteLeave(beforeLeave)
onBeforeRouteUpdate(beforeLeave)
let activated = false
async function resumePermissions() {
  try {
    if (await store.revalidateRegion())
      resumeFailed.value = false
  }
  catch {
    resumeFailed.value = true
  }
}
onActivated(async () => {
  active = true
  if (activated) {
    if (hasDraft.value)
      await resumePermissions()
    else
      await initialize()
  }
  activated = true
})
onDeactivated(() => {
  active = false
  store.cancelRegion()
})

useTabTitle(() => workspace.value
  ? `${workspace.value.projectName} · 区域配置`
  : '项目区域配置')
</script>

<template>
  <QuantityCommandRecovery surface="region" :project-id="projectId" />
  <EntityFormShell
    data-testid="quantity-region-form"
    title="项目区域配置"
    subtitle="按楼栋 → 楼层 → 户建立施工范围；合同不是前置条件，户必须挂靠本项目户型模板。"
    :back-label="returnSource === 'schedule' ? '返回新建排程' : '返回工程量矩阵'"
    :sections="[
      { key: 'building', label: '楼栋' },
      { key: 'floor', label: '楼层' },
      { key: 'unit', label: '户' },
    ]"
    :state="shellState"
    state-title="项目区域加载失败"
    :state-description="shellDescription"
    state-action-label="重新加载"
    @back="router.push(backPath)"
    @state-action="initialize"
  >
    <template #status>
      <span v-if="workspace" class="chip-brand">
        {{ workspace.projectName }}<template v-if="workspace.projectCode"> · {{ workspace.projectCode }}</template>
      </span>
      <span v-if="workspace?.matrixArchivedAt" class="status-warn">矩阵已归档</span>
      <span v-else-if="origin === 'demo'" class="status-warn">演示数据只读</span>
      <span v-else-if="workspace && !store.regionCanWrite" class="status-warn">当前只读权限</span>
    </template>

    <template #actions>
      <NuxtLink :to="matrixPath" class="btn-secondary ">
        打开工程量矩阵
      </NuxtLink>
      <NuxtLink
        v-if="workspace?.units.length"
        :to="schedulePath"
        class="btn-primary "
      >
        新建楼栋分组
      </NuxtLink>
    </template>

    <div v-if="resumeFailed" class="panel flex flex-wrap items-center gap-2 p-4 text-12px text-danger" role="alert">
      <span>{{ store.regionError || '当前权限暂时无法读取，输入已保留。' }}</span>
      <KitButton variant="secondary" @click="resumePermissions">
        重新核验权限
      </KitButton>
    </div>
    <div v-if="workspace" class="grid min-w-0 gap-4 lg:grid-cols-3">
      <section id="section-building" class="panel min-w-0 p-4">
        <header class="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 class="m-0 text-14px font-800 text-ink">
              1. 楼栋
            </h2>
            <p class="m-0 mt-1 text-11px text-ink-faint">
              {{ buildings.length }} 栋
            </p>
          </div>
          <span class="i-lucide-building-2 text-20px text-brand" aria-hidden="true" />
        </header>

        <div class="mb-4 grid max-h-52 gap-2 overflow-y-auto" aria-label="楼栋列表">
          <KitButton
            v-for="building in buildings"
            :key="building.id"
            type="button"
            class="flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left"
            :class="building.id === selectedBuildingId ? 'border-brand bg-brand-soft' : 'border-line bg-panel hover:border-line-strong'"
            @click="selectedBuildingId = building.id"
          >
            <span class="min-w-0">
              <b class="block truncate text-12px text-ink">{{ building.name }}</b>
              <span class="block truncate font-mono text-10px text-ink-faint">{{ building.code }}</span>
            </span>
            <span v-if="building.id === selectedBuildingId" class="i-lucide-check text-brand" aria-hidden="true" />
          </KitButton>
          <p v-if="!buildings.length" class="m-0 rounded bg-canvas px-3 py-4 text-center text-11px text-ink-faint">
            先新增第一栋楼
          </p>
        </div>

        <form class="grid gap-2 border-t border-line pt-3" @submit.prevent="createBuilding">
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            楼栋编码
            <input v-model.trim="buildingDraft.code" class="field-input w-full" placeholder="如 1#">
          </label>
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            显示名称
            <input v-model.trim="buildingDraft.name" class="field-input w-full" placeholder="如 1栋">
          </label>
          <KitButton type="submit" variant="primary" class=" justify-center" :disabled="locked || store.regionSaving">
            {{ savingKind === 'building' ? '正在新增…' : '新增楼栋' }}
          </KitButton>
        </form>
      </section>

      <section id="section-floor" class="panel min-w-0 p-4">
        <header class="mb-3 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="m-0 text-14px font-800 text-ink">
              2. 楼层
            </h2>
            <p class="m-0 mt-1 truncate text-11px text-ink-faint">
              {{ selectedBuilding?.name || '请先选择楼栋' }} · {{ floors.length }} 层
            </p>
          </div>
          <span class="i-lucide-layers-3 text-20px text-brand" aria-hidden="true" />
        </header>

        <div class="mb-4 grid max-h-52 gap-2 overflow-y-auto" aria-label="楼层列表">
          <KitButton
            v-for="floor in floors"
            :key="floor.id"
            type="button"
            class="flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left"
            :class="floor.id === selectedFloorId ? 'border-brand bg-brand-soft' : 'border-line bg-panel hover:border-line-strong'"
            @click="selectedFloorId = floor.id"
          >
            <span class="min-w-0">
              <b class="block truncate text-12px text-ink">{{ floor.name }}</b>
              <span class="block truncate font-mono text-10px text-ink-faint">{{ floor.code }}</span>
            </span>
            <span v-if="floor.id === selectedFloorId" class="i-lucide-check text-brand" aria-hidden="true" />
          </KitButton>
          <p v-if="!floors.length" class="m-0 rounded bg-canvas px-3 py-4 text-center text-11px text-ink-faint">
            {{ selectedBuilding ? '在当前楼栋新增楼层' : '先新增或选择楼栋' }}
          </p>
        </div>

        <form class="grid gap-2 border-t border-line pt-3" @submit.prevent="createFloor">
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            楼层编码
            <input v-model.trim="floorDraft.code" class="field-input w-full" placeholder="如 1F">
          </label>
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            显示名称
            <input v-model.trim="floorDraft.name" class="field-input w-full" placeholder="如 1层">
          </label>
          <KitButton
            type="submit"
            variant="primary" class=" justify-center"
            :disabled="locked || !selectedBuildingId || store.regionSaving"
          >
            {{ savingKind === 'floor' ? '正在新增…' : '新增楼层' }}
          </KitButton>
        </form>
      </section>

      <section id="section-unit" class="panel min-w-0 p-4">
        <header class="mb-3 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="m-0 text-14px font-800 text-ink">
              3. 户
            </h2>
            <p class="m-0 mt-1 truncate text-11px text-ink-faint">
              {{ selectedFloor?.name || '请先选择楼层' }} · {{ units.length }} 户
            </p>
          </div>
          <span class="i-lucide-house text-20px text-brand" aria-hidden="true" />
        </header>

        <div class="mb-4 grid max-h-52 gap-2 overflow-y-auto" aria-label="户列表">
          <div
            v-for="unit in units"
            :key="unit.id"
            class="flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-panel px-3 py-2"
          >
            <span class="min-w-0">
              <b class="block truncate text-12px text-ink">{{ unit.name }}</b>
              <span class="block truncate font-mono text-10px text-ink-faint">{{ unit.code }}</span>
            </span>
            <span class="truncate text-10px text-ink-faint">
              {{ templates.find(template => template.id === unit.templateId)?.name || '户型已删除' }}
            </span>
          </div>
          <p v-if="!units.length" class="m-0 rounded bg-canvas px-3 py-4 text-center text-11px text-ink-faint">
            {{ selectedFloor ? '在当前楼层新增户' : '先新增或选择楼层' }}
          </p>
        </div>

        <div v-if="!templates.length" class="mb-3 rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft p-3 text-11px text-ink-soft">
          当前项目还没有户型模板。先建立模板，再回来给户挂靠。
          <NuxtLink :to="templatePath" class="ml-1 font-700 text-brand-deep underline">
            新建户型模板
          </NuxtLink>
        </div>

        <form class="grid gap-2 border-t border-line pt-3" @submit.prevent="createUnit">
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            户编码
            <input v-model.trim="unitDraft.code" class="field-input w-full" placeholder="如 101">
          </label>
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            显示名称
            <input v-model.trim="unitDraft.name" class="field-input w-full" placeholder="如 101户">
          </label>
          <label class="grid gap-1 text-11px font-700 text-ink-soft">
            户型模板
            <select v-model="unitDraft.templateId" class="field-input w-full">
              <option value="" disabled>
                请选择户型模板
              </option>
              <option v-for="template in templates" :key="template.id" :value="template.id">
                {{ template.name }} · {{ template.code }}
              </option>
            </select>
          </label>
          <KitButton
            type="submit"
            variant="primary" class=" justify-center"
            :disabled="locked || !selectedFloorId || !unitDraft.templateId || store.regionSaving"
          >
            {{ savingKind === 'unit' ? '正在新增…' : '新增户' }}
          </KitButton>
        </form>
      </section>
    </div>

    <p v-if="store.regionError && workspace" class="mt-3 text-11px text-danger" role="alert">
      {{ store.regionError }}
    </p>
  </EntityFormShell>
</template>
