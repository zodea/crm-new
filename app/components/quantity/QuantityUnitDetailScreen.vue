<script setup lang="ts">
import type { QuantityCompletionQuantityLine, QuantityCompletionStageView } from '~/lib/quantity/completion'

import { db } from '~/lib/db/client'
import { loadQuantityPhotoDataUrl } from '~/lib/quantity/completion'
import { formatQuantityValue } from '~/lib/quantity/format'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  unitId: string
}>()

const store = useQuantityStore()
const { error: toastError } = useKitUI()

const completionDialogOpen = shallowRef(false)
const completionInitialStageId = shallowRef('')
const previewPhoto = shallowRef<{ fileName: string, dataUrl: string } | null>(null)

// 验收照片正文惰性读取（蓝本§五「展示…验收照片」）：点击 chip 才拉 payload。
async function openPhotoPreview(photo: { id: string, fileName: string }) {
  try {
    previewPhoto.value = {
      fileName: photo.fileName,
      dataUrl: await loadQuantityPhotoDataUrl(db, photo.id),
    }
  }
  catch (cause) {
    toastError(`验收照片加载失败：${toErrorMessage(cause)}`)
  }
}

const workspace = computed(() => (
  store.completionWorkspace?.projectId === props.projectId
  && store.completionWorkspace.unit.id === props.unitId
    ? store.completionWorkspace
    : null
))

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

interface QuantityTotals {
  contractQty: number
  provisionalQty: number
  fieldQty: number
}

function sumLines(lines: readonly QuantityCompletionQuantityLine[]): QuantityTotals {
  return lines.reduce<QuantityTotals>((totals, line) => ({
    contractQty: totals.contractQty + (line.contractQty ?? 0),
    provisionalQty: totals.provisionalQty + (line.provisionalQty ?? 0),
    fieldQty: totals.fieldQty + (line.fieldQty ?? 0),
  }), { contractQty: 0, provisionalQty: 0, fieldQty: 0 })
}

const unitTotals = computed(() => {
  const seen = new Set<string>()
  const lines: QuantityCompletionQuantityLine[] = []
  for (const stage of workspace.value?.stages ?? []) {
    for (const line of stage.quantities) {
      const key = `${line.roomId} ${line.itemId}`
      if (seen.has(key))
        continue
      seen.add(key)
      lines.push(line)
    }
  }
  return sumLines(lines)
})

const stageTotals = computed(() => new Map(
  (workspace.value?.stages ?? []).map(stage => [stage.id, sumLines(stage.quantities)]),
))

function statusChip(stage: QuantityCompletionStageView): { label: string, cls: string } {
  if (stage.completion?.status === 'completed')
    return { label: `已完成 ${stage.completion.completedAt?.slice(0, 10) ?? ''}`.trim(), cls: 'status-ok' }
  if (stage.completion?.status === 'draft')
    return { label: '草稿', cls: 'status-warn' }
  return { label: '未登记', cls: 'text-12px text-ink-faint' }
}

function openCompletion(stageId: string) {
  completionInitialStageId.value = stageId
  completionDialogOpen.value = true
}

async function load() {
  if (props.projectId && props.unitId)
    await store.loadCompletion(props.projectId, props.unitId).catch(() => {})
}

watch(() => [props.projectId, props.unitId], load, { immediate: true })
</script>

<template>
  <div class="quantity-unit-detail flex min-w-0 flex-col gap-4">
    <section class="panel min-w-0 px-4 py-3">
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <NuxtLink to="/subcontract/quantity" class="btn-secondary flex-none">
          <span class="i-lucide-arrow-left mr-1 text-13px" aria-hidden="true" />
          返回矩阵
        </NuxtLink>
        <div class="min-w-0">
          <h2 class="truncate text-15px font-800 text-ink">
            {{ workspace ? `${workspace.unit.buildingName} ${workspace.unit.floorName} ${workspace.unit.name}` : '户施工详情' }}
          </h2>
          <p class="mt-0.5 text-12px text-ink-soft">
            工种 → 工序阶段 → 完成日期 · 三量走户型模板活链接
          </p>
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
      <button type="button" class="btn-primary" @click="load">
        重新加载
      </button>
    </section>

    <template v-else-if="workspace">
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
          class="border-b border-line px-4 py-3 last:border-b-0"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span class="text-13px font-800 text-ink">{{ stage.name }}</span>
            <span :class="statusChip(stage).cls">{{ statusChip(stage).label }}</span>
            <span v-if="stage.photos.length" class="text-11px text-ink-faint">
              <span class="i-lucide-image mr-0.5 align-[-2px]" aria-hidden="true" />照片 {{ stage.photos.length }}
            </span>
            <button
              type="button"
              class="btn-secondary ml-auto flex-none"
              @click="openCompletion(stage.id)"
            >
              登记
            </button>
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
                    暂定量
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
                <tr class="border-t border-line bg-surface-2 font-700">
                  <td colspan="3" class="px-3 py-1.5 text-ink">
                    分项小计
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(stageTotals.get(stage.id)!.contractQty) }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(stageTotals.get(stage.id)!.provisionalQty) }}
                  </td>
                  <td class="px-3 py-1.5 text-right text-ink font-mono">
                    {{ formatQuantityValue(stageTotals.get(stage.id)!.fieldQty) }}
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
              <button
                type="button"
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-surface-2 px-2.5 py-1 text-11px text-ink-soft outline-none hover:bg-brand-soft/50 focus-visible:[box-shadow:0_0_0_2px_var(--brand-ring)]"
                :aria-label="`预览照片 ${photo.fileName}`"
                @click="openPhotoPreview(photo)"
              >
                <span class="i-lucide-image flex-none" aria-hidden="true" />
                <span class="max-w-40 truncate">{{ photo.fileName }}</span>
              </button>
            </li>
          </ul>
        </article>
      </section>

      <section class="panel min-w-0 px-4 py-3" aria-label="全户合计">
        <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-12px">
          <span class="text-13px font-800 text-ink">全户合计</span>
          <span class="text-ink-soft">合同量 <b class="text-ink font-mono">{{ formatQuantityValue(unitTotals.contractQty) }}</b></span>
          <span class="text-ink-soft">暂定量 <b class="text-ink font-mono">{{ formatQuantityValue(unitTotals.provisionalQty) }}</b></span>
          <span class="text-ink-soft">现场量 <b class="text-ink font-mono">{{ formatQuantityValue(unitTotals.fieldQty) }}</b></span>
          <span class="text-ink-faint">毛利参考待 BOQ 合同单价与班组分项单价落地后接入</span>
        </div>
      </section>
    </template>

    <QuantityCompletionDialog
      v-if="projectId && unitId"
      v-model:open="completionDialogOpen"
      :project-id="projectId"
      :unit-id="unitId"
      :initial-stage-id="completionInitialStageId"
    />

    <Dialog :open="previewPhoto != null" @update:open="(value: boolean) => { if (!value) previewPhoto = null }">
      <DialogContent class="max-w-[min(880px,calc(100dvw-32px))] p-4">
        <DialogTitle class="truncate pr-8 text-13px">
          {{ previewPhoto?.fileName }}
        </DialogTitle>
        <img
          v-if="previewPhoto"
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
