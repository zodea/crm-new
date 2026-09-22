<script setup lang="ts">
import type {
  QuantityBatchCompletionItem,
  QuantityBatchCompletionResult,
} from '~/lib/quantity/batch-completion'
import type { DataOriginDTO } from '~/types/read-model'
import { useEventListener } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import KitButton from '~/components/ui/KitButton.vue'
import { ALL_QUANTITY_FILTER } from '~/lib/quantity/matrix'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const props = withDefaults(defineProps<{
  projectId: string
  origin?: DataOriginDTO
  initialBuildingId?: string
  initialTrade?: string
}>(), {
  initialBuildingId: '',
  initialTrade: '',
})

const open = defineModel<boolean>('open', { required: true })
const store = useQuantityStore()
const { confirm, error, success, warning } = useKitUI()

const selectedTrade = shallowRef('')
const completedAt = shallowRef('')
const note = ref('')
const selectedUnitIds = ref<string[]>([])
const planItems = shallowRef<readonly QuantityBatchCompletionItem[] | null>(null)
const excludedKeys = ref<string[]>([])
const planLoading = shallowRef(false)
const result = shallowRef<QuantityBatchCompletionResult | null>(null)
const initializing = shallowRef(false)
let initializeSequence = 0

const sections = [
  { key: 'scope', label: '工种与户' },
  { key: 'confirm', label: '逐阶段确认' },
]

const workspace = computed(() => store.assignmentWorkspace?.projectId === props.projectId
  && store.assignmentOrigin === (props.origin ?? 'real')
  ? store.assignmentWorkspace
  : null)

const visibleUnits = computed(() => {
  const units = workspace.value?.units ?? []
  if (!props.initialBuildingId || !units.some(unit => unit.buildingId === props.initialBuildingId))
    return units
  return units.filter(unit => unit.buildingId === props.initialBuildingId)
})

const tradeOptions = computed(() => (workspace.value?.trades ?? []).map(trade => ({
  key: trade,
  label: trade,
})))

function itemKey(item: Pick<QuantityBatchCompletionItem, 'unitId' | 'stageId'>): string {
  return `${item.unitId} ${item.stageId}`
}

const includedItems = computed(() => {
  const excluded = new Set(excludedKeys.value)
  return (planItems.value ?? []).filter(item => !excluded.has(itemKey(item)))
})

const projectedSummary = computed(() => {
  const items = includedItems.value
  return {
    completed: items.filter(item => item.projectedStatus === 'completed').length,
    drafted: items.filter(item => item.projectedStatus === 'draft').length,
  }
})

const dirty = computed(() => (
  open.value && (selectedUnitIds.value.length > 0 || planItems.value != null) && result.value == null
))

async function initialize(sequence: number, projectId: string) {
  try {
    await store.loadAssignments(projectId, props.origin ?? 'real')
    if (sequence !== initializeSequence || !open.value || props.projectId !== projectId || !workspace.value)
      return
    selectedTrade.value = (
      props.initialTrade
      && props.initialTrade !== ALL_QUANTITY_FILTER
      && workspace.value.trades.includes(props.initialTrade)
    )
      ? props.initialTrade
      : workspace.value.trades[0] ?? ''
  }
  catch (cause) {
    if (sequence === initializeSequence)
      error(`批量完成加载失败：${toErrorMessage(cause)}`)
  }
  finally {
    if (sequence === initializeSequence)
      initializing.value = false
  }
}

function requestInitialize(isOpen: boolean, projectId: string) {
  const sequence = ++initializeSequence
  selectedUnitIds.value = []
  planItems.value = null
  excludedKeys.value = []
  result.value = null
  note.value = ''
  completedAt.value = toLocalDateInputValue()
  if (!isOpen || !projectId) {
    initializing.value = false
    return
  }
  initializing.value = true
  void initialize(sequence, projectId)
}

watch(
  [open, () => props.projectId, () => props.initialBuildingId, () => props.initialTrade, () => props.origin],
  ([isOpen, projectId]) => requestInitialize(isOpen, projectId),
  { immediate: true },
)

// 范围一变，已展开的确认列表即失效，必须重新展开。
watch([selectedTrade, selectedUnitIds], () => {
  planItems.value = null
  excludedKeys.value = []
  result.value = null
}, { deep: true })

async function expandPlan() {
  if (planLoading.value)
    return
  if (!selectedTrade.value) {
    warning('请先选择工种')
    return
  }
  if (!selectedUnitIds.value.length) {
    warning('请至少选择一户')
    return
  }
  planLoading.value = true
  const scope = JSON.stringify([props.projectId, props.origin, selectedTrade.value, selectedUnitIds.value])
  try {
    const plan = await store.loadBatchPlan(props.projectId, selectedTrade.value, selectedUnitIds.value, props.origin ?? 'real')
    if (!open.value || !plan || scope !== JSON.stringify([props.projectId, props.origin, selectedTrade.value, selectedUnitIds.value]))
      return
    planItems.value = plan.items
    excludedKeys.value = plan.items
      .filter(item => item.currentStatus === 'completed')
      .map(item => itemKey(item))
    result.value = null
    if (!plan.items.length)
      warning('所选户在该工种下没有适用的工序阶段')
  }
  catch (cause) {
    error(`展开阶段失败：${toErrorMessage(cause)}`)
  }
  finally {
    planLoading.value = false
  }
}

function toggleItem(item: QuantityBatchCompletionItem, included: boolean) {
  const key = itemKey(item)
  const next = new Set(excludedKeys.value)
  if (included)
    next.delete(key)
  else
    next.add(key)
  excludedKeys.value = [...next]
}

function statusLabel(item: QuantityBatchCompletionItem): string {
  if (item.currentStatus === 'completed')
    return `已完成 ${item.currentCompletedAt?.slice(0, 10) ?? ''}`.trim()
  if (item.currentStatus === 'draft')
    return '草稿'
  return '未登记'
}

function projectionLabel(item: QuantityBatchCompletionItem): string {
  if (item.projectedStatus === 'completed')
    return '→ 登记完成'
  if (item.projectedReason === 'missing-assignment')
    return '→ 存草稿（未指派责任）'
  return '→ 存草稿（缺验收照片）'
}

async function confirmArchivedEdit(): Promise<boolean> {
  return confirm({
    variant: 'simple',
    title: '修改已归档矩阵',
    message: '当前工程量矩阵已归档。继续批量登记会保留操作日志，确认继续？',
    confirmLabel: '确认修改',
  })
}

async function save() {
  if (!store.batchCanWrite || store.completionSaving || planLoading.value || initializing.value)
    return
  const items = includedItems.value
  if (!planItems.value) {
    warning('请先展开阶段并确认列表')
    return
  }
  if (!items.length) {
    warning('确认列表已全部排除，没有可提交的户×阶段')
    return
  }
  if (!completedAt.value) {
    warning('请填写完成日期')
    return
  }

  const draft = {
    projectId: props.projectId,
    trade: selectedTrade.value,
    completedAt: completedAt.value,
    note: note.value,
    items: items.map(item => ({
      unitId: item.unitId,
      stageId: item.stageId,
      expectedCompletionId: item.expectedCompletionId,
      expectedCompletionFingerprint: item.expectedCompletionFingerprint,
      expectedAssignmentId: item.expectedAssignmentId,
    })),
    allowArchivedEdit: false,
  }

  if (workspace.value?.matrixArchivedAt) {
    if (!await confirmArchivedEdit())
      return
    draft.allowArchivedEdit = true
  }

  try {
    const saved = await store.saveBatchCompletion(draft)
    result.value = saved
    const parts = [
      saved.completed.length ? `${saved.completed.length} 项登记完成` : '',
      saved.drafted.length ? `${saved.drafted.length} 项存草稿` : '',
      saved.unchanged.length ? `${saved.unchanged.length} 项无变化` : '',
    ].filter(Boolean)
    success(`批量完成已提交：${parts.join('、')}`)
    if (store.completionError)
      warning(store.completionError)
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function confirmDiscard(message = '当前批量完成还未提交，确认放弃？'): Promise<boolean> {
  if (store.completionSaving) {
    warning('批量完成正在提交，请等待保存完成')
    return false
  }
  if (!dirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃批量完成',
    message,
    confirmLabel: '放弃',
  })
}

async function requestClose() {
  if (!await confirmDiscard())
    return
  open.value = false
}

function retry() {
  requestInitialize(open.value, props.projectId)
}

onBeforeRouteLeave(async () => {
  if (!open.value)
    return true
  return confirmDiscard('离开工程量页面会放弃当前批量完成输入，确认继续？')
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!open.value || (!dirty.value && !store.completionSaving))
    return
  event.preventDefault()
  event.returnValue = ''
})
</script>

<template>
  <FormDialog
    :open="open"
    title="整工种批量完成"
    :sections="sections"
    save-label="提交批量登记"
    width="min(1080px, calc(100dvw - var(--space-6, 24px)))"
    :busy="store.completionSaving"
    :save-disabled="!store.batchCanWrite || !planItems || planLoading || initializing"
    @save="save"
    @cancel="requestClose"
  >
    <section
      v-if="initializing || (store.assignmentLoading && !workspace)"
      class="flex min-h-72 flex-col items-center justify-center gap-3 text-center"
      role="status"
      aria-busy="true"
    >
      <span class="i-lucide-loader-circle animate-spin text-24px text-brand" aria-hidden="true" />
      <p class="text-13px font-700 text-ink">
        正在读取批量完成…
      </p>
    </section>

    <section v-else-if="store.assignmentError && !workspace" class="flex min-h-72 flex-col items-center justify-center gap-3 text-center" role="alert">
      <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
      <p class="max-w-xl text-12px text-ink-soft">
        {{ store.assignmentError }}
      </p>
      <KitButton variant="primary" @click="retry">
        重新加载
      </KitButton>
    </section>

    <fieldset
      v-else-if="workspace"
      data-testid="quantity-batch-completion-fields"
      class="m-0 min-w-0 border-0 p-0"
      :class="store.completionSaving ? 'pointer-events-none opacity-70' : ''"
      :disabled="!store.assignmentCanWrite || store.completionSaving || initializing"
    >
      <div class="grid gap-7">
        <section id="form-section-scope" class="scroll-mt-4 grid gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <div>
              <h3 class="text-14px font-800 text-ink">
                工种与户
              </h3>
              <p class="mt-1 text-12px text-ink-soft">
                批量动作展开为该工种下逐户 × 逐阶段的完成事实，不写工种级完成。
              </p>
            </div>
            <span v-if="workspace.matrixArchivedAt" class="status-warn ml-auto">
              已归档 · 修改需二次确认
            </span>
          </div>

          <div class="flex min-w-0 flex-wrap items-end gap-4">
            <SelectFilter
              v-model="selectedTrade"
              label="工种"
              :options="tradeOptions"
              :min-width="148"
              placeholder="暂无工种"
            />
            <label class="grid gap-1.5">
              <span class="field-label">完成日期（批量应用）</span>
              <input v-model="completedAt" type="date" class="field-input">
            </label>
            <label class="min-w-56 flex-1 grid gap-1.5">
              <span class="field-label">备注（批量应用）</span>
              <input
                v-model="note"
                type="text"
                class="field-input w-full"
                maxlength="500"
                placeholder="可选；随每条完成事实留存"
              >
            </label>
          </div>

          <QuantityAssignmentUnitPicker
            v-model="selectedUnitIds"
            :units="visibleUnits"
            :assignments="workspace.assignments"
            :trade="selectedTrade"
            :disabled="store.completionSaving"
          />
        </section>

        <section id="form-section-confirm" class="scroll-mt-4 grid gap-3 border-t border-line pt-6">
          <div class="flex flex-wrap items-center gap-3">
            <div>
              <h3 class="text-14px font-800 text-ink">
                逐阶段确认
              </h3>
              <p class="mt-1 text-12px text-ink-soft">
                可排除尚未完成的阶段；缺照片或未指派责任的项按软卡保存为草稿。
              </p>
            </div>
            <button
              type="button"
              class="btn-secondary ml-auto"
              :disabled="planLoading"
              @click="expandPlan"
            >
              <span :class="planLoading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-list-tree'" class="mr-1 text-13px" aria-hidden="true" />
              展开阶段
            </button>
          </div>

          <p v-if="!planItems" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-3 text-12px text-ink-soft">
            选择工种和户后点击「展开阶段」，逐项确认后提交。
          </p>
          <template v-else>
            <div
              v-if="result"
              class="grid gap-2 border border-line rounded-[var(--radius-card)] bg-surface-2 p-3"
              role="status"
            >
              <div class="text-13px font-800 text-ink">
                提交结果（按阶段回显）
              </div>
              <ul class="grid gap-1 text-12px">
                <li v-for="item in result.completed" :key="`done:${item.completionId}`" class="flex items-center gap-2">
                  <span class="i-lucide-circle-check-big flex-none text-ok" aria-hidden="true" />
                  <span class="text-ink">{{ item.unitName }} · {{ item.stageName }}</span>
                  <span class="ml-auto text-ink-soft">登记完成</span>
                </li>
                <li v-for="item in result.drafted" :key="`draft:${item.completionId}`" class="flex items-center gap-2">
                  <span class="i-lucide-circle-dashed flex-none text-warn" aria-hidden="true" />
                  <span class="text-ink">{{ item.unitName }} · {{ item.stageName }}</span>
                  <span class="ml-auto text-ink-soft">{{ item.reason === 'missing-assignment' ? '存草稿 · 未指派责任' : '存草稿 · 缺验收照片' }}</span>
                </li>
                <li v-for="item in result.unchanged" :key="`same:${item.completionId}`" class="flex items-center gap-2">
                  <span class="i-lucide-minus flex-none text-ink-faint" aria-hidden="true" />
                  <span class="text-ink">{{ item.unitName }} · {{ item.stageName }}</span>
                  <span class="ml-auto text-ink-soft">无变化</span>
                </li>
              </ul>
            </div>

            <template v-else>
              <p class="text-12px text-ink-soft" aria-live="polite">
                将提交 {{ includedItems.length }} 项：{{ projectedSummary.completed }} 项登记完成、{{ projectedSummary.drafted }} 项存草稿。
              </p>
              <ul class="grid gap-1.5">
                <li
                  v-for="item in planItems"
                  :key="itemKey(item)"
                  class="min-w-0"
                >
                  <label
                    class="flex min-w-0 cursor-pointer items-center gap-3 border border-line rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2 text-12px has-[:checked]:border-brand/50"
                  >
                    <input
                      type="checkbox"
                      class="flex-none accent-[var(--brand)]"
                      :checked="!excludedKeys.includes(itemKey(item))"
                      @change="toggleItem(item, ($event.target as HTMLInputElement).checked)"
                    >
                    <span class="min-w-0 flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <span class="font-700 text-ink">{{ item.floorName }} {{ item.unitName }}</span>
                      <span class="text-ink">{{ item.stageName }}</span>
                      <span class="text-ink-soft">{{ item.assigneeName ?? '未指派责任' }}</span>
                      <span class="text-ink-faint">{{ statusLabel(item) }}</span>
                      <span
                        class="ml-auto"
                        :class="item.projectedStatus === 'completed' ? 'text-ok' : 'text-warn-ink'"
                      >{{ projectionLabel(item) }}</span>
                    </span>
                  </label>
                </li>
              </ul>
            </template>
          </template>
        </section>
      </div>
    </fieldset>
  </FormDialog>
</template>
