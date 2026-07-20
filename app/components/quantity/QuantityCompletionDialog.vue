<script setup lang="ts">
import type {
  QuantityCompletionStageView,
  QuantityCompletionWarning,
  QuantityCompletionWorkspace,
} from '~/lib/quantity/completion'
import type { QuantityCompletionStatus } from '~/lib/quantity/read-model'
import { useBase64, useEventListener, useFileDialog } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import { formatQuantityValue } from '~/lib/quantity/format'
import { toErrorMessage } from '~/lib/util/error'

const props = withDefaults(defineProps<{
  projectId: string
  unitId: string
  initialStageId?: string
}>(), {
  initialStageId: '',
})

const open = defineModel<boolean>('open', { required: true })
const store = useQuantityStore()
const { confirm, error, success, warning } = useKitUI()

interface DraftPhoto {
  fileName: string
  mimeType: string
  fileSize: number
  contentBase64: string
}

const selectedStageId = shallowRef('')
const status = shallowRef<QuantityCompletionStatus>('completed')
const completedAt = shallowRef('')
const note = ref('')
const newPhotos = ref<DraftPhoto[]>([])
const baseline = shallowRef('')
const initializing = shallowRef(false)
let initializeSequence = 0

const sections = [
  { key: 'stage', label: '工序阶段' },
  { key: 'record', label: '完成登记' },
]

const statusTabs = [
  { key: 'completed', label: '登记完成' },
  { key: 'draft', label: '保存草稿' },
]

const workspace = computed<QuantityCompletionWorkspace | null>(() => (
  store.completionWorkspace?.projectId === props.projectId
  && store.completionWorkspace.unit.id === props.unitId
    ? store.completionWorkspace
    : null
))

const selectedStage = computed(() => (
  workspace.value?.stages.find(stage => stage.id === selectedStageId.value) ?? null
))

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function draftSignature(): string {
  return JSON.stringify({
    stageId: selectedStageId.value,
    status: status.value,
    completedAt: completedAt.value,
    note: note.value,
    photos: newPhotos.value.map(photo => photo.fileName),
  })
}

const dirty = computed(() => baseline.value !== '' && draftSignature() !== baseline.value)

function hydrateStage(stage: QuantityCompletionStageView | null) {
  status.value = stage?.completion?.status ?? 'completed'
  completedAt.value = stage?.completion?.completedAt?.slice(0, 10) ?? today()
  note.value = stage?.completion?.note ?? ''
  newPhotos.value = []
  baseline.value = draftSignature()
}

async function initialize(sequence: number, projectId: string, unitId: string) {
  try {
    await store.loadCompletion(projectId, unitId)
    if (sequence !== initializeSequence || !open.value || props.projectId !== projectId || !workspace.value)
      return
    const stages = workspace.value.stages
    const initial = stages.find(stage => stage.id === props.initialStageId) ?? stages[0] ?? null
    selectedStageId.value = initial?.id ?? ''
    hydrateStage(initial)
  }
  catch (cause) {
    if (sequence === initializeSequence)
      error(`完成登记加载失败：${toErrorMessage(cause)}`)
  }
  finally {
    if (sequence === initializeSequence)
      initializing.value = false
  }
}

function requestInitialize(isOpen: boolean, projectId: string, unitId: string) {
  const sequence = ++initializeSequence
  baseline.value = ''
  selectedStageId.value = ''
  newPhotos.value = []
  if (!isOpen || !projectId || !unitId) {
    initializing.value = false
    return
  }
  initializing.value = true
  void initialize(sequence, projectId, unitId)
}

watch(
  [open, () => props.projectId, () => props.unitId, () => props.initialStageId],
  ([isOpen, projectId, unitId]) => requestInitialize(isOpen, projectId, unitId),
  { immediate: true },
)

async function confirmDiscard(message = '当前完成登记有未保存的输入，确认放弃？'): Promise<boolean> {
  if (store.completionSaving) {
    warning('完成登记正在提交，请等待保存完成')
    return false
  }
  if (!dirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃未保存登记',
    message,
    confirmLabel: '放弃输入',
  })
}

async function selectStage(stageId: string) {
  if (stageId === selectedStageId.value)
    return
  if (!await confirmDiscard('切换阶段会放弃当前未保存的登记输入，确认切换？'))
    return
  selectedStageId.value = stageId
  hydrateStage(selectedStage.value)
}

const { open: openPhotoPicker, onChange: onPhotoPicked, reset: resetPhotoPicker } = useFileDialog({
  accept: 'image/*',
  multiple: true,
})

onPhotoPicked(async (files) => {
  if (!files?.length)
    return
  try {
    for (const file of Array.from(files)) {
      const dataUrl = await useBase64(file).promise.value
      newPhotos.value.push({
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        fileSize: file.size,
        contentBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      })
    }
  }
  catch (cause) {
    error(`验收照片读取失败：${toErrorMessage(cause)}`)
  }
  finally {
    resetPhotoPicker()
  }
})

function removeNewPhoto(index: number) {
  newPhotos.value.splice(index, 1)
}

function stageStatusLabel(stage: QuantityCompletionStageView): string {
  if (stage.completion?.status === 'completed')
    return `已完成 ${stage.completion.completedAt?.slice(0, 10) ?? ''}`.trim()
  if (stage.completion?.status === 'draft')
    return '草稿'
  return '未登记'
}

function warningLabel(item: QuantityCompletionWarning): string {
  return item.code === 'prior-photo-missing'
    ? `上一阶段「${item.stageName}」已完成但缺验收照片`
    : `上一阶段「${item.stageName}」尚未完成`
}

async function confirmArchivedEdit(): Promise<boolean> {
  return confirm({
    variant: 'simple',
    title: '修改已归档矩阵',
    message: '当前工程量矩阵已归档。继续修改完成事实会保留操作日志，确认继续？',
    confirmLabel: '确认修改',
  })
}

async function save() {
  if (store.completionSaving || store.completionLoading || initializing.value)
    return
  const source = workspace.value
  const stage = selectedStage.value
  if (!source || !stage) {
    warning('请先选择工序阶段')
    return
  }

  let effectiveStatus = status.value
  if (effectiveStatus === 'completed' && !completedAt.value) {
    warning('请填写完成日期')
    return
  }
  if (effectiveStatus === 'completed' && !stage.currentAssignment) {
    warning('该户当前工种还没有责任人，请先在责任配置中指派')
    return
  }
  // 缺照片软卡（蓝本§四）：只能取消或保存到草稿，输入不丢。
  if (effectiveStatus === 'completed' && !newPhotos.value.length && !stage.photos.length) {
    const toDraft = await confirm({
      variant: 'simple',
      title: '缺少验收照片',
      message: '本次登记没有验收照片。可以先保存到草稿，补拍后再登记完成；取消则留在当前输入。',
      confirmLabel: '保存到草稿',
    })
    if (!toDraft)
      return
    effectiveStatus = 'draft'
    status.value = 'draft'
  }

  const draft = {
    projectId: props.projectId,
    unitId: props.unitId,
    stageId: stage.id,
    status: effectiveStatus,
    completedAt: completedAt.value || null,
    note: note.value,
    expectedCompletionId: stage.completion?.id ?? null,
    expectedCompletionFingerprint: stage.completion?.fingerprint ?? null,
    expectedAssignmentId: stage.currentAssignment?.id ?? null,
    photos: newPhotos.value.map(photo => ({ ...photo })),
    allowArchivedEdit: false,
  }

  if (source.matrixArchivedAt) {
    if (!await confirmArchivedEdit())
      return
    draft.allowArchivedEdit = true
  }

  try {
    const result = await store.saveCompletion(draft)
    if (!result.changed) {
      warning('当前阶段登记没有需要保存的变化')
      return
    }
    success(effectiveStatus === 'completed'
      ? `已登记「${stage.name}」完成`
      : `已保存「${stage.name}」草稿`)
    if (store.completionError)
      warning(store.completionError)
    hydrateStage(selectedStage.value)
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
}

async function requestClose() {
  if (!await confirmDiscard())
    return
  open.value = false
}

function retry() {
  requestInitialize(open.value, props.projectId, props.unitId)
}

onBeforeRouteLeave(async () => {
  if (!open.value)
    return true
  return confirmDiscard('离开工程量页面会放弃当前完成登记输入，确认继续？')
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
    :title="workspace ? `${workspace.unit.buildingName} ${workspace.unit.floorName} ${workspace.unit.name} · 阶段完成登记` : '阶段完成登记'"
    :sections="sections"
    :save-label="status === 'draft' ? '保存草稿' : '登记完成'"
    width="min(960px, calc(100dvw - var(--space-6, 24px)))"
    :busy="store.completionSaving"
    @save="save"
    @cancel="requestClose"
  >
    <section
      v-if="initializing || (store.completionLoading && !workspace)"
      class="flex min-h-72 flex-col items-center justify-center gap-3 text-center"
      role="status"
      aria-busy="true"
    >
      <span class="i-lucide-loader-circle animate-spin text-24px text-brand" aria-hidden="true" />
      <p class="text-13px font-700 text-ink">
        正在读取完成登记…
      </p>
    </section>

    <section v-else-if="store.completionError && !workspace" class="flex min-h-72 flex-col items-center justify-center gap-3 text-center" role="alert">
      <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
      <p class="max-w-xl text-12px text-ink-soft">
        {{ store.completionError }}
      </p>
      <button type="button" class="btn-primary" @click="retry">
        重新加载
      </button>
    </section>

    <fieldset
      v-else-if="workspace"
      data-testid="quantity-completion-fields"
      class="m-0 min-w-0 border-0 p-0"
      :class="store.completionSaving ? 'pointer-events-none opacity-70' : ''"
      :disabled="store.completionSaving || store.completionLoading || initializing"
    >
      <div class="grid gap-7">
        <section id="form-section-stage" class="scroll-mt-4 grid gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <div>
              <h3 class="text-14px font-800 text-ink">
                工序阶段
              </h3>
              <p class="mt-1 text-12px text-ink-soft">
                完成归户 × 工序阶段；墙砖/地砖、一遍/二遍腻子分别登记状态与日期。
              </p>
            </div>
            <span v-if="workspace.matrixArchivedAt" class="status-warn ml-auto">
              已归档 · 修改需二次确认
            </span>
          </div>

          <p v-if="!workspace.stages.length" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-3 text-12px text-ink-soft">
            当前项目还没有按户完成的工序阶段。
          </p>
          <div v-else class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="stage in workspace.stages"
              :key="stage.id"
              type="button"
              class="min-w-0 border rounded-[var(--radius-btn)] px-3 py-2.5 text-left outline-none transition-colors focus-visible:[box-shadow:0_0_0_3px_var(--brand-ring)]"
              :class="stage.id === selectedStageId
                ? 'border-brand bg-brand-soft/40'
                : 'border-line bg-surface-2 hover:border-line-strong'"
              :aria-pressed="stage.id === selectedStageId"
              @click="selectStage(stage.id)"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="truncate text-13px font-800 text-ink">{{ stage.name }}</span>
                <span class="ml-auto flex-none text-11px" :class="stage.completion?.status === 'completed' ? 'text-ok' : stage.completion ? 'text-warn-ink' : 'text-ink-faint'">
                  {{ stageStatusLabel(stage) }}
                </span>
              </span>
              <span class="mt-1 flex min-w-0 items-center gap-2 text-11px text-ink-soft">
                <span class="flex-none">{{ stage.trade }}</span>
                <span class="truncate">{{ stage.currentAssignment?.assigneeName ?? '未指派责任' }}</span>
                <span v-if="stage.photos.length" class="ml-auto flex-none text-ink-faint">
                  照片 {{ stage.photos.length }}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section id="form-section-record" class="scroll-mt-4 grid gap-4 border-t border-line pt-6">
          <div>
            <h3 class="text-14px font-800 text-ink">
              完成登记
            </h3>
            <p class="mt-1 text-12px text-ink-soft">
              带出当前责任、活链接三量与计划信息；验收照片随完成事实归档。
            </p>
          </div>

          <p v-if="!selectedStage" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-3 text-12px text-ink-soft">
            请选择要登记的工序阶段。
          </p>
          <template v-else>
            <div
              v-for="item in selectedStage.warnings"
              :key="`${item.code}:${item.stageId}`"
              class="flex items-start gap-2 rounded-[var(--radius-btn)] bg-warn-soft px-3 py-2.5 text-12px text-warn-ink"
              role="note"
            >
              <span class="i-lucide-triangle-alert mt-0.5 flex-none" aria-hidden="true" />
              <span>{{ warningLabel(item) }}；仅作风险提示，不影响本次登记。</span>
            </div>

            <div class="grid gap-3 border border-line rounded-[var(--radius-card)] bg-surface-2 p-3 sm:grid-cols-3">
              <div class="min-w-0">
                <div class="field-label">
                  当前责任
                </div>
                <div class="mt-1 truncate text-13px font-700 text-ink">
                  {{ selectedStage.currentAssignment?.assigneeName ?? '未指派' }}
                </div>
              </div>
              <div class="min-w-0">
                <div class="field-label">
                  完成时执行责任
                </div>
                <div class="mt-1 truncate text-13px text-ink">
                  {{ selectedStage.completion?.executionAssigneeName ?? '—' }}
                </div>
              </div>
              <div class="min-w-0">
                <div class="field-label">
                  计划区间
                </div>
                <div class="mt-1 truncate text-13px text-ink">
                  {{ workspace.planWindow ? `${workspace.planWindow.plannedStartAt} ~ ${workspace.planWindow.plannedEndAt}` : '未排期' }}
                </div>
              </div>
            </div>

            <div class="min-w-0 overflow-x-auto border border-line rounded-[var(--radius-card)]">
              <table class="w-full min-w-120 border-collapse text-12px">
                <caption class="sr-only">
                  {{ selectedStage.name }}对应的房间分项与三量
                </caption>
                <thead>
                  <tr class="bg-surface-2 text-left text-11px text-ink-soft">
                    <th scope="col" class="px-3 py-2 font-700">
                      房间
                    </th>
                    <th scope="col" class="px-3 py-2 font-700">
                      分项
                    </th>
                    <th scope="col" class="px-3 py-2 font-700">
                      单位
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-700">
                      合同量
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-700">
                      暂定量
                    </th>
                    <th scope="col" class="px-3 py-2 text-right font-700">
                      现场量
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!selectedStage.quantities.length">
                    <td colspan="6" class="px-3 py-3 text-ink-soft">
                      该阶段分项在当前户型模板中没有量明细。
                    </td>
                  </tr>
                  <tr v-for="line in selectedStage.quantities" :key="`${line.roomId}:${line.itemId}`" class="border-t border-line">
                    <td class="px-3 py-2 text-ink">
                      {{ line.roomName }}
                    </td>
                    <td class="px-3 py-2 text-ink">
                      {{ line.itemName }}
                    </td>
                    <td class="px-3 py-2 text-ink-soft">
                      {{ line.unit || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right text-ink font-mono">
                      {{ formatQuantityValue(line.contractQty) }}
                      <span
                        v-if="line.recognizedContractQty != null && line.recognizedContractQty !== line.contractQty"
                        class="block text-10px text-ink-faint"
                      >识别 {{ line.recognizedContractQty }}</span>
                    </td>
                    <td class="px-3 py-2 text-right text-ink font-mono">
                      {{ formatQuantityValue(line.provisionalQty) }}
                    </td>
                    <td class="px-3 py-2 text-right text-ink font-mono">
                      {{ formatQuantityValue(line.fieldQty) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="grid gap-1.5">
                <span class="field-label">登记方式</span>
                <SegTab v-model="status" :tabs="statusTabs" />
              </div>
              <label class="grid gap-1.5">
                <span class="field-label">完成日期</span>
                <input
                  v-model="completedAt"
                  type="date"
                  class="field-input w-full"
                  :required="status === 'completed'"
                >
              </label>
            </div>

            <label class="grid gap-1.5">
              <span class="field-label">备注</span>
              <textarea
                v-model="note"
                class="field-input min-h-18 w-full resize-y"
                maxlength="500"
                placeholder="可选；随完成事实留存"
              />
            </label>

            <div class="grid gap-2">
              <div class="flex items-center gap-3">
                <span class="field-label">验收照片</span>
                <button type="button" class="btn-secondary ml-auto" @click="openPhotoPicker()">
                  <span class="i-lucide-image-plus mr-1" aria-hidden="true" />
                  添加照片
                </button>
              </div>
              <p v-if="!selectedStage.photos.length && !newPhotos.length" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2.5 text-12px text-ink-soft">
                尚无验收照片；缺照片时只能保存到草稿。
              </p>
              <ul v-else class="grid gap-1.5">
                <li
                  v-for="photo in selectedStage.photos"
                  :key="photo.id"
                  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2 text-12px"
                >
                  <span class="i-lucide-image flex-none text-ink-faint" aria-hidden="true" />
                  <span class="truncate text-ink">{{ photo.fileName }}</span>
                  <span class="ml-auto flex-none text-11px text-ink-faint">已归档</span>
                </li>
                <li
                  v-for="(photo, index) in newPhotos"
                  :key="`${photo.fileName}:${index}`"
                  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-btn)] border border-brand/40 bg-brand-soft/30 px-3 py-2 text-12px"
                >
                  <span class="i-lucide-image-up flex-none text-brand" aria-hidden="true" />
                  <span class="truncate text-ink">{{ photo.fileName }}</span>
                  <button
                    type="button"
                    class="icon-btn ml-auto flex-none"
                    :aria-label="`移除照片 ${photo.fileName}`"
                    @click="removeNewPhoto(index)"
                  >
                    <span class="i-lucide-x text-12px" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </section>
      </div>
    </fieldset>
  </FormDialog>
</template>
