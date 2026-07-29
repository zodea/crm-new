<script setup lang="ts">
import type { ScheduleOverlapMode } from '~/lib/schedule/planning'
import { calendarDays, planTemplateTasks } from '~/lib/schedule/planning'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

interface TaskDraft {
  templateKey: string
  enabled: boolean
  durationDays: number
  anchorStart: string | null
}

type WizardStep = 1 | 2 | 3

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()
const { confirm, error, success } = useKitUI()

const projectId = shallowRef('')
const contractId = shallowRef('')
const scopeBasis = shallowRef<'contract' | 'provisional'>('contract')
const processLibraryId = shallowRef('')
const name = ref('精装修楼栋组')
const startDate = shallowRef(toLocalDateInputValue())
const overlapMode = shallowRef<ScheduleOverlapMode>('half')
const buildingIds = ref<string[]>([])
const tasks = ref<TaskDraft[]>([])
const initialized = shallowRef(false)
const loadingRange = shallowRef(false)
const currentStep = shallowRef<WizardStep>(1)

const templateByKey = computed(() => new Map(store.processTasks.map(template => [template.key, template])))
const plannedRows = computed(() => planTemplateTasks(startDate.value, overlapMode.value, tasks.value.map(task => ({
  key: task.templateKey,
  enabled: task.enabled,
  durationDays: task.durationDays,
  anchorStart: task.anchorStart,
}))))
const planByKey = computed(() => new Map(plannedRows.value.map(row => [row.key, row])))
const enabledCount = computed(() => tasks.value.filter(task => task.enabled).length)
const finishDate = computed(() => plannedRows.value.map(row => row.plannedFinish).sort().at(-1) ?? '—')
const projectOptions = computed(() => store.catalog.map(project => ({
  key: project.id,
  label: `${project.name}${project.code ? ` · ${project.code}` : ''}`,
})))
const contractOptions = computed(() => store.contracts.map(contract => ({
  key: contract.id,
  label: `${contract.name}${contract.no ? ` · ${contract.no}` : ''} · ${contract.lineCount} 条清单`,
})))
const processLibraryOptions = computed(() => store.processLibraries.map(library => ({
  key: library.id,
  label: `${library.name} · v${library.version} · ${library.taskCount} 道`,
})))
const activeProcessLibrary = computed(() =>
  store.processLibraries.find(library => library.id === processLibraryId.value),
)
const coverageSummary = computed(() => ({
  contract: store.buildingCoverage.filter(building => building.inContract).length,
  scheduled: store.buildingCoverage.filter(building => building.inContract && building.scheduled).length,
  available: store.buildingCoverage.filter(building => building.inContract && !building.scheduled).length,
  outside: store.buildingCoverage.filter(building => !building.inContract).length,
}))
const outsideBuildingNames = computed(() => store.buildingCoverage
  .filter(building => !building.inContract)
  .map(building => building.name)
  .join('、'))
const wizardSteps = [
  { step: 1, label: '确定范围', hint: '项目、依据与楼栋' },
  { step: 2, label: '调整工序', hint: '工序库、工期与日期' },
  { step: 3, label: '预览生成', hint: '核对范围与计划' },
] as const

function rangeValidationMessage(): string | null {
  if (!projectId.value || !name.value.trim())
    return '请选择项目并填写分组名称'
  if (scopeBasis.value === 'contract' && !contractId.value)
    return '合同清单排程必须选择一份施工合同'
  if (!buildingIds.value.length)
    return '请至少选择一栋楼'
  return null
}

function processValidationMessage(): string | null {
  if (!processLibraryId.value)
    return '请选择标准工序库'
  if (!startDate.value)
    return '请选择计划开始日期'
  if (!enabledCount.value)
    return '请至少启用一道工序'
  return null
}

function nextStep() {
  const validation = currentStep.value === 1
    ? rangeValidationMessage()
    : processValidationMessage()
  if (validation) {
    error(validation)
    return
  }
  if (currentStep.value < 3)
    currentStep.value = (currentStep.value + 1) as WizardStep
}

function previousStep() {
  if (currentStep.value > 1)
    currentStep.value = (currentStep.value - 1) as WizardStep
}

function predecessorLabel(templateKey: string): string {
  const index = plannedRows.value.findIndex(row => row.key === templateKey)
  if (index <= 0)
    return '—'
  const predecessor = plannedRows.value[index - 1]!
  const successor = plannedRows.value[index]!
  const predecessorName = templateByKey.value.get(predecessor.key)?.name ?? '前置工序'
  const lag = calendarDays(predecessor.plannedFinish, successor.plannedStart)
  return `${predecessorName} · FS${lag ? `${lag > 0 ? '+' : ''}${lag}天` : ''}`
}

async function loadRange(reset = true) {
  loadingRange.value = true
  try {
    await store.loadContracts(projectId.value)
    if (reset) {
      contractId.value = store.contracts.find(contract => contract.lineCount > 0)?.id
        ?? store.contracts[0]?.id
        ?? ''
      scopeBasis.value = contractId.value ? 'contract' : 'provisional'
    }
    await store.loadBuildings(
      projectId.value,
      scopeBasis.value === 'contract' ? contractId.value : '',
    )
    if (reset)
      buildingIds.value = store.buildings.map(building => building.id)
  }
  finally {
    loadingRange.value = false
  }
}

function resetProcessTasks() {
  tasks.value = store.processTasks.map(template => ({
    templateKey: template.key,
    enabled: true,
    durationDays: template.durationDays,
    anchorStart: null,
  }))
}

watch(projectId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  await loadRange(true)
})

watch(contractId, async (next, previous) => {
  if (
    !initialized.value
    || loadingRange.value
    || scopeBasis.value !== 'contract'
    || !next
    || next === previous
  ) {
    return
  }
  await store.loadBuildings(projectId.value, next)
  buildingIds.value = store.buildings.map(building => building.id)
})

watch(scopeBasis, async (next, previous) => {
  if (!initialized.value || loadingRange.value || next === previous)
    return
  loadingRange.value = true
  try {
    if (next === 'contract') {
      contractId.value = contractId.value
        || store.contracts.find(contract => contract.lineCount > 0)?.id
        || store.contracts[0]?.id
        || ''
    }
    else {
      contractId.value = ''
    }
    await store.loadBuildings(projectId.value, next === 'contract' ? contractId.value : '')
    buildingIds.value = store.buildings.map(building => building.id)
  }
  finally {
    loadingRange.value = false
  }
})

watch(processLibraryId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  await store.loadProcessLibraryTasks(next)
  resetProcessTasks()
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
  const validation = rangeValidationMessage() ?? processValidationMessage()
  if (validation) {
    error(validation)
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
      scopeBasis: scopeBasis.value,
      contractId: scopeBasis.value === 'contract' ? contractId.value : null,
      processLibraryId: processLibraryId.value,
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
  await Promise.all([store.loadCatalog(), store.loadProcessLibraries()])
  processLibraryId.value = store.processLibraries.find(library => library.isDefault)?.id
    ?? store.processLibraries[0]?.id
    ?? ''
  if (processLibraryId.value) {
    await store.loadProcessLibraryTasks(processLibraryId.value)
    resetProcessTasks()
  }
  const requested = String(route.query.project ?? '')
  projectId.value = store.catalog.find(project => project.id === requested)?.id ?? store.catalog[0]?.id ?? ''
  if (projectId.value)
    await loadRange(true)
  initialized.value = true
})
</script>

<template>
  <div class="schedule-new flex min-w-0 flex-col gap-4">
    <header class="panel flex items-center gap-3 p-4">
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
    </header>

    <nav class="wizard-stepper panel" aria-label="新建排程步骤">
      <div
        v-for="item in wizardSteps"
        :key="item.step"
        class="wizard-step"
        :class="{
          'is-active': currentStep === item.step,
          'is-complete': currentStep > item.step,
        }"
        :aria-current="currentStep === item.step ? 'step' : undefined"
      >
        <span class="wizard-step__index">
          {{ currentStep > item.step ? '✓' : item.step }}
        </span>
        <span class="min-w-0">
          <b>{{ item.label }}</b>
          <small>{{ item.hint }}</small>
        </span>
      </div>
    </nav>

    <section
      v-if="currentStep === 1"
      class="panel mx-auto w-full max-w-5xl p-4 sm:p-5"
      data-schedule-wizard-step="1"
    >
      <header>
        <h2 class="text-15px font-850 text-ink">
          确定排程范围
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          先确定项目、合同或内部暂估依据和楼栋；工序放到下一步处理。
        </p>
      </header>
      <div class="range-grid mt-5">
        <div class="grid content-start gap-4">
          <div>
            <span class="field-label block">项目</span>
            <SelectFilter v-model="projectId" aria-label="项目" :options="projectOptions" :min-width="210" placeholder="选择项目" />
          </div>
          <label>
            <span class="field-label block">分组名称</span>
            <input v-model="name" class="field-input w-full" maxlength="80">
          </label>
          <fieldset>
            <legend class="field-label">
              范围依据
            </legend>
            <div class="mt-1 grid gap-2 sm:grid-cols-2">
              <label class="scope-option" :class="scopeBasis === 'contract' && 'is-active'">
                <input v-model="scopeBasis" type="radio" value="contract" class="accent-[var(--brand)]">
                <span><b>合同清单</b><small>按已确认清单控范围</small></span>
              </label>
              <label class="scope-option" :class="scopeBasis === 'provisional' && 'is-active'">
                <input v-model="scopeBasis" type="radio" value="provisional" class="accent-[var(--brand)]">
                <span><b>内部暂估</b><small>合同未签也可先排计划</small></span>
              </label>
            </div>
          </fieldset>
          <div v-if="scopeBasis === 'contract'">
            <span class="field-label block">施工合同</span>
            <SelectFilter v-model="contractId" aria-label="施工合同" :options="contractOptions" :min-width="210" placeholder="选择施工合同" />
            <span v-if="!store.contracts.length" class="mt-1 block text-11px text-danger">
              当前项目尚未配置施工合同。
            </span>
            <span v-else-if="store.contracts.every(contract => !contract.lineCount)" class="mt-1 block text-11px text-warning">
              合同尚未导入清单；请先拆表确认楼栋范围后再建组。
            </span>
          </div>
          <div v-else class="rounded-lg border border-warning/30 bg-warning/8 p-3 text-11px text-ink-soft">
            <b class="block text-warning">待绑定合同</b>
            范围读取项目手工楼栋，工程量读取户型模板暂估量，不会标记为合同确认值。
            <NuxtLink
              :to="{ path: '/subcontract/quantity', query: { project: projectId || undefined } }"
              class="mt-1 block font-700 text-brand hover:underline"
            >
              打开工程量管理，维护暂估量 →
            </NuxtLink>
          </div>
        </div>

        <fieldset class="min-w-0 rounded-lg border border-line p-3">
          <legend class="px-1 text-12px font-800 text-ink">
            楼栋范围
          </legend>
          <div v-if="scopeBasis === 'contract' && store.buildingCoverage.length" class="flex flex-wrap gap-1.5 text-10px">
            <span class="chip-brand">合同范围 {{ coverageSummary.contract }}</span>
            <span class="chip-ok">未纳入 {{ coverageSummary.available }}</span>
            <span class="chip">已纳入 {{ coverageSummary.scheduled }}</span>
            <span v-if="coverageSummary.outside" class="chip-warn">超合同范围 {{ coverageSummary.outside }}</span>
          </div>
          <div v-if="store.buildings.length" class="building-grid mt-2 max-h-92 overflow-y-auto pr-1">
            <label v-for="building in store.buildings" :key="building.id" class="flex min-w-0 items-center gap-2 rounded px-2 py-2 text-12px hover:bg-surface-2">
              <input :checked="buildingIds.includes(building.id)" type="checkbox" class="shrink-0 accent-[var(--brand)]" @change="toggleBuilding(building.id)">
              <span class="min-w-0 truncate">{{ building.name }}</span>
              <span class="shrink-0 text-ink-faint">{{ building.code }}</span>
            </label>
          </div>
          <p v-else class="mt-2 text-11px text-danger">
            {{ scopeBasis === 'contract'
              ? '清单未提供可验证的显式楼栋范围，或合同范围已全部纳入排程。'
              : '当前项目尚未维护可用楼栋，或楼栋已全部纳入排程。' }}
          </p>
          <p v-if="scopeBasis === 'contract' && outsideBuildingNames" class="mt-2 text-10px text-ink-faint">
            项目库中不属于本合同：{{ outsideBuildingNames }}
          </p>
        </fieldset>
      </div>
    </section>

    <section
      v-else-if="currentStep === 2"
      class="panel min-w-0 overflow-hidden"
      data-schedule-wizard-step="2"
    >
      <header class="border-b border-line px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-15px font-850 text-ink">
              调整标准工序
            </h2>
            <p class="mt-1 text-11px text-ink-soft">
              可停用、改工期或指定锚点；日期和 FS 前置会实时重算。
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <SelectFilter
              v-model="processLibraryId"
              aria-label="标准工序库"
              :options="processLibraryOptions"
              :min-width="210"
              placeholder="选择标准工序库"
            />
            <button type="button" class="btn-ghost" @click="toggleAllTasks(true)">
              全选
            </button>
            <button type="button" class="btn-ghost" @click="toggleAllTasks(false)">
              清空
            </button>
          </div>
        </div>
        <div class="process-options mt-4">
          <label>
            <span class="field-label block">计划开始</span>
            <input v-model="startDate" type="date" class="field-input w-full">
          </label>
          <fieldset>
            <legend class="field-label">
              工序搭接
            </legend>
            <div class="mt-1 flex flex-wrap gap-3">
              <label
                v-for="option in [
                  { key: 'half', label: '半程搭接' },
                  { key: 'seq', label: '完全顺排' },
                  { key: 'same', label: '同步开工' },
                ]"
                :key="option.key"
                class="flex items-center gap-2 text-12px text-ink-soft"
              >
                <input v-model="overlapMode" type="radio" :value="option.key" class="accent-[var(--brand)]">
                {{ option.label }}
              </label>
            </div>
          </fieldset>
          <div class="rounded-lg bg-brand-soft px-3 py-2 text-11px text-brand-deep">
            {{ activeProcessLibrary?.name ?? '标准工序' }} · 已启用 {{ enabledCount }} 道 · 预计完成 {{ finishDate }}
          </div>
        </div>
      </header>
      <div class="process-scroll overflow-x-auto" data-testid="schedule-new-process-scroll">
        <div class="process-table min-w-760px">
          <div class="process-row process-head">
            <span>启用</span><span>工序</span><span>工种</span><span>工期(天)</span><span>锚点开始</span><span>FS 前置</span><span>计划日期</span>
          </div>
          <div v-for="task in tasks" :key="task.templateKey" class="process-row">
            <input v-model="task.enabled" type="checkbox" class="accent-[var(--brand)]" :aria-label="`启用${templateByKey.get(task.templateKey)?.name}`">
            <span class="min-w-0 truncate font-700 text-ink"><i class="mr-2 inline-block h-2 w-2 rounded-full" :style="{ background: templateByKey.get(task.templateKey)?.color }" />{{ templateByKey.get(task.templateKey)?.name }}</span>
            <span>{{ templateByKey.get(task.templateKey)?.trade }}</span>
            <input v-model.number="task.durationDays" type="number" min="1" max="365" class="field-input w-20" :disabled="!task.enabled">
            <input v-model="task.anchorStart" type="date" class="field-input w-34" :disabled="!task.enabled">
            <span class="truncate" :title="predecessorLabel(task.templateKey)">
              {{ task.enabled ? predecessorLabel(task.templateKey) : '—' }}
            </span>
            <span>{{ planByKey.get(task.templateKey)?.plannedStart ?? '—' }}<br><small>{{ planByKey.get(task.templateKey)?.plannedFinish ?? '—' }}</small></span>
          </div>
        </div>
      </div>
    </section>

    <section
      v-else
      class="panel mx-auto w-full max-w-6xl overflow-hidden"
      data-schedule-wizard-step="3"
    >
      <header class="border-b border-line px-4 py-4 sm:px-5">
        <h2 class="text-15px font-850 text-ink">
          预览并生成排程
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          最后核对数据依据、楼栋数量、工序顺序和日期；此页不会自动保存。
        </p>
      </header>
      <div class="summary-grid p-4 sm:p-5">
        <div><span>范围依据</span><strong>{{ scopeBasis === 'contract' ? '合同清单' : '内部暂估' }}</strong></div>
        <div><span>楼栋分组</span><strong>{{ name }}</strong></div>
        <div><span>楼栋数量</span><strong>{{ buildingIds.length }} 栋</strong></div>
        <div><span>标准工序</span><strong>{{ enabledCount }} 道</strong></div>
        <div><span>计划开始</span><strong>{{ startDate }}</strong></div>
        <div><span>预计完成</span><strong>{{ finishDate }}</strong></div>
      </div>
      <p
        v-if="scopeBasis === 'provisional'"
        class="mx-4 mb-4 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-11px text-warning sm:mx-5"
      >
        当前为内部暂估排程，生成后保持“待绑定合同”；后续绑定时先核对楼栋、分项与数量差异。
      </p>
      <div class="preview-scroll overflow-x-auto" data-testid="schedule-new-preview-scroll">
        <table class="min-w-720px">
          <thead>
            <tr>
              <th>#</th>
              <th>工序</th>
              <th>工种</th>
              <th>工期</th>
              <th>FS 前置</th>
              <th>计划开始</th>
              <th>计划完成</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in plannedRows" :key="row.key">
              <td>{{ index + 1 }}</td>
              <td class="font-700 text-ink">
                {{ templateByKey.get(row.key)?.name }}
              </td>
              <td>{{ templateByKey.get(row.key)?.trade }}</td>
              <td class="font-mono">
                {{ row.durationDays }} 天
              </td>
              <td>{{ predecessorLabel(row.key) }}</td>
              <td class="font-mono">
                {{ row.plannedStart }}
              </td>
              <td class="font-mono">
                {{ row.plannedFinish }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="wizard-actions panel">
      <button v-if="currentStep > 1" type="button" class="btn-ghost" @click="previousStep">
        上一步
      </button>
      <span v-else />
      <button v-if="currentStep < 3" type="button" class="btn-primary" @click="nextStep">
        {{ currentStep === 1 ? '下一步：选择工序' : '下一步：预览排程' }}
      </button>
      <button v-else type="button" class="btn-accent" :disabled="store.saving" @click="submit">
        <span v-if="store.saving" class="i-lucide-loader-circle mr-1 animate-spin" />
        生成排程
      </button>
    </footer>
  </div>
</template>

<style scoped>
.schedule-new { container-type: inline-size; overflow: hidden; }
.wizard-stepper { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; }
.wizard-step { position: relative; display: flex; min-width: 0; align-items: center; gap: 10px; padding: 12px 16px; color: var(--ink-faint); }
.wizard-step:not(:last-child)::after { position: absolute; top: 50%; right: -4px; z-index: 1; width: 8px; height: 8px; border-top: 1px solid var(--line); border-right: 1px solid var(--line); background: var(--panel); content: ''; transform: translateY(-50%) rotate(45deg); }
.wizard-step__index { display: grid; width: 26px; height: 26px; flex: 0 0 auto; place-items: center; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; font-weight: 800; }
.wizard-step b, .wizard-step small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wizard-step b { color: var(--ink-soft); font-size: 12px; }
.wizard-step small { margin-top: 2px; font-size: 10px; }
.wizard-step.is-active { background: var(--brand-soft); }
.wizard-step.is-active .wizard-step__index { border-color: var(--brand); background: var(--brand); color: white; }
.wizard-step.is-active b { color: var(--brand-deep); }
.wizard-step.is-complete .wizard-step__index { border-color: var(--ok); color: var(--ok); }
.range-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(18rem, 1.1fr); gap: 24px; }
.building-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.scope-option { display: flex; min-width: 0; cursor: pointer; align-items: flex-start; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; color: var(--ink-soft); }
.scope-option.is-active { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.scope-option b, .scope-option small { display: block; }
.scope-option small { margin-top: 2px; color: var(--ink-faint); font-size: 10px; line-height: 1.35; }
.process-options { display: grid; grid-template-columns: 180px minmax(260px, 1fr) auto; align-items: end; gap: 16px; }
.process-row { display: grid; grid-template-columns: 42px minmax(210px, 1.4fr) 76px 86px 142px minmax(150px, 1fr) 126px; align-items: center; min-height: 42px; gap: 8px; border-bottom: 1px solid var(--line); padding: 6px 12px; color: var(--ink-soft); font-size: 11px; }
.process-row > :nth-child(n+4) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.process-head { min-height: 34px; background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.summary-grid div { display: grid; gap: 4px; border-radius: 8px; background: var(--surface-2); padding: 12px; }
.summary-grid span { color: var(--ink-faint); font-size: 10px; }
.summary-grid strong { min-width: 0; overflow: hidden; color: var(--ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.preview-scroll table { width: 100%; border-collapse: collapse; font-size: 11px; }
.preview-scroll th, .preview-scroll td { height: 40px; border-bottom: 1px solid var(--line); padding: 0 12px; text-align: left; white-space: nowrap; }
.preview-scroll th { background: var(--surface-2); color: var(--ink-faint); font-size: 10px; }
.wizard-actions { position: sticky; bottom: 12px; z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; box-shadow: 0 8px 28px rgb(15 23 42 / 12%); }
@container (max-width: 48rem) {
  .range-grid { grid-template-columns: minmax(0, 1fr); }
  .process-options { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 30rem) {
  .wizard-step { justify-content: center; padding: 10px 6px; }
  .wizard-step small { display: none; }
  .wizard-step__index { width: 22px; height: 22px; }
  .building-grid, .summary-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
