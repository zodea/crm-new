<script setup lang="ts">
import type { ScheduleOverlapMode } from '~/lib/schedule/planning'
import { planTemplateTasks } from '~/lib/schedule/planning'
import { SCHEDULE_TASK_TEMPLATES } from '~/lib/schedule/template'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

interface TaskDraft {
  templateKey: string
  enabled: boolean
  durationDays: number
  anchorStart: string | null
}

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()
const { confirm, error, success } = useKitUI()

const projectId = shallowRef('')
const name = ref('精装修楼栋组')
const startDate = shallowRef(toLocalDateInputValue())
const overlapMode = shallowRef<ScheduleOverlapMode>('half')
const buildingIds = ref<string[]>([])
const tasks = ref<TaskDraft[]>(SCHEDULE_TASK_TEMPLATES.map(template => ({
  templateKey: template.key,
  enabled: true,
  durationDays: template.durationDays,
  anchorStart: null,
})))
const initialized = shallowRef(false)

const templateByKey = new Map(SCHEDULE_TASK_TEMPLATES.map(template => [template.key, template]))
const plannedRows = computed(() => planTemplateTasks(startDate.value, overlapMode.value, tasks.value.map(task => ({
  key: task.templateKey,
  enabled: task.enabled,
  durationDays: task.durationDays,
  anchorStart: task.anchorStart,
}))))
const planByKey = computed(() => new Map(plannedRows.value.map(row => [row.key, row])))
const enabledCount = computed(() => tasks.value.filter(task => task.enabled).length)
const finishDate = computed(() => plannedRows.value.map(row => row.plannedFinish).sort().at(-1) ?? '—')

async function loadBuildings(reset = true) {
  await store.loadBuildings(projectId.value)
  if (reset)
    buildingIds.value = store.buildings.map(building => building.id)
}

watch(projectId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  await loadBuildings(true)
})

function toggleBuilding(id: string) {
  buildingIds.value = buildingIds.value.includes(id)
    ? buildingIds.value.filter(candidate => candidate !== id)
    : [...buildingIds.value, id]
}

function toggleAllTasks(enabled: boolean) {
  tasks.value = tasks.value.map(task => ({ ...task, enabled }))
}

async function submit() {
  if (!projectId.value || !name.value.trim()) {
    error('请选择项目并填写分组名称')
    return
  }
  if (!buildingIds.value.length || !enabledCount.value) {
    error('请至少选择一栋楼和一道工序')
    return
  }
  const projectName = store.catalog.find(project => project.id === projectId.value)?.name ?? ''
  const approved = await confirm({
    variant: 'batch',
    title: '生成楼栋 WBS 排程？',
    message: `${projectName} · ${buildingIds.value.length} 栋楼 · ${enabledCount.value} 道工序，计划完成 ${finishDate.value}。`,
    confirmLabel: '生成排程',
  })
  if (!approved)
    return
  try {
    const groupId = await store.createGroup({
      projectId: projectId.value,
      name: name.value,
      buildingIds: buildingIds.value,
      startDate: startDate.value,
      overlapMode: overlapMode.value,
      tasks: tasks.value,
    })
    success('楼栋排程已生成')
    await router.push({ path: '/schedule', query: { project: projectId.value, group: groupId } })
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

onMounted(async () => {
  await store.loadCatalog()
  const requested = String(route.query.project ?? '')
  projectId.value = store.catalog.find(project => project.id === requested)?.id ?? store.catalog[0]?.id ?? ''
  if (projectId.value)
    await loadBuildings(true)
  initialized.value = true
})
</script>

<template>
  <div class="schedule-new flex min-w-0 flex-col gap-4">
    <header class="panel flex flex-wrap items-center gap-3 p-4">
      <NuxtLink :to="{ path: '/schedule', query: { project: projectId || undefined } }" class="icon-btn" title="返回施工进度">
        <span class="i-lucide-arrow-left" />
      </NuxtLink>
      <div class="min-w-0 flex-1">
        <div class="text-11px font-700 text-brand">
          新建排程
        </div>
        <h1 class="text-18px font-850 text-ink">
          楼栋分组与标准工序
        </h1>
      </div>
      <button type="button" class="btn-accent" :disabled="store.saving" @click="submit">
        <span v-if="store.saving" class="i-lucide-loader-circle mr-1 animate-spin" />
        生成排程
      </button>
    </header>

    <div class="new-layout min-w-0 gap-4">
      <aside class="panel h-fit p-4">
        <h2 class="text-13px font-800 text-ink">
          排程范围
        </h2>
        <div class="mt-4 grid gap-3">
          <label>
            <span class="field-label block">项目</span>
            <select v-model="projectId" class="field-input w-full">
              <option v-for="project in store.catalog" :key="project.id" :value="project.id">{{ project.name }}{{ project.code ? ` · ${project.code}` : '' }}</option>
            </select>
          </label>
          <label>
            <span class="field-label block">分组名称</span>
            <input v-model="name" class="field-input w-full" maxlength="80">
          </label>
          <label>
            <span class="field-label block">计划开始</span>
            <input v-model="startDate" type="date" class="field-input w-full">
          </label>

          <fieldset>
            <legend class="field-label">
              工序搭接
            </legend>
            <label
              v-for="option in [
                { key: 'half', label: '半程搭接' },
                { key: 'seq', label: '完全顺排' },
                { key: 'same', label: '同步开工' },
              ]" :key="option.key" class="mt-1.5 flex items-center gap-2 text-12px text-ink-soft"
            >
              <input v-model="overlapMode" type="radio" :value="option.key" class="accent-[var(--brand)]">
              {{ option.label }}
            </label>
          </fieldset>

          <fieldset>
            <legend class="field-label">
              楼栋范围
            </legend>
            <div v-if="store.buildings.length" class="mt-1 grid max-h-48 gap-1.5 overflow-y-auto pr-1">
              <label v-for="building in store.buildings" :key="building.id" class="flex items-center gap-2 rounded px-1 py-1 text-12px hover:bg-surface-2">
                <input :checked="buildingIds.includes(building.id)" type="checkbox" class="accent-[var(--brand)]" @change="toggleBuilding(building.id)">
                <span>{{ building.name }}</span><span class="text-ink-faint">{{ building.code }}</span>
              </label>
            </div>
            <p v-else class="mt-1 text-11px text-danger">
              当前项目尚未配置楼栋。
            </p>
          </fieldset>
        </div>

        <div class="mt-4 rounded-lg bg-brand-soft p-3 text-11px text-brand-deep">
          已选 {{ buildingIds.length }} 栋 · {{ enabledCount }} 道工序<br>
          预计完成 {{ finishDate }}
        </div>
      </aside>

      <section class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 class="text-13px font-800 text-ink">
              22 道精装修标准工序
            </h2>
            <p class="text-11px text-ink-faint">
              可停用、改工期，或为个别工序指定锚点日期。
            </p>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" @click="toggleAllTasks(true)">
              全选
            </button>
            <button type="button" class="btn-ghost" @click="toggleAllTasks(false)">
              清空
            </button>
          </div>
        </div>
        <div class="process-scroll overflow-x-auto">
          <div class="process-table min-w-760px">
            <div class="process-row process-head">
              <span>启用</span><span>工序</span><span>工种</span><span>工期(天)</span><span>锚点开始</span><span>计划日期</span>
            </div>
            <div v-for="task in tasks" :key="task.templateKey" class="process-row">
              <input v-model="task.enabled" type="checkbox" class="accent-[var(--brand)]" :aria-label="`启用${templateByKey.get(task.templateKey)?.name}`">
              <span class="min-w-0 truncate font-700 text-ink"><i class="mr-2 inline-block h-2 w-2 rounded-full" :style="{ background: templateByKey.get(task.templateKey)?.color }" />{{ templateByKey.get(task.templateKey)?.name }}</span>
              <span>{{ templateByKey.get(task.templateKey)?.trade }}</span>
              <input v-model.number="task.durationDays" type="number" min="1" max="365" class="field-input w-20" :disabled="!task.enabled">
              <input v-model="task.anchorStart" type="date" class="field-input w-34" :disabled="!task.enabled">
              <span>{{ planByKey.get(task.templateKey)?.plannedStart ?? '—' }}<br><small>{{ planByKey.get(task.templateKey)?.plannedFinish ?? '—' }}</small></span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.schedule-new { container-type: inline-size; overflow: hidden; }
.new-layout { display: grid; grid-template-columns: minmax(240px, 26%) minmax(0, 1fr); }
.process-row { display: grid; grid-template-columns: 42px minmax(220px, 1.4fr) 82px 90px 150px 126px; align-items: center; min-height: 42px; gap: 8px; border-bottom: 1px solid var(--line); padding: 6px 12px; color: var(--ink-soft); font-size: 11px; }
.process-head { min-height: 34px; background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
@container (max-width: 48rem) { .new-layout { grid-template-columns: minmax(0, 1fr); } }
</style>
