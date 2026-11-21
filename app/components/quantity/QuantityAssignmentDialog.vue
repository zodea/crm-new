<script setup lang="ts">
import type {
  QuantityAssignmentBatchDraft,
  QuantityAssignmentWorkspace,
} from '~/lib/quantity/assignment'
import type { QuantityAssigneeKind } from '~/lib/quantity/read-model'
import type { DataOriginDTO } from '~/types/read-model'
import { useEventListener } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import QuantityAssignmentScopePicker from '~/components/quantity/QuantityAssignmentScopePicker.vue'
import QuantityAssignmentUnitPicker from '~/components/quantity/QuantityAssignmentUnitPicker.vue'
import KitButton from '~/components/ui/KitButton.vue'
import {
  parseQuantityAssignmentScopeKey,
  previewQuantityAssignmentConflicts,
  quantityAssigneeIsCandidate,
  quantityAssigneeRequiresDetailedScope,
  quantityAssignmentScopeKey,
} from '~/lib/quantity/assignment'
import { ALL_QUANTITY_FILTER } from '~/lib/quantity/matrix'
import { toErrorMessage } from '~/lib/util/error'

const props = withDefaults(defineProps<{
  projectId: string
  origin?: DataOriginDTO
  initialBuildingId?: string
  initialTrade?: string
  initialUnitId?: string
}>(), {
  initialBuildingId: '',
  initialTrade: '',
  initialUnitId: '',
})

const open = defineModel<boolean>('open', { required: true })
const store = useQuantityStore()
const { confirm, error, success, warning } = useKitUI()

type ScopeMode = 'whole' | 'detailed'

const selectedTrade = shallowRef('')
const assigneeKind = shallowRef<QuantityAssigneeKind>('crew')
const assigneeId = shallowRef('')
const selectedUnitIds = ref<string[]>([])
const scopeMode = shallowRef<ScopeMode>('whole')
const selectedScopeKeys = ref<string[]>([])
const note = ref('')
const baseline = shallowRef('')
const hydratedNote = shallowRef('')
const initializing = shallowRef(false)
let hydrating = false
let initializeSequence = 0

const sections = [
  { key: 'target', label: '责任目标' },
  { key: 'units', label: '楼层与户' },
  { key: 'scopes', label: '个人范围' },
]

const assigneeTabs = [
  { key: 'crew', label: '班组责任' },
  { key: 'worker', label: '个人责任' },
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

const selectedUnits = computed(() => {
  const ids = new Set(selectedUnitIds.value)
  return visibleUnits.value.filter(unit => ids.has(unit.id))
})

const tradeOptions = computed(() => (workspace.value?.trades ?? []).map(trade => ({
  key: trade,
  label: trade,
})))

function itemNamesForTrade(source: QuantityAssignmentWorkspace, trade: string): string[] {
  return [...new Set(
    source.scopeOptions
      .filter(option => option.trade === trade)
      .map(option => option.itemName),
  )]
}

const selectedTradeItemNames = computed(() => workspace.value
  ? itemNamesForTrade(workspace.value, selectedTrade.value)
  : [])

const assigneeOptions = computed(() => (workspace.value?.assignees ?? [])
  .filter(assignee => (
    assignee.kind === assigneeKind.value
    && quantityAssigneeIsCandidate(
      assignee,
      selectedTrade.value,
      selectedTradeItemNames.value,
    )
  ))
  .map(assignee => ({
    key: assignee.id,
    label: assignee.itemNames.length
      ? `${assignee.name} · ${assignee.itemNames.length}项能力`
      : `${assignee.name} · 全部活项`,
  })))

const selectedAssignee = computed(() => workspace.value?.assignees.find(assignee => (
  assignee.kind === assigneeKind.value && assignee.id === assigneeId.value
)))
const selectedAssigneeName = computed(() => selectedAssignee.value?.name ?? '')
const selectedAssigneeNeedsDetailedScope = computed(() => {
  const assignee = selectedAssignee.value
  return assignee
    ? quantityAssigneeRequiresDetailedScope(
        assignee,
        selectedTrade.value,
        selectedTradeItemNames.value,
      )
    : false
})
const scopeTabs = computed(() => selectedAssigneeNeedsDetailedScope.value
  ? [{ key: 'detailed', label: '指定房间分项' }]
  : [
      { key: 'whole', label: '整户工种' },
      { key: 'detailed', label: '指定房间分项' },
    ])

function draftSignature(): string {
  return JSON.stringify({
    selectedTrade: selectedTrade.value,
    assigneeKind: assigneeKind.value,
    assigneeId: assigneeId.value,
    selectedUnitIds: [...selectedUnitIds.value].sort(),
    scopeMode: scopeMode.value,
    selectedScopeKeys: [...selectedScopeKeys.value].sort(),
    note: note.value,
  })
}

const dirty = computed(() => baseline.value !== '' && draftSignature() !== baseline.value)

function currentAssignment(
  source: QuantityAssignmentWorkspace,
  unitId: string,
  trade: string,
) {
  return source.assignments.find(assignment => assignment.unitId === unitId && assignment.trade === trade)
}

function hydrateDraft(source: QuantityAssignmentWorkspace) {
  hydrating = true
  const availableUnits = props.initialBuildingId
    ? source.units.filter(unit => unit.buildingId === props.initialBuildingId)
    : source.units
  const initialUnit = availableUnits.find(unit => unit.id === props.initialUnitId)
  selectedUnitIds.value = initialUnit ? [initialUnit.id] : []

  const initialAssignment = initialUnit
    ? source.assignments.find(assignment => assignment.unitId === initialUnit.id && (
        !props.initialTrade
        || props.initialTrade === ALL_QUANTITY_FILTER
        || assignment.trade === props.initialTrade
      ))
    : undefined
  selectedTrade.value = (
    props.initialTrade
    && props.initialTrade !== ALL_QUANTITY_FILTER
    && source.trades.includes(props.initialTrade)
  )
    ? props.initialTrade
    : initialAssignment?.trade ?? source.trades[0] ?? ''

  const selectedCurrent = initialUnit
    ? currentAssignment(source, initialUnit.id, selectedTrade.value)
    : undefined
  assigneeKind.value = selectedCurrent?.assigneeKind ?? 'crew'
  const currentAssignee = selectedCurrent
    ? source.assignees.find(assignee => (
        assignee.kind === selectedCurrent.assigneeKind
        && assignee.id === selectedCurrent.assigneeId
      ))
    : undefined
  assigneeId.value = currentAssignee && quantityAssigneeIsCandidate(
    currentAssignee,
    selectedTrade.value,
    itemNamesForTrade(source, selectedTrade.value),
  )
    ? currentAssignee.id
    : ''
  note.value = selectedCurrent?.note ?? ''
  hydratedNote.value = note.value
  scopeMode.value = (
    selectedCurrent?.scopes.length
    || selectedCurrent?.hasInvalidScopes
    || (
      currentAssignee
      && quantityAssigneeRequiresDetailedScope(
        currentAssignee,
        selectedTrade.value,
        itemNamesForTrade(source, selectedTrade.value),
      )
    )
  )
    ? 'detailed'
    : 'whole'
  selectedScopeKeys.value = selectedCurrent?.scopes.map(scope => quantityAssignmentScopeKey({
    unitId: initialUnit!.id,
    roomId: scope.roomId,
    itemId: scope.itemId,
  })) ?? []
  hydrating = false
  baseline.value = draftSignature()
}

async function initialize(sequence: number, projectId: string) {
  try {
    await store.loadAssignments(projectId, props.origin ?? 'real')
    if (sequence !== initializeSequence || !open.value || props.projectId !== projectId || !workspace.value)
      return
    hydrateDraft(workspace.value)
  }
  catch (cause) {
    if (sequence === initializeSequence)
      error(`责任配置加载失败：${toErrorMessage(cause)}`)
  }
  finally {
    if (sequence === initializeSequence)
      initializing.value = false
  }
}

function requestInitialize(isOpen: boolean, projectId: string) {
  const sequence = ++initializeSequence
  baseline.value = ''
  selectedUnitIds.value = []
  selectedScopeKeys.value = []
  if (!isOpen || !projectId) {
    initializing.value = false
    return
  }
  initializing.value = true
  void initialize(sequence, projectId)
}

watch(
  [open, () => props.projectId, () => props.initialBuildingId, () => props.initialTrade, () => props.initialUnitId, () => props.origin],
  ([isOpen, projectId]) => requestInitialize(isOpen, projectId),
  { immediate: true },
)

watch(selectedTrade, () => {
  if (hydrating)
    return
  assigneeId.value = ''
  if (note.value === hydratedNote.value)
    note.value = ''
  hydratedNote.value = ''
  scopeMode.value = 'whole'
  selectedScopeKeys.value = []
}, { flush: 'sync' })

watch(assigneeKind, () => {
  if (hydrating)
    return
  assigneeId.value = ''
  if (note.value === hydratedNote.value)
    note.value = ''
  hydratedNote.value = ''
  if (assigneeKind.value === 'crew') {
    scopeMode.value = 'whole'
    selectedScopeKeys.value = []
  }
}, { flush: 'sync' })

watch(assigneeId, (next, previous) => {
  if (hydrating || next === previous)
    return
  if (note.value === hydratedNote.value)
    note.value = ''
  hydratedNote.value = ''
  selectedScopeKeys.value = []
  scopeMode.value = 'whole'
}, { flush: 'sync' })

watch(selectedAssigneeNeedsDetailedScope, (required) => {
  if (required)
    scopeMode.value = 'detailed'
}, { flush: 'sync' })

watch(scopeMode, (mode) => {
  if (!hydrating && mode === 'whole')
    selectedScopeKeys.value = []
}, { flush: 'sync' })

watch(selectedUnitIds, (unitIds) => {
  const allowed = new Set(unitIds)
  selectedScopeKeys.value = selectedScopeKeys.value.filter((key) => {
    const scope = parseQuantityAssignmentScopeKey(key)
    return scope != null && allowed.has(scope.unitId)
  })
}, { deep: true })

function buildDraft(): QuantityAssignmentBatchDraft | null {
  const source = workspace.value
  if (!source || !selectedTrade.value) {
    warning('当前项目没有可配置的工种')
    return null
  }
  if (!assigneeId.value) {
    warning(`请选择${assigneeKind.value === 'crew' ? '班组' : '个人'}`)
    return null
  }
  if (!selectedUnitIds.value.length) {
    warning('请至少选择一户')
    return null
  }

  const scopes = assigneeKind.value === 'worker' && scopeMode.value === 'detailed'
    ? selectedScopeKeys.value.flatMap((key) => {
        const parsed = parseQuantityAssignmentScopeKey(key)
        return parsed ? [parsed] : []
      })
    : []
  if (assigneeKind.value === 'worker' && scopeMode.value === 'detailed') {
    const scopedUnits = new Set(scopes.map(scope => scope.unitId))
    if (selectedUnitIds.value.some(unitId => !scopedUnits.has(unitId))) {
      warning('指定房间分项时，每个所选户至少勾选一个范围')
      return null
    }
  }

  return {
    projectId: props.projectId,
    trade: selectedTrade.value,
    assigneeKind: assigneeKind.value,
    assigneeId: assigneeId.value,
    unitIds: [...selectedUnitIds.value],
    expectedAssignments: selectedUnitIds.value.map((unitId) => {
      const current = currentAssignment(source, unitId, selectedTrade.value)
      return {
        unitId,
        assignmentId: current?.id ?? null,
        fingerprint: current?.fingerprint ?? null,
      }
    }),
    scopes,
    note: note.value,
    allowReplacement: false,
    allowArchivedEdit: false,
  }
}

async function confirmArchivedEdit(): Promise<boolean> {
  return confirm({
    variant: 'simple',
    title: '修改已归档矩阵',
    message: '当前工程量矩阵已归档。继续修改责任会保留操作日志，但会改变当前责任视图，确认继续？',
    confirmLabel: '确认修改',
  })
}

async function persistDraft(draft: QuantityAssignmentBatchDraft) {
  try {
    return await store.saveAssignments(draft)
  }
  catch (cause) {
    if (!draft.allowArchivedEdit && toErrorMessage(cause).includes('已归档')) {
      if (!await confirmArchivedEdit())
        return null
      return store.saveAssignments({ ...draft, allowArchivedEdit: true })
    }
    throw cause
  }
}

async function save() {
  if (!store.assignmentCanWrite || store.assignmentSaving || store.assignmentLoading || initializing.value)
    return
  const source = workspace.value
  const draft = buildDraft()
  if (!source || !draft)
    return

  const conflicts = previewQuantityAssignmentConflicts(source, draft)
  const directCount = draft.unitIds.filter(unitId => !currentAssignment(source, unitId, draft.trade)).length
  if (!conflicts.length && !directCount) {
    warning('当前责任与范围没有需要保存的变化')
    return
  }

  if (conflicts.length) {
    const details = conflicts.map(conflict => (
      `• ${conflict.floorName} ${conflict.unitName}：${conflict.currentAssigneeName} → ${selectedAssigneeName.value}`
    )).join('\n')
    const approved = await confirm({
      variant: 'simple',
      title: '替换现有责任',
      message: `以下 ${conflicts.length} 户已有责任或个人范围将发生变化：\n${details}\n\n阶段完成事实不会改变，历史记录仍保留完成时责任。`,
      confirmLabel: '确认替换',
    })
    if (!approved)
      return
    draft.allowReplacement = true
  }

  if (source.matrixArchivedAt) {
    if (!await confirmArchivedEdit())
      return
    draft.allowArchivedEdit = true
  }

  try {
    const result = await persistDraft(draft)
    if (!result)
      return
    if (!result.changedUnitIds.length) {
      warning('当前责任与范围没有需要保存的变化')
      return
    }
    success(`已更新 ${result.changedUnitIds.length} 户的 ${draft.trade} 责任`)
    if (store.assignmentError)
      warning(store.assignmentError)
    baseline.value = draftSignature()
    open.value = false
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function confirmDiscard(message = '当前责任配置有未保存的筛选或选择，确认放弃？'): Promise<boolean> {
  if (store.assignmentSaving) {
    warning('责任配置正在提交，请等待保存完成')
    return false
  }
  if (!dirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃未保存配置',
    message,
    confirmLabel: '放弃配置',
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
  return confirmDiscard('离开工程量页面会放弃当前责任配置，确认继续？')
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!open.value || (!dirty.value && !store.assignmentSaving))
    return
  event.preventDefault()
  event.returnValue = ''
})
</script>

<template>
  <FormDialog
    :open="open"
    title="户 × 工种责任配置"
    :sections="sections"
    save-label="保存责任"
    width="min(1080px, calc(100dvw - var(--space-6, 24px)))"
    :busy="store.assignmentSaving"
    :save-disabled="!store.assignmentCanWrite || store.assignmentLoading || initializing"
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
        正在读取责任配置…
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
      data-testid="quantity-assignment-fields"
      class="m-0 min-w-0 border-0 p-0"
      :class="store.assignmentSaving ? 'pointer-events-none opacity-70' : ''"
      :disabled="!store.assignmentCanWrite || store.assignmentSaving || store.assignmentLoading || initializing"
    >
      <div class="grid gap-7">
        <section id="form-section-target" class="scroll-mt-4 grid gap-4">
          <div>
            <h3 class="text-14px font-800 text-ink">
              责任目标
            </h3>
            <p class="mt-1 text-12px text-ink-soft">
              责任只写户 × 工种；不会在这里登记完成状态或完成日期。
            </p>
          </div>

          <div class="flex min-w-0 flex-wrap items-center gap-4">
            <SelectFilter
              v-model="selectedTrade"
              label="工种"
              :options="tradeOptions"
              :min-width="148"
              placeholder="暂无工种"
            />
            <span v-if="workspace.matrixArchivedAt" class="status-warn">
              已归档 · 修改需二次确认
            </span>
          </div>

          <div class="grid gap-3 border border-line rounded-[var(--radius-card)] bg-surface-2 p-3">
            <SegTab v-model="assigneeKind" :tabs="assigneeTabs" />
            <div class="flex min-w-0 flex-wrap items-center gap-3">
              <SelectFilter
                v-model="assigneeId"
                :label="assigneeKind === 'crew' ? '班组' : '个人'"
                :options="assigneeOptions"
                :min-width="190"
                :placeholder="assigneeOptions.length ? '请选择责任人' : '当前工种无候选'"
              />
              <span class="text-11px text-ink-faint">
                候选按基础资料中的工种与活项能力匹配
              </span>
            </div>
            <p
              v-if="selectedTrade && !assigneeOptions.length"
              class="rounded-[var(--radius-btn)] bg-warn-soft px-3 py-2.5 text-12px text-warn-ink"
              role="status"
            >
              当前工种没有兼容{{ assigneeKind === 'crew' ? '班组' : '人员' }}。请先到基础信息维护可承接工种与活项能力。
            </p>
          </div>

          <label class="grid gap-1.5">
            <span class="field-label">责任备注（批量应用）</span>
            <textarea
              v-model="note"
              class="field-input min-h-18 w-full resize-y"
              maxlength="500"
              placeholder="可选；更换责任或范围时随新责任留存"
            />
          </label>
        </section>

        <section id="form-section-units" class="scroll-mt-4 grid gap-3 border-t border-line pt-6">
          <div>
            <h3 class="text-14px font-800 text-ink">
              楼层与户
            </h3>
            <p class="mt-1 text-12px text-ink-soft">
              按当前楼栋分组选择；格内始终显示所选工种的当前责任。
            </p>
          </div>
          <QuantityAssignmentUnitPicker
            v-model="selectedUnitIds"
            :units="visibleUnits"
            :assignments="workspace.assignments"
            :trade="selectedTrade"
            :disabled="store.assignmentSaving"
          />
        </section>

        <section id="form-section-scopes" class="scroll-mt-4 grid gap-3 border-t border-line pt-6">
          <div>
            <h3 class="text-14px font-800 text-ink">
              个人范围
            </h3>
            <p class="mt-1 text-12px text-ink-soft">
              班组责任止于整户；个人责任可选整户工种，也可按稳定房间 × 分项细化。
            </p>
          </div>

          <p v-if="assigneeKind === 'crew'" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-3 text-12px text-ink-soft">
            当前为班组责任，不建立房间分项范围。
          </p>
          <template v-else>
            <SegTab v-model="scopeMode" :tabs="scopeTabs" />
            <p v-if="selectedAssigneeNeedsDetailedScope" class="rounded-[var(--radius-btn)] bg-warn-soft px-3 py-2.5 text-12px text-warn-ink">
              该人员只配置了部分活项，责任范围必须细化到兼容的房间 × 分项。
            </p>
            <p v-if="scopeMode === 'whole'" class="rounded-[var(--radius-btn)] bg-brand-soft/40 px-3 py-3 text-12px text-brand-deep">
              个人负责所选户的整个 {{ selectedTrade || '工种' }} 范围，不写明细 scope。
            </p>
            <QuantityAssignmentScopePicker
              v-else
              v-model="selectedScopeKeys"
              :units="selectedUnits"
              :options="workspace.scopeOptions"
              :trade="selectedTrade"
              :allowed-item-names="selectedAssignee?.itemNames ?? []"
              :disabled="store.assignmentSaving"
            />
          </template>
        </section>
      </div>
    </fieldset>
  </FormDialog>
</template>
