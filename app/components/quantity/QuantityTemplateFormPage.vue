<script setup lang="ts">
import type { QuantityBoqLine } from '~/lib/quantity/central-boq'
import type {
  QuantityTemplateDraft,
  QuantityTemplateLineDraft,
  QuantityTemplateNewItemDraft,
  QuantityTemplateRoomDraft,
} from '~/lib/quantity/template'
import type { DataOriginDTO } from '~/types/read-model'
import { useEventListener } from '@vueuse/core'
import { onActivated, onDeactivated } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import KitButton from '~/components/ui/KitButton.vue'
import { quantityMatrixReturnPath } from '~/lib/quantity/navigation'
import {
  blankQuantityTemplateDraft,
  borrowedQuantityTemplateDraft,
  editableQuantityTemplateDraft,
} from '~/lib/quantity/template'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  initialBoqLineId?: string
  origin?: DataOriginDTO | null
}>()

const store = useQuantityStore()
const route = useRoute()
const router = useRouter()
const { confirm, error, success, undoToast, warning } = useKitUI()

const selectedTemplateId = shallowRef('')
const draft = ref<QuantityTemplateDraft | null>(null)
const baseline = shallowRef('')
const initializing = shallowRef(false)
const loadingAction = shallowRef<'save' | null>(null)
const boqLines = shallowRef<readonly QuantityBoqLine[]>([])
const boqLoading = shallowRef(false)
const boqError = shallowRef('')
const resumeFailed = shallowRef(false)
let boqRequest: AbortController | null = null
let localSequence = 0
let initializeSequence = 0
let allowLeave = false
let active = true

interface RoomUpdate { key: string, field: 'code' | 'name', value: string }
interface NewItemUpdate { key: string, field: 'code' | 'name' | 'trade' | 'unit', value: string }
type LineUpdate
  = | { key: string, field: 'roomKey' | 'itemId' | 'fieldFormula' | 'note', value: string }
    | { key: string, field: 'contractQty' | 'provisionalQty', value: number | null }
    | { key: string, field: 'boqLineId', value: string | null }

const sections = [
  { key: 'basic', label: '模板信息' },
  { key: 'rooms', label: '稳定房间' },
  { key: 'items', label: '三量明细' },
]

const workspace = computed(() => props.origin !== null && store.templateOrigin === (props.origin ?? 'real') && store.templateWorkspace?.projectId === props.projectId
  ? store.templateWorkspace
  : null)
const selectedTemplate = computed(() => workspace.value?.templates.find(template => template.id === selectedTemplateId.value) ?? null)
const originalBoqIds = computed(() => Object.fromEntries((draft.value?.lines ?? []).map(line => [line.key, workspace.value?.lines.find(original => original.id === (line.id ?? line.sourceLineId))?.boqLineId ?? null])))
const dirty = computed(() => draft.value != null && JSON.stringify(draft.value) !== baseline.value)
const shellState = computed(() => {
  if (!props.projectId || props.origin === null)
    return 'error'
  if (initializing.value)
    return 'loading'
  if (store.templateError && !draft.value)
    return 'error'
  return 'ready'
})
const shellDescription = computed(() => props.origin === null
  ? '工程量来源无效，请从项目列表重新打开。'
  : props.projectId
    ? store.templateError
    : '请从工程量矩阵选择项目后进入户型模板。')
const returnLabel = computed(() => route.query.return === 'region'
  ? '返回区域配置'
  : '返回工程量矩阵')
const returnTo = computed(() => {
  if (route.query.return === 'region') {
    const returnToSchedule = route.query.from === 'schedule' || route.query.origin === 'schedule'
    return {
      path: '/subcontract/quantity/region',
      query: {
        project: props.projectId,
        origin: props.origin ?? 'real',
        return: returnToSchedule ? 'schedule' : undefined,
        resume: returnToSchedule && route.query.resume === 'region' ? 'region' : undefined,
      },
    }
  }
  return quantityMatrixReturnPath(route.query)
})
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

async function loadBoq() {
  boqRequest?.abort()
  const controller = new AbortController()
  boqRequest = controller
  boqLines.value = []
  boqError.value = ''
  if (!store.canLinkBoq) {
    boqLoading.value = false
    return
  }
  boqLoading.value = true
  try {
    const response = await store.loadBoq(props.projectId, { signal: controller.signal })
    if (boqRequest === controller && !controller.signal.aborted)
      boqLines.value = response.data.lines
  }
  catch (cause) {
    if (boqRequest === controller && !controller.signal.aborted)
      boqError.value = `合同清单读取失败：${toErrorMessage(cause)}`
  }
  finally {
    if (boqRequest === controller)
      boqLoading.value = false
  }
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
  if (sequence !== initializeSequence || props.projectId !== projectId)
    return
  try {
    if (props.origin === null)
      return
    await store.loadTemplates(projectId, props.origin ?? 'real')
    if (sequence !== initializeSequence || props.projectId !== projectId || workspace.value?.projectId !== projectId)
      return
    void loadBoq()
    const linkedLine = props.initialBoqLineId
      ? workspace.value.lines.find(line => line.boqLineId === props.initialBoqLineId)
      : null
    const linkedRoom = linkedLine
      ? workspace.value.rooms.find(room => room.id === linkedLine.roomId)
      : null
    const preferred = workspace.value.templates.find(template => template.id === linkedRoom?.templateId)
      ?? workspace.value.templates.find(template => template.id === selectedTemplateId.value)
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

function requestInitialize(projectId: string) {
  resumeFailed.value = false
  boqRequest?.abort()
  boqLines.value = []
  boqError.value = ''
  const sequence = ++initializeSequence
  draft.value = null
  baseline.value = ''
  if (!projectId) {
    initializing.value = false
    return
  }

  initializing.value = true
  void initialize(sequence, projectId)
}

watch(
  [() => props.projectId, () => props.initialBoqLineId, () => props.origin],
  ([projectId]) => {
    if (active)
      requestInitialize(projectId)
  },
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

function discardLocalDraft() {
  if (!baseline.value)
    return
  draft.value = JSON.parse(baseline.value) as QuantityTemplateDraft
}

async function requestClose() {
  if (!await confirmDiscard())
    return
  discardLocalDraft()
  allowLeave = true
  await router.push(returnTo.value)
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
    case 'boqLineId':
      line.boqLineId = payload.value
      line.boqBindingVersion = boqLines.value.find(row => row.id === payload.value)?.bindingVersion
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

async function undoTemplateOperation(projectId: string, logIds: readonly string[], reloadProject: boolean): Promise<boolean> {
  try {
    await store.undoTemplateSave(projectId, logIds, reloadProject)
  }
  catch (cause) {
    if (!toErrorMessage(cause).includes('已归档'))
      throw cause
    if (!await confirmArchivedEdit('撤回模板操作'))
      return false
    await store.undoTemplateSave(projectId, logIds, reloadProject, { allowArchivedEdit: true })
  }
  return true
}

async function save() {
  if (!store.templateCanWrite || !draft.value || store.templateSaving || store.templateLoading || initializing.value)
    return
  if (!dirty.value) {
    warning('当前模板没有需要保存的修改')
    return
  }
  try {
    loadingAction.value = 'save'
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
        if (!await undoTemplateOperation(operationProjectId, result.logIds, isCurrentProject))
          return 'cancelled' as const
        if (!isCurrentProject) {
          warning('已撤回原项目的模板保存；当前项目与草稿保持不变')
          return
        }
        if (store.templateError) {
          warning(store.templateError)
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
  finally {
    loadingAction.value = null
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
    }
    if (store.templateError)
      warning(store.templateError)
    undoToast(`已删除「${template.name}」`, async () => {
      const isCurrentProject = props.projectId === operationProjectId
      if (isCurrentProject && !await confirmDiscard('恢复已删除模板会放弃当前未保存草稿，确认继续？')) {
        return 'cancelled' as const
      }
      if (!await undoTemplateOperation(operationProjectId, [logId], isCurrentProject))
        return 'cancelled' as const
      if (!isCurrentProject) {
        warning('已恢复原项目的模板；当前项目与草稿保持不变')
        return
      }
      if (store.templateError) {
        warning(store.templateError)
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
  if (allowLeave)
    return true
  const approved = await confirmDiscard('离开工程量页面会放弃当前未保存的户型模板草稿，确认继续？')
  if (approved)
    discardLocalDraft()
  return approved
})
onBeforeRouteUpdate(async () => {
  const approved = await confirmDiscard('切换项目或来源会放弃当前未保存的模板输入，确认继续？')
  if (approved)
    discardLocalDraft()
  return approved
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!dirty.value && !store.templateSaving)
    return
  event.preventDefault()
  event.returnValue = ''
})

let activated = false
async function resumePermissions() {
  try {
    if (await store.revalidateTemplate())
      resumeFailed.value = false
  }
  catch {
    resumeFailed.value = true
  }
}
onActivated(async () => {
  active = true
  allowLeave = false
  if (activated) {
    if (dirty.value)
      await resumePermissions()
    else
      requestInitialize(props.projectId)
  }
  activated = true
})
onDeactivated(() => {
  active = false
  initializeSequence++
  boqRequest?.abort()
  store.cancelTemplate()
})

useTabTitle(() => selectedTemplate.value
  ? `编辑 · ${selectedTemplate.value.name || selectedTemplate.value.code}户型模板`
  : '新建 · 户型模板')
</script>

<template>
  <QuantityCommandRecovery surface="templates" :project-id="projectId" />
  <EntityFormShell
    data-testid="quantity-template-form"
    title="户型模板与三量"
    subtitle="房间、分项与三量属于同一户型模板；保存后挂靠户通过活链接同步读取。"
    :back-label="returnLabel"
    :sections="sections"
    :state="shellState"
    state-title="户型模板加载失败"
    :state-description="shellDescription"
    state-action-label="重新加载"
    @back="requestClose"
    @state-action="requestInitialize(projectId)"
  >
    <template #status>
      <span v-if="origin === 'demo'" class="status-warn">演示数据只读</span>
      <span v-if="selectedTemplate" class="chip-brand">活链接 {{ selectedTemplate.unitCount }} 户</span>
      <span v-if="dirty" class="status-warn">有未保存修改</span>
    </template>

    <template #actions>
      <KitButton
        v-if="store.templateCanWrite && draft && selectedTemplate"
        type="button"
        variant="danger" class=""
        :disabled="selectedTemplate.unitCount > 0 || store.templateSaving || store.templateLoading || initializing"
        :title="selectedTemplate.unitCount ? `仍挂靠 ${selectedTemplate.unitCount} 户，不能删除` : '删除未挂靠模板'"
        @click="removeTemplate"
      >
        删除模板
      </KitButton>
    </template>

    <section v-if="draft && workspace" class="panel min-w-0 p-4">
      <div v-if="resumeFailed" class="mb-3 flex flex-wrap items-center gap-2 text-12px text-danger" role="alert">
        <span>{{ store.templateError || '当前权限暂时无法读取，输入已保留。' }}</span>
        <KitButton variant="secondary" @click="resumePermissions">
          重新核验权限
        </KitButton>
      </div>
      <div v-if="store.canLinkBoq && boqError" class="mb-3 flex flex-wrap items-center gap-2 text-12px text-danger" role="alert">
        <span>{{ boqError }}</span>
        <KitButton variant="secondary" :loading="boqLoading" @click="loadBoq">
          重新读取清单
        </KitButton>
      </div>
      <fieldset :disabled="store.templateSaving || store.templateLoading || initializing" class="contents">
        <QuantityTemplateBasicSection
          v-model:code="draft.code"
          v-model:name="draft.name"
          :templates="workspace.templates"
          :selected-template-id="selectedTemplateId"
          :selected-template="selectedTemplate"
          :copied-from-template-id="draft.copiedFromTemplateId"
          :dirty="dirty"
          :readonly="!store.templateCanWrite"
          @template-change="requestTemplateChange"
          @create-blank="createBlank"
          @borrow-current="borrowCurrent"
        />

        <fieldset :disabled="!store.templateCanWrite" class="contents">
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
            :can-link-boq="store.canLinkBoq"
            :boq-lines="boqLines"
            :original-boq-ids="originalBoqIds"
            :boq-loading="boqLoading"
            :boq-error="boqError"
            @add-manual-item="addManualItem"
            @add-line="addLine()"
            @remove-new-item="removeNewItem"
            @remove-line="removeLine"
            @update-new-item="updateNewItem"
            @update-line="updateLine"
          />
        </fieldset>
      </fieldset>
    </section>

    <template #footer>
      <FormFooter
        :actions="store.templateCanWrite ? ['cancel', 'save'] : ['cancel']"
        :labels="{ save: '保存模板' }"
        :dirty="dirty"
        :loading-action="loadingAction"
        @action="(action) => action === 'save' ? save() : requestClose()"
      />
    </template>
  </EntityFormShell>
</template>
