<script setup lang="ts">
import type {
  QuantityTemplateDraft,
  QuantityTemplateLineDraft,
  QuantityTemplateNewItemDraft,
  QuantityTemplateRoomDraft,
} from '~/lib/quantity/template'
import { useEventListener } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import {
  blankQuantityTemplateDraft,
  borrowedQuantityTemplateDraft,
  editableQuantityTemplateDraft,
} from '~/lib/quantity/template'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
}>()

const open = defineModel<boolean>('open', { required: true })
const store = useQuantityStore()
const { confirm, error, success, undoToast, warning } = useKitUI()

const selectedTemplateId = shallowRef('')
const draft = ref<QuantityTemplateDraft | null>(null)
const baseline = shallowRef('')
const initializing = shallowRef(false)
let localSequence = 0
let initializeSequence = 0

interface RoomUpdate { key: string, field: 'code' | 'name', value: string }
interface NewItemUpdate { key: string, field: 'code' | 'name' | 'trade' | 'unit', value: string }
type LineUpdate
  = | { key: string, field: 'roomKey' | 'itemId' | 'fieldFormula' | 'note', value: string }
    | { key: string, field: 'contractQty' | 'provisionalQty', value: number | null }

const sections = [
  { key: 'basic', label: '模板信息' },
  { key: 'rooms', label: '稳定房间' },
  { key: 'items', label: '三量明细' },
]

const workspace = computed(() => store.templateWorkspace?.projectId === props.projectId
  ? store.templateWorkspace
  : null)
const selectedTemplate = computed(() => workspace.value?.templates.find(template => template.id === selectedTemplateId.value) ?? null)
const dirty = computed(() => draft.value != null && JSON.stringify(draft.value) !== baseline.value)
const itemOptions = computed(() => [
  ...(workspace.value?.items ?? []).map(item => ({
    key: item.id,
    label: `${item.trade} · ${item.name}${item.unit ? `（${item.unit}）` : ''}`,
  })),
  ...(draft.value?.newItems ?? []).map(item => ({
    key: item.key,
    label: `${item.trade || '待填工种'} · ${item.name || '新分项'}${item.unit ? `（${item.unit}）` : ''}`,
  })),
])

function remember(next: QuantityTemplateDraft) {
  draft.value = next
  baseline.value = JSON.stringify(next)
}

function selectDraft(templateId: string) {
  if (!workspace.value)
    return
  selectedTemplateId.value = templateId
  remember(templateId
    ? editableQuantityTemplateDraft(workspace.value, templateId)
    : blankQuantityTemplateDraft(props.projectId))
}

async function initialize(sequence: number, projectId: string) {
  if (sequence !== initializeSequence || !open.value || props.projectId !== projectId)
    return
  try {
    await store.loadTemplates(projectId)
    if (sequence !== initializeSequence || !open.value || props.projectId !== projectId || workspace.value?.projectId !== projectId)
      return
    const preferred = workspace.value.templates.find(template => template.id === selectedTemplateId.value)
      ?? workspace.value.templates[0]
    selectDraft(preferred?.id ?? '')
  }
  catch (cause) {
    if (sequence === initializeSequence)
      error(`户型模板加载失败：${toErrorMessage(cause)}`)
  }
  finally {
    if (sequence === initializeSequence)
      initializing.value = false
  }
}

function requestInitialize(isOpen: boolean, projectId: string) {
  const sequence = ++initializeSequence
  draft.value = null
  baseline.value = ''
  if (!isOpen || !projectId) {
    initializing.value = false
    return
  }

  initializing.value = true
  void initialize(sequence, projectId)
}

watch(
  [open, () => props.projectId],
  ([isOpen, projectId]) => requestInitialize(isOpen, projectId),
  { immediate: true },
)

async function confirmDiscard(message = '当前户型模板有未保存修改，确认放弃这些草稿？'): Promise<boolean> {
  if (store.templateSaving) {
    warning('户型模板正在提交，请等待保存完成')
    return false
  }
  if (!dirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃未保存修改',
    message,
    confirmLabel: '放弃修改',
  })
}

async function requestClose() {
  if (!await confirmDiscard())
    return
  open.value = false
}

async function requestTemplateChange(event: Event) {
  const select = event.target as HTMLSelectElement
  const nextId = select.value
  if (!await confirmDiscard('切换户型会放弃当前未保存修改，确认继续？')) {
    select.value = selectedTemplateId.value
    return
  }
  selectDraft(nextId)
}

async function createBlank() {
  if (!await confirmDiscard())
    return
  selectedTemplateId.value = ''
  remember(blankQuantityTemplateDraft(props.projectId))
}

async function borrowCurrent() {
  if (!workspace.value || !selectedTemplateId.value)
    return
  if (!await confirmDiscard())
    return
  const sourceId = selectedTemplateId.value
  selectedTemplateId.value = ''
  remember(borrowedQuantityTemplateDraft(workspace.value, sourceId))
}

function nextKey(prefix: string): string {
  localSequence += 1
  return `${prefix}:${localSequence}`
}

function addRoom() {
  if (!draft.value)
    return
  const roomNumber = draft.value.rooms.filter(room => room.kind === 'room').length + 1
  draft.value.rooms.push({
    key: nextKey('new-room'),
    id: null,
    code: `room_${roomNumber}`,
    name: `房间${roomNumber}`,
    kind: 'room',
    sortOrder: roomNumber * 10,
  })
}

function removeRoom(room: QuantityTemplateRoomDraft) {
  if (!draft.value || room.kind === 'whole_unit')
    return
  if (draft.value.lines.some(line => line.roomKey === room.key)) {
    warning('请先删除该房间下的三量明细')
    return
  }
  draft.value.rooms = draft.value.rooms.filter(candidate => candidate.key !== room.key)
}

function updateRoom(payload: RoomUpdate) {
  const room = draft.value?.rooms.find(candidate => candidate.key === payload.key)
  if (room)
    room[payload.field] = payload.value
}

function addLine(itemId?: string) {
  if (!draft.value)
    return
  const room = draft.value.rooms.find(candidate => candidate.kind === 'room') ?? draft.value.rooms[0]
  const selectedItemId = itemId ?? itemOptions.value[0]?.key
  if (!room || !selectedItemId) {
    warning('请先建立一个手工分项')
    return
  }
  draft.value.lines.push({
    key: nextKey('new-line'),
    id: null,
    roomKey: room.key,
    itemId: selectedItemId,
    recognizedContractQty: null,
    contractQty: null,
    provisionalQty: null,
    fieldFormula: '',
    fieldQty: null,
    note: '',
    sortOrder: draft.value.lines.length * 10 + 10,
  })
}

function addManualItem() {
  if (!draft.value)
    return
  const key = nextKey('new-item')
  const item: QuantityTemplateNewItemDraft = {
    key,
    code: `manual_${draft.value.newItems.length + 1}`,
    name: '新分项',
    section: '',
    trade: '',
    unit: '㎡',
    sortOrder: (workspace.value?.items.length ?? 0) * 10 + draft.value.newItems.length * 10 + 10,
  }
  draft.value.newItems.push(item)
  addLine(key)
}

function removeNewItem(item: QuantityTemplateNewItemDraft) {
  if (!draft.value)
    return
  draft.value.lines = draft.value.lines.filter(line => line.itemId !== item.key)
  draft.value.newItems = draft.value.newItems.filter(candidate => candidate.key !== item.key)
}

function updateNewItem(payload: NewItemUpdate) {
  const item = draft.value?.newItems.find(candidate => candidate.key === payload.key)
  if (item)
    item[payload.field] = payload.value
}

function removeLine(line: QuantityTemplateLineDraft) {
  if (draft.value)
    draft.value.lines = draft.value.lines.filter(candidate => candidate.key !== line.key)
}

function updateLine(payload: LineUpdate) {
  const line = draft.value?.lines.find(candidate => candidate.key === payload.key)
  if (!line)
    return
  switch (payload.field) {
    case 'roomKey':
      line.roomKey = payload.value
      break
    case 'itemId':
      line.itemId = payload.value
      break
    case 'contractQty':
      line.contractQty = payload.value
      break
    case 'provisionalQty':
      line.provisionalQty = payload.value
      break
    case 'fieldFormula':
      line.fieldFormula = payload.value
      break
    case 'note':
      line.note = payload.value
      break
  }
}

// 矩阵归档后的模板写入需要显式二次授权（蓝本§六）。
async function confirmArchivedEdit(action: string): Promise<boolean> {
  return confirm({
    variant: 'simple',
    title: '修改已归档矩阵',
    message: `当前工程量矩阵已归档。继续${action}会保留操作日志，确认继续？`,
    confirmLabel: '确认修改',
  })
}

async function save() {
  if (!draft.value || store.templateSaving || store.templateLoading || initializing.value)
    return
  if (!dirty.value) {
    warning('当前模板没有需要保存的修改')
    return
  }
  try {
    const operationProjectId = draft.value.projectId
    let result: Awaited<ReturnType<typeof store.saveTemplate>>
    try {
      result = await store.saveTemplate(draft.value)
    }
    catch (cause) {
      if (!toErrorMessage(cause).includes('已归档'))
        throw cause
      if (!await confirmArchivedEdit('保存户型模板'))
        return
      result = await store.saveTemplate({ ...draft.value, allowArchivedEdit: true })
    }
    selectedTemplateId.value = result.templateId
    if (workspace.value) {
      remember(editableQuantityTemplateDraft(workspace.value, result.templateId))
    }
    else {
      baseline.value = JSON.stringify(draft.value)
      open.value = false
    }
    success('户型模板已保存')
    if (store.templateError)
      warning(store.templateError)
    if (result.logIds.length) {
      undoToast('户型模板已更新', async () => {
        const isCurrentProject = props.projectId === operationProjectId
        if (isCurrentProject && !await confirmDiscard('撤回已保存版本会放弃当前未保存草稿，确认继续？')) {
          return 'cancelled' as const
        }
        await store.undoTemplateSave(operationProjectId, result.logIds, isCurrentProject)
        if (!isCurrentProject) {
          warning('已撤回原项目的模板保存；当前项目与草稿保持不变')
          return
        }
        if (store.templateError) {
          warning(store.templateError)
          open.value = false
        }
        else if (workspace.value) {
          const restored = workspace.value.templates.find(template => template.id === result.templateId)
            ?? workspace.value.templates[0]
          selectDraft(restored?.id ?? '')
        }
      })
    }
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function removeTemplate() {
  const template = selectedTemplate.value
  if (!template || template.unitCount || store.templateSaving || store.templateLoading || initializing.value)
    return
  const approved = await confirm({
    variant: 'simple',
    title: '删除户型模板',
    message: `确认删除未挂靠任何户的「${template.name}」？模板房间与三量将一并隐藏。`,
    confirmLabel: '删除模板',
  })
  if (!approved)
    return
  try {
    const operationProjectId = template.projectId
    let logId: string
    try {
      logId = await store.deleteTemplate(template.id)
    }
    catch (cause) {
      if (!toErrorMessage(cause).includes('已归档'))
        throw cause
      if (!await confirmArchivedEdit('删除户型模板'))
        return
      logId = await store.deleteTemplate(template.id, { allowArchivedEdit: true })
    }
    if (workspace.value) {
      const next = workspace.value.templates[0]
      selectDraft(next?.id ?? '')
    }
    else {
      draft.value = null
      open.value = false
    }
    if (store.templateError)
      warning(store.templateError)
    undoToast(`已删除「${template.name}」`, async () => {
      const isCurrentProject = props.projectId === operationProjectId
      if (isCurrentProject && !await confirmDiscard('恢复已删除模板会放弃当前未保存草稿，确认继续？')) {
        return 'cancelled' as const
      }
      await store.undoTemplateSave(operationProjectId, [logId], isCurrentProject)
      if (!isCurrentProject) {
        warning('已恢复原项目的模板；当前项目与草稿保持不变')
        return
      }
      if (store.templateError) {
        warning(store.templateError)
        open.value = false
      }
      else if (workspace.value) {
        const restored = workspace.value.templates.find(candidate => candidate.id === template.id)
          ?? workspace.value.templates[0]
        selectDraft(restored?.id ?? '')
      }
    })
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

onBeforeRouteLeave(async () => {
  if (!open.value)
    return true
  return confirmDiscard('离开工程量页面会放弃当前未保存的户型模板草稿，确认继续？')
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!open.value || (!dirty.value && !store.templateSaving))
    return
  event.preventDefault()
  event.returnValue = ''
})
</script>

<template>
  <FormDialog
    :open="open"
    :busy="store.templateSaving"
    title="户型模板与三量"
    :sections="sections"
    save-label="保存模板"
    width="min(1180px, calc(100dvw - var(--space-6, 24px)))"
    @save="save"
    @cancel="requestClose"
  >
    <section v-if="initializing" class="flex min-h-48 items-center justify-center gap-2" role="status">
      <span class="i-lucide-loader-circle animate-spin text-brand" aria-hidden="true" />
      <span class="text-12px text-ink-soft">正在读取户型模板…</span>
    </section>

    <section v-else-if="store.templateError && !draft" class="rounded-[var(--radius-btn)] border border-danger/35 bg-danger-soft p-4" role="alert">
      <div class="text-13px font-800 text-danger">
        户型模板加载失败
      </div>
      <p class="mt-1 text-12px text-ink-soft">
        {{ store.templateError }}
      </p>
    </section>

    <template v-else-if="draft && workspace">
      <fieldset :disabled="store.templateSaving || store.templateLoading || initializing" class="contents">
        <QuantityTemplateBasicSection
          v-model:code="draft.code"
          v-model:name="draft.name"
          :templates="workspace.templates"
          :selected-template-id="selectedTemplateId"
          :selected-template="selectedTemplate"
          :copied-from-template-id="draft.copiedFromTemplateId"
          :dirty="dirty"
          @template-change="requestTemplateChange"
          @create-blank="createBlank"
          @borrow-current="borrowCurrent"
        />

        <QuantityTemplateRoomsSection
          :rooms="draft.rooms"
          @add="addRoom"
          @remove="removeRoom"
          @update-room="updateRoom"
        />

        <QuantityTemplateLinesSection
          :rooms="draft.rooms"
          :new-items="draft.newItems"
          :lines="draft.lines"
          :item-options="itemOptions"
          @add-manual-item="addManualItem"
          @add-line="addLine()"
          @remove-new-item="removeNewItem"
          @remove-line="removeLine"
          @update-new-item="updateNewItem"
          @update-line="updateLine"
        />
      </fieldset>
    </template>

    <template #actions>
      <button
        v-if="draft && selectedTemplate"
        type="button"
        class="btn-danger mr-auto"
        :disabled="selectedTemplate.unitCount > 0 || store.templateSaving || store.templateLoading || initializing"
        :title="selectedTemplate.unitCount ? `仍挂靠 ${selectedTemplate.unitCount} 户，不能删除` : '删除未挂靠模板'"
        @click="removeTemplate"
      >
        删除模板
      </button>
    </template>
  </FormDialog>
</template>
