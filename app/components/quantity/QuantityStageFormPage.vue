<script setup lang="ts">
import type { QuantityStageDraft, QuantityStageWorkspace } from '~/lib/quantity/central-stages'
import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import QuantityStageFields from '~/components/quantity/QuantityStageFields.vue'
import QuantityStageReporting from '~/components/quantity/QuantityStageReporting.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { parseQuantityStageAction } from '~/lib/quantity/central-stages'
import { useQuantityStageStore } from '~/stores/quantity-stage'

const props = withDefaults(defineProps<{ projectId: string, origin?: DataOriginDTO | null }>(), { origin: 'real' })
const store = useQuantityStageStore()
const router = useRouter()
const feedback = useKitUI()
const draft = ref<QuantityStageDraft | null>(null)
const baseline = ref('')
const reporting = ref<Record<string, string>>({})
const reportingBaseline = ref<Record<string, string>>({})
const retainedReporting = ref<Record<string, string>>({})
const localError = ref('')
let activated = false
let discardOnDeactivate = false
let resumeFailed = false
const query = computed(() => ({ projectId: props.projectId, origin: props.origin ?? 'real', includeDemo: props.origin === 'demo' }))
const workspace = computed(() => store.scope?.projectId === props.projectId && store.scope?.origin === props.origin ? store.workspace : null)
const stageDirty = computed(() => Boolean(draft.value && JSON.stringify(draft.value) !== baseline.value))
const reportingDirty = computed(() => Object.entries(reporting.value).some(([id, value]) => value !== (reportingBaseline.value[id] ?? '')))
const dirty = computed(() => stageDirty.value || reportingDirty.value)
const errorMessage = computed(() => localError.value || store.problem?.message || '')
const shellState = computed(() => store.loading && !workspace.value ? 'loading' : !workspace.value ? 'error' : 'ready')
const returnPath = computed(() => ({ path: '/subcontract/quantity', query: { project: props.projectId, origin: props.origin ?? undefined } }))
const templatePath = computed(() => ({ path: '/subcontract/quantity/template', query: { project: props.projectId, origin: props.origin } }))

function resetReporting() {
  reporting.value = Object.fromEntries((workspace.value?.items ?? []).map(item => [item.id, workspace.value?.mappings.find(mapping => mapping.itemId === item.id && mapping.isReportingStage)?.stageId ?? '']))
  reportingBaseline.value = { ...reporting.value }
  retainedReporting.value = {}
}
function selectDraft(id: string) {
  const current = workspace.value?.stages.find(stage => stage.id === id)
  if (id && !current)
    throw quantityProblem('not-found', '所选阶段已不可见，请重新读取')
  draft.value = current
    ? { ...current, itemIds: workspace.value!.mappings.filter(mapping => mapping.stageId === id).map(mapping => mapping.itemId) }
    : { id: null, code: '', name: '', trade: workspace.value?.items[0]?.trade ?? '', completionMode: 'unit', sortOrder: 0, itemIds: [] }
  baseline.value = JSON.stringify(draft.value)
}
async function initialize(selectedId = '') {
  localError.value = ''
  resumeFailed = false
  if (!props.projectId || !props.origin) {
    store.cancel()
    draft.value = null
    localError.value = '请从工程量管理选择有效的项目与数据来源后再配置阶段。'
    return
  }
  try {
    const loaded = await store.load(query.value)
    if (!loaded)
      return
    selectDraft(selectedId)
    const retained = { ...retainedReporting.value }
    resetReporting()
    reporting.value = { ...reporting.value, ...retained }
    retainedReporting.value = retained
  }
  catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '阶段配置读取失败'
  }
}
async function confirmDiscard() {
  if (store.saving) {
    feedback.warning('阶段配置正在保存，请等待当前结果')
    return false
  }
  if (!dirty.value)
    return true
  return feedback.confirm({ variant: 'simple', title: '放弃未保存的阶段输入', message: '阶段字段或报量选择尚未保存，确认放弃这些输入？', confirmLabel: '放弃输入' })
}
async function changeSelection(id: string) {
  if (!await confirmDiscard())
    return
  selectDraft(id)
  resetReporting()
  localError.value = ''
}
async function selectionEvent(event: Event) {
  const input = event.target as HTMLSelectElement
  await changeSelection(input.value)
  input.value = draft.value?.id ?? ''
}
async function reload() {
  if (resumeFailed) {
    await resume()
    return
  }
  if (!workspace.value && Object.keys(retainedReporting.value).length) {
    await initialize(draft.value?.id ?? '')
    return
  }
  if (!await confirmDiscard())
    return
  retainedReporting.value = {}
  await initialize(draft.value?.id ?? '')
}
async function resume() {
  localError.value = ''
  try {
    const identity = await store.revalidate()
    if (identity)
      resumeFailed = false
  }
  catch (cause) {
    resumeFailed = true
    localError.value = cause instanceof Error ? cause.message : '当前权限读取失败'
  }
}
function patchDraft(patch: Partial<QuantityStageDraft>) {
  if (draft.value && store.canWrite && !store.saving && !reportingDirty.value)
    draft.value = { ...draft.value, ...patch }
}
async function allowArchivedEdit() {
  return !workspace.value?.matrixArchivedAt || feedback.confirm({ variant: 'simple', title: '修改已归档的阶段配置', message: '阶段映射会影响当前工程量与月度报量读取，确认修改已归档项目？', confirmLabel: '确认修改' })
}
async function saveStage() {
  if (!draft.value || reportingDirty.value)
    return
  localError.value = ''
  try {
    if (!await allowArchivedEdit())
      return
    const action = parseQuantityStageAction({ kind: 'save-stage', draft: draft.value, allowArchivedEdit: Boolean(workspace.value?.matrixArchivedAt) })!
    const result = await store.execute(action)
    if (!result)
      return
    feedback.success('阶段已保存')
    draft.value = { ...draft.value, id: result.id }
    baseline.value = JSON.stringify(draft.value)
    await initialize(result.id)
  }
  catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '阶段保存失败，输入已保留'
  }
}
async function saveReporting(itemId: string, stageId: string | null) {
  localError.value = ''
  try {
    if (!await allowArchivedEdit())
      return
    const remaining = Object.fromEntries(Object.entries(reporting.value).filter(([id, selected]) => id !== itemId
      && selected !== (workspace.value?.mappings.find(mapping => mapping.itemId === id && mapping.isReportingStage)?.stageId ?? '')))
    const result = await store.execute({ kind: 'set-reporting-stage', itemId, stageId, allowArchivedEdit: Boolean(workspace.value?.matrixArchivedAt) })
    if (!result)
      return
    retainedReporting.value = remaining
    feedback.success(stageId ? '报量阶段已保存' : '已清空该分项的报量阶段')
    await initialize(draft.value?.id ?? '')
  }
  catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '报量选择保存失败，输入已保留'
  }
}
async function leave() {
  const allowed = await confirmDiscard()
  discardOnDeactivate = allowed
  return allowed
}
onBeforeRouteLeave(leave)
onBeforeRouteUpdate(leave)
useTabCloseGuard(leave)
watch(() => [props.projectId, props.origin], () => {
  draft.value = null
  baseline.value = ''
  reporting.value = {}
  reportingBaseline.value = {}
  retainedReporting.value = {}
  void initialize()
}, { immediate: true })
onActivated(() => {
  if (!activated) {
    activated = true
    return
  }
  if (dirty.value)
    void resume()
  else
    void initialize(draft.value?.id ?? '')
})
onDeactivated(() => {
  store.cancel()
  if (discardOnDeactivate && baseline.value) {
    draft.value = JSON.parse(baseline.value) as QuantityStageDraft
    resetReporting()
  }
  discardOnDeactivate = false
})
useTabTitle(() => '施工阶段配置')
</script>

<template>
  <EntityFormShell data-testid="quantity-stage-form" title="施工阶段配置" subtitle="先建立项目阶段与分项关系，再明确月度报量采用的阶段。" back-label="返回工程量矩阵" :sections="[{ key: 'stage', label: '阶段信息' }, { key: 'items', label: '关联分项' }, { key: 'reporting', label: '月度报量' }]" :state="shellState" state-title="阶段配置暂不可用" :state-description="errorMessage" state-action-label="重新读取" @back="router.push(returnPath)" @state-action="reload">
    <template #status>
      <span class="chip-brand">{{ origin === 'demo' ? '演示来源' : '正式项目' }}</span>
      <span v-if="workspace?.matrixArchivedAt" class="status-warn">矩阵已归档</span>
      <span v-if="dirty" class="status-warn">有未保存输入</span>
      <span v-if="workspace && !store.canWrite" class="status-warn">仅可查看</span>
    </template>
    <template #actions>
      <KitButton v-if="workspace" variant="secondary" :disabled="store.saving" @click="reload">
        重新读取
      </KitButton>
      <KitButton v-if="workspace && store.canWrite" variant="primary" :loading="store.saving" :disabled="!draft || reportingDirty" @click="saveStage">
        保存阶段
      </KitButton>
    </template>
    <div v-if="workspace && draft" class="min-w-0 space-y-5">
      <div v-if="errorMessage" role="alert" class="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3 text-13px text-ink">
        {{ errorMessage }}。未保存的输入仍保留，请核对后重试或重新读取。
      </div>
      <div class="flex flex-wrap items-end gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
        <label class="min-w-0 flex-1 basis-220px">
          <span class="field-label">当前阶段</span>
          <select :value="draft.id ?? ''" :disabled="store.saving" class="field-input w-full" aria-label="当前施工阶段" @change="selectionEvent">
            <option value="">新建阶段</option>
            <option v-for="stage in workspace.stages" :key="stage.id" :value="stage.id">{{ stage.code }} · {{ stage.name }}</option>
          </select>
        </label>
        <KitButton v-if="store.canWrite" variant="secondary" :disabled="store.saving" @click="changeSelection('')">
          新建阶段
        </KitButton>
        <KitButton variant="secondary" :disabled="store.saving" @click="router.push(templatePath)">
          配置户型模板
        </KitButton>
      </div>
      <p v-if="!workspace.stages.length" class="m-0 text-13px text-ink-soft">
        本项目还没有施工阶段。填写并保存后，才能将分项关联到这个阶段。
      </p>
      <p v-if="reportingDirty" class="m-0 text-12px text-ink-soft">
        报量选择尚未保存，请先保存或撤销，再编辑阶段信息。
      </p>
      <QuantityStageFields :draft="draft" :items="workspace.items as QuantityStageWorkspace['items']" :readonly="!store.canWrite || store.saving || reportingDirty" @patch="patchDraft" />
      <QuantityStageReporting :workspace="workspace as QuantityStageWorkspace" :selections="reporting" :readonly="!store.canWrite || store.saving || stageDirty" @select="(itemId, stageId) => reporting[itemId] = stageId" @save="saveReporting" @cancel="resetReporting" />
    </div>
  </EntityFormShell>
</template>
