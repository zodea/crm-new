<script setup lang="ts">
import type { QuantityCompletionQuantityLine, QuantityCompletionStageView } from '~/lib/quantity/completion'
import type { DataOriginDTO } from '~/types/read-model'
import { nextTick, onActivated, onDeactivated, onScopeDispose } from 'vue'
import QuantityTotalValue from '~/components/quantity/QuantityTotalValue.vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { payrollSourceContext, payrollSourceQuery } from '~/lib/payroll/a-navigation'
import { formatQuantityValue } from '~/lib/quantity/format'
import { sumQuantityLines } from '~/lib/quantity/totals'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  unitId: string
  returnTo?: string
  origin?: DataOriginDTO | null
  payrollQuery?: Record<string, unknown>
}>()

const store = useQuantityStore()
const detailElement = shallowRef<HTMLElement | null>(null)
const payrollContext = computed(() => props.origin ? payrollSourceContext(props.payrollQuery ?? {}, { kind: 'quantity-unit', id: props.unitId, origin: props.origin, projectId: props.projectId }) : null)
const payrollMatrix = computed(() => payrollContext.value ? { path: '/subcontract/quantity', query: { ...payrollSourceQuery(props.payrollQuery ?? {}), payrollSourceKind: 'quantity-project', payrollSourceId: props.projectId, project: props.projectId, origin: props.origin ?? 'real' } } : null)
const { error: toastError } = useKitUI()

const completionDialogOpen = shallowRef(false)
const completionInitialStageId = shallowRef('')
const previewPhoto = shallowRef<{ fileName: string, dataUrl: string | null } | null>(null)
let photoRequest: AbortController | null = null
let activated = false
let active = true

function closePhoto() {
  photoRequest?.abort()
  photoRequest = null
  previewPhoto.value = null
}

// 验收照片正文惰性读取（蓝本§五「展示…验收照片」）：点击 chip 才拉 payload。
async function openPhotoPreview(stage: QuantityCompletionStageView, photo: { id: string, fileName: string }) {
  if (!stage.completion || props.origin === null)
    return
  closePhoto()
  const controller = new AbortController()
  photoRequest = controller
  previewPhoto.value = { fileName: photo.fileName, dataUrl: null }
  try {
    const content = await store.loadPhoto({ projectId: props.projectId, unitId: props.unitId, completionId: stage.completion.id, photoId: photo.id }, props.origin ?? 'real', { signal: controller.signal })
    if (photoRequest !== controller || controller.signal.aborted)
      return
    previewPhoto.value = {
      fileName: content.fileName,
      dataUrl: `data:${content.mimeType};base64,${content.contentBase64}`,
    }
  }
  catch (cause) {
    if (photoRequest !== controller || controller.signal.aborted)
      return
    closePhoto()
    toastError(`验收照片加载失败：${toErrorMessage(cause)}`)
  }
}

const workspace = computed(() => (
  props.origin !== null && store.completionOrigin === (props.origin ?? 'real') && store.completionWorkspace?.projectId === props.projectId
  && store.completionWorkspace.unit.id === props.unitId
    ? store.completionWorkspace
    : null
))
let payrollFocusSequence = 0
async function focusPayrollStage() {
  const stageId = props.payrollQuery?.stageId
  const completionId = props.payrollQuery?.completionId
  const value = workspace.value
  const request = ++payrollFocusSequence
  if (!active || !payrollContext.value || !value || typeof stageId !== 'string')
    return
  const stage = value.stages.find(stage => stage.id === stageId && (!completionId || stage.completion?.id === completionId))
  if (!stage)
    return
  await nextTick()
  if (!active || request !== payrollFocusSequence || value !== workspace.value)
    return
  const element = [...detailElement.value?.querySelectorAll<HTMLElement>('[data-payroll-stage]') ?? []].find(element => element.dataset.payrollStage === stageId)
  element?.scrollIntoView({ block: 'center' })
  element?.focus({ preventScroll: true })
}
watch([workspace, () => props.payrollQuery], () => void focusPayrollStage(), { flush: 'post' })

useTabTitle(() => workspace.value
  ? `${workspace.value.unit.name} 施工详情`
  : undefined)

// 蓝本§五：按「工种 → 工序阶段 → 完成日期」组织；阶段顺序沿用领域 sort_order。
const tradeGroups = computed(() => {
  const groups = new Map<string, QuantityCompletionStageView[]>()
  for (const stage of workspace.value?.stages ?? []) {
    const list = groups.get(stage.trade) ?? []
    list.push(stage)
    groups.set(stage.trade, list)
  }
  return [...groups.entries()].map(([trade, stages]) => ({ trade, stages }))
})

const unitTotals = computed(() => {
  const seen = new Set<string>()
  const lines: QuantityCompletionQuantityLine[] = []
  for (const stage of workspace.value?.stages ?? []) {
    for (const line of stage.quantities) {
      const key = JSON.stringify([line.roomId, line.itemId])
      if (seen.has(key))
        continue
      seen.add(key)
      lines.push(line)
    }
  }
  return sumQuantityLines(lines)
})

const stageTotals = computed(() => new Map(
  (workspace.value?.stages ?? []).map(stage => [stage.id, sumQuantityLines(stage.quantities)]),
))

function statusChip(stage: QuantityCompletionStageView): { label: string, cls: string } {
  if (stage.completion?.status === 'completed')
    return { label: `已完成 ${stage.completion.completedAt?.slice(0, 10) ?? ''}`.trim(), cls: 'status-ok' }
  if (stage.completion?.status === 'draft')
    return { label: '草稿', cls: 'status-warn' }
  return { label: '未登记', cls: 'text-12px text-ink-faint' }
}

function openCompletion(stageId: string) {
  if (!store.completionCanWrite)
    return
  completionInitialStageId.value = stageId
  completionDialogOpen.value = true
}

async function load() {
  closePhoto()
  completionDialogOpen.value = false
  if (props.projectId && props.unitId && props.origin !== null)
    await store.loadCompletion(props.projectId, props.unitId, props.origin ?? 'real').catch(() => {})
}

watch(() => [props.projectId, props.unitId, props.origin], () => {
  if (active)
    void load()
}, { immediate: true })
onActivated(() => {
  active = true
  if (activated)
    void load()
  activated = true
})
onDeactivated(() => {
  active = false
  payrollFocusSequence += 1
  closePhoto()
  store.cancelCompletion()
})
onScopeDispose(closePhoto)
</script>

<template>
  <div ref="detailElement" class="quantity-unit-detail flex min-w-0 flex-col gap-4">
    <p v-if="origin === null" class="panel p-4 text-danger" role="alert">
      工程量来源无效，请从项目列表重新打开。
    </p>
    <p v-else-if="origin === 'demo'" class="panel p-4 text-ink-soft" role="status">
      演示工程量只读。
    </p>
    <section class="panel min-w-0 px-4 py-3">
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <NuxtLink :to="props.returnTo || '/subcontract/quantity'" class="btn-secondary  flex-none">
          <span class="i-lucide-arrow-left mr-1 text-13px" aria-hidden="true" />
          返回工程量矩阵
        </NuxtLink>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <h2 class="truncate text-15px font-800 text-ink">
              {{ workspace ? `${workspace.unit.buildingName} ${workspace.unit.floorName} ${workspace.unit.name}` : '户施工详情' }}
            </h2>
            <ContextHelp label="户施工详情" text="按工种、工序阶段和完成日期查看施工记录。合同量、暂估量和现场量随关联的户型模板更新。" />
          </div>
        </div>
        <span v-if="workspace?.matrixArchivedAt" class="status-warn ml-auto flex-none">
          已归档 · 修改需二次确认
        </span>
      </div>
    </section>

    <section
      v-if="store.completionLoading && !workspace"
      class="panel flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"
      role="status"
      aria-busy="true"
    >
      <span class="i-lucide-loader-circle animate-spin text-24px text-brand" aria-hidden="true" />
      <div class="text-13px font-700 text-ink">
        正在读取户施工详情…
      </div>
    </section>

    <section
      v-else-if="store.completionError && !workspace"
      class="panel flex min-h-64 flex-col items-center justify-center gap-3 border-danger/35 px-6 text-center"
      role="alert"
    >
      <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
      <p class="max-w-xl text-12px text-ink-soft">
        {{ store.completionError }}
      </p>
      <KitButton type="button" variant="primary" class="" @click="load">
        重新加载
      </KitButton>
    </section>

    <template v-else-if="workspace && origin !== null">
      <PayrollASourceReturn v-if="payrollQuery?.payrollReturnTo" kind="quantity-unit" :source-id="unitId" :project-id="projectId" :origin="origin || 'real'" />
      <NuxtLink v-if="payrollMatrix" :to="payrollMatrix" class="btn-secondary self-start">
        查看工程量管理
      </NuxtLink>
      <section
        v-for="group in tradeGroups"
        :key="group.trade"
        class="panel min-w-0 overflow-hidden"
        :aria-label="`${group.trade}施工记录`"
      >
        <div class="border-b border-line bg-surface-2 px-4 py-2.5">
          <h3 class="text-13px font-800 text-ink">
            {{ group.trade }}
          </h3>
        </div>

        <article
          v-for="stage in group.stages"
          :key="stage.id"
          :data-payroll-stage="stage.id"
          tabindex="-1"
          class="border-b border-line px-4 py-3 last:border-b-0"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span class="text-13px font-800 text-ink">{{ stage.name }}</span>
            <span :class="statusChip(stage).cls">{{ statusChip(stage).label }}</span>
            <span v-if="stage.photos.length" class="text-11px text-ink-faint">
              <span class="i-lucide-image mr-0.5 align-[-2px]" aria-hidden="true" />照片 {{ stage.photos.length }}
            </span>
            <KitButton
              v-if="store.completionCanWrite"
              type="button"
              variant="secondary" class=" ml-auto flex-none"
              @click="openCompletion(stage.id)"
            >
              登记
            </KitButton>
          </div>

          <dl class="mt-2 grid gap-x-6 gap-y-1 text-12px sm:grid-cols-2 xl:grid-cols-4">
            <div class="flex min-w-0 gap-2">
              <dt class="flex-none text-ink-faint">
                当前责任
              </dt>
              <dd class="truncate text-ink">
                {{ stage.currentAssignment?.assigneeName ?? '未指派' }}
              </dd>
            </div>
            <div class="flex min-w-0 gap-2">
              <dt class="flex-none text-ink-faint">
                完成时执行责任
              </dt>
              <dd class="truncate text-ink">
                {{ stage.completion?.executionAssigneeName ?? '—' }}
              </dd>
            </div>
            <div class="flex min-w-0 gap-2">
              <dt class="flex-none text-ink-faint">
                计划区间
              </dt>
              <dd class="truncate text-ink">
                {{ workspace.planWindow ? `${workspace.planWindow.plannedStartAt} ~ ${workspace.planWindow.plannedEndAt}` : '未排期' }}
              </dd>
            </div>
            <div v-if="stage.completion?.note" class="flex min-w-0 gap-2">
              <dt class="flex-none text-ink-faint">
                备注
              </dt>
              <dd class="truncate text-ink">
                {{ stage.completion.note }}
              </dd>
            </div>
          </dl>

          <div v-if="stage.quantities.length" class="mt-2.5 min-w-0 overflow-x-auto border border-line rounded-[var(--radius-btn)]">
            <table class="w-full min-w-130 border-collapse text-12px">
              <caption class="sr-only">
                {{ stage.name }}量明细
              </caption>
              <thead>
                <tr class="bg-surface-2 text-left text-11px text-ink-soft">
                  <th scope="col" class="px-3 py-1.5 font-700">
                    房间
                  </th>
                  <th scope="col" class="px-3 py-1.5 font-700">
                    分项
                  </th>
                  <th scope="col" class="px-3 py-1.5 font-700">
                    单位
                  </th>
                  <th scope="col" class="px-3 py-1.5 text-right font-700">
                    合同量
                  </th>
                  <th scope="col" class="px-3 py-1.5 text-right font-700">
                    暂估量
                  </th>
                  <th scope="col" class="px-3 py-1.5 text-right font-700">
                    现场量
                  </th>
                  <th scope="col" class="px-3 py-1.5 text-right font-700">
                    毛利参考
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in stage.quantities" :key="`${line.roomId}:${line.itemId}`" class="border-t border-line">
                  <td class="px-3 py-1.5 text-ink">
                    {{ line.roomName }}
                  </td>
                  <td class="px-3 py-1.5 text-ink">
                    {{ line.itemName }}
                  </td>
                  <td class="px-3 py-1.5 text-ink-soft">
                    {{ line.unit || '—' }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(line.contractQty) }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(line.provisionalQty) }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(line.fieldQty) }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink-faint">
                    待单价数据
                  </td>
                </tr>
                <tr v-for="total in stageTotals.get(stage.id)" :key="total.unit" class="border-t border-line bg-surface-2 font-700">
                  <td colspan="2" class="px-3 py-1.5 text-ink">
                    分项小计
                  </td>
                  <td class="px-3 py-1.5 text-ink-soft">
                    {{ total.unit || '—' }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    <QuantityTotalValue :total="total.contractQty" label="合同量合计" />
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    <QuantityTotalValue :total="total.provisionalQty" label="暂估量合计" />
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    <QuantityTotalValue :total="total.fieldQty" label="现场量合计" />
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink-faint">
                    —
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul v-if="stage.photos.length" class="mt-2 flex flex-wrap gap-1.5">
            <li v-for="photo in stage.photos" :key="photo.id">
              <KitButton
                type="button"
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-surface-2 px-2.5 py-1 text-11px text-ink-soft outline-none hover:bg-brand-soft/50 focus-visible:[box-shadow:0_0_0_2px_var(--brand-ring)]"
                :aria-label="`预览照片 ${photo.fileName}`"
                @click="openPhotoPreview(stage, photo)"
              >
                <span class="i-lucide-image flex-none" aria-hidden="true" />
                <span class="max-w-40 truncate">{{ photo.fileName }}</span>
              </KitButton>
            </li>
          </ul>
        </article>
      </section>

      <section class="panel min-w-0 px-4 py-3" aria-label="全户合计">
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-12px">
          <h3 class="text-13px font-800 text-ink">
            全户合计
          </h3>
          <span class="text-ink-faint">毛利参考暂不可用：缺少合同与班组单价</span>
        </div>
        <div
          v-for="total in unitTotals"
          :key="total.unit"
          role="group"
          :aria-label="`${total.unit || '未标明单位'}全户合计`"
          class="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-12px"
        >
          <span class="min-w-8 text-ink font-700">{{ total.unit || '未标明单位' }}</span>
          <span class="inline-flex items-center gap-1 text-ink-soft">合同量 <QuantityTotalValue :total="total.contractQty" label="全户合同量合计" /></span>
          <span class="inline-flex items-center gap-1 text-ink-soft">暂估量 <QuantityTotalValue :total="total.provisionalQty" label="全户暂估量合计" /></span>
          <span class="inline-flex items-center gap-1 text-ink-soft">现场量 <QuantityTotalValue :total="total.fieldQty" label="全户现场量合计" /></span>
        </div>
      </section>
    </template>

    <QuantityCompletionDialog
      v-if="projectId && unitId"
      v-model:open="completionDialogOpen"
      :project-id="projectId"
      :origin="origin ?? 'real'"
      :unit-id="unitId"
      :initial-stage-id="completionInitialStageId"
    />

    <Dialog :open="previewPhoto != null" @update:open="(value: boolean) => { if (!value) closePhoto() }">
      <DialogContent class="max-w-[min(880px,calc(100dvw-32px))] p-4">
        <DialogTitle class="truncate pr-8 text-13px">
          {{ previewPhoto?.fileName }}
        </DialogTitle>
        <p v-if="previewPhoto && !previewPhoto.dataUrl" class="p-4 text-ink-soft" role="status">
          正在读取验收照片…
        </p>
        <img
          v-if="previewPhoto?.dataUrl"
          :src="previewPhoto.dataUrl"
          :alt="`验收照片 ${previewPhoto.fileName}`"
          class="mt-2 max-h-[70dvh] max-w-full rounded-[var(--radius-btn)] object-contain"
        >
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.quantity-unit-detail {
  container-type: inline-size;
}
</style>
