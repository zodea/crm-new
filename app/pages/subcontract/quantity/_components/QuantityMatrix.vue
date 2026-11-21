<script setup lang="ts">
import type {
  QuantityMatrixCell,
  QuantityMatrixView,
  QuantityNavigationKey,
} from '~/lib/quantity/matrix'
import { moveQuantityFocus } from '~/lib/quantity/matrix'

const props = defineProps<{
  matrix: QuantityMatrixView
  readonly?: boolean
}>()

const emit = defineEmits<{
  configure: [cell: QuantityMatrixCell]
  complete: [cell: QuantityMatrixCell]
  detail: [cell: QuantityMatrixCell]
}>()

const gridRef = useTemplateRef<HTMLTableElement>('grid')
const activeCellId = shallowRef('')
const openCellId = shallowRef('')

const positionSignature = computed(() => props.matrix.positions.map(position => position.id).join('|'))

watch(positionSignature, () => {
  if (!props.matrix.positions.some(position => position.id === activeCellId.value))
    activeCellId.value = props.matrix.positions[0]?.id ?? ''
  if (!props.matrix.positions.some(position => position.id === openCellId.value))
    openCellId.value = ''
}, { immediate: true })

function cellButton(cellId: string): HTMLButtonElement | null {
  const buttons = gridRef.value?.querySelectorAll<HTMLButtonElement>('[data-quantity-cell-id]') ?? []
  return [...buttons].find(button => button.dataset.quantityCellId === cellId) ?? null
}

function actionButton(cellId: string, action: 'configure' | 'complete' | 'detail'): HTMLButtonElement | null {
  const buttons = gridRef.value?.querySelectorAll<HTMLButtonElement>('[data-quantity-action]') ?? []
  return [...buttons].find(button => button.dataset.quantityCellId === cellId && button.dataset.quantityAction === action) ?? null
}

async function focusCell(cellId: string) {
  activeCellId.value = cellId
  await nextTick()
  cellButton(cellId)?.focus()
}

async function openActions(cellId: string, focusFirst = false) {
  activeCellId.value = cellId
  openCellId.value = cellId
  if (focusFirst) {
    await nextTick()
    ;(actionButton(cellId, 'configure') ?? actionButton(cellId, 'detail'))?.focus()
  }
}

async function closeActions(cellId: string, returnFocus = false) {
  if (openCellId.value === cellId)
    openCellId.value = ''
  if (returnFocus)
    await focusCell(cellId)
}

function handleCellKeydown(event: KeyboardEvent, cell: QuantityMatrixCell) {
  const key = event.key
  if (key === 'Enter' || key === ' ') {
    event.preventDefault()
    void openActions(cell.id, true)
    return
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key))
    return
  event.preventDefault()
  openCellId.value = ''
  const target = moveQuantityFocus(props.matrix.positions, cell.id, key as QuantityNavigationKey)
  void focusCell(target)
}

function handleFocusOut(event: FocusEvent, cellId: string) {
  const cell = event.currentTarget as HTMLElement
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && cell.contains(nextTarget))
    return
  void nextTick(() => {
    if (!cell.contains(document.activeElement))
      void closeActions(cellId)
  })
}

function handleMouseLeave(event: MouseEvent, cellId: string) {
  const cell = event.currentTarget as HTMLElement
  if (!cell.contains(document.activeElement))
    void closeActions(cellId)
}

function monthTone(month: string | null): number {
  if (!month)
    return 0
  return [...month].reduce((total, char) => total + char.charCodeAt(0), 0) % 4
}

function summaryLabel(cell: QuantityMatrixCell): string {
  if (cell.summary?.status === 'draft')
    return `${cell.summary.stageName} · 草稿`
  if (cell.summary)
    return cell.summary.stageName
  if (cell.assignments.length)
    return '已配置责任'
  return '尚未指派'
}

function assigneeLabel(cell: QuantityMatrixCell): string {
  if (cell.summary)
    return cell.summary.assigneeName
  if (cell.assignments.length)
    return [...new Set(cell.assignments.map(item => item.assigneeName))].join('、')
  return '—'
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="工程量矩阵">
    <div
      data-testid="quantity-matrix-scroll"
      class="quantity-matrix-scroll min-w-0 overflow-x-auto overscroll-contain"
    >
      <table
        ref="grid"
        role="grid"
        aria-label="工程量楼层房号矩阵"
        class="quantity-matrix w-full border-separate border-spacing-0"
        :style="{ minWidth: `${112 + matrix.columns.length * 174}px` }"
      >
        <thead>
          <tr role="row">
            <th
              role="columnheader"
              scope="col"
              class="quantity-matrix__corner sticky left-0 z-20 w-28 border-b border-r border-line bg-surface-2 px-3 py-2 text-left text-12px font-700 text-ink-soft"
            >
              楼层
            </th>
            <th
              v-for="column in matrix.columns"
              :key="column.key"
              role="columnheader"
              scope="col"
              class="min-w-43 border-b border-r border-line bg-surface-2 px-3 py-2 text-center text-13px font-700 text-ink"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrix.rows" :key="row.id" role="row">
            <th
              role="rowheader"
              scope="row"
              class="sticky left-0 z-10 border-b border-r border-line bg-panel px-3 py-3 text-left text-13px font-800 text-ink font-mono"
            >
              {{ row.label }}
            </th>
            <td
              v-for="(cell, columnIndex) in row.cells"
              :key="`${row.id}:${matrix.columns[columnIndex]?.key}`"
              role="gridcell"
              class="quantity-matrix__cell relative h-24 border-b border-r border-line bg-panel p-0"
              :data-state="cell?.state ?? 'missing'"
              :data-month-tone="monthTone(cell?.completionMonth ?? null)"
              @mouseenter="cell && openActions(cell.id)"
              @mouseleave="cell && handleMouseLeave($event, cell.id)"
              @focusout="cell && handleFocusOut($event, cell.id)"
            >
              <template v-if="cell">
                <button
                  type="button"
                  data-testid="quantity-matrix-cell"
                  :data-quantity-cell-id="cell.id"
                  :tabindex="activeCellId === cell.id ? 0 : -1"
                  :aria-label="cell.ariaLabel"
                  class="quantity-matrix__primary flex h-full w-full min-w-0 flex-col items-start justify-center gap-1 border-0 bg-transparent px-3 py-2 text-left outline-none focus-visible:[box-shadow:inset_0_0_0_3px_var(--brand)]"
                  @focus="openActions(cell.id)"
                  @click="openActions(cell.id, true)"
                  @keydown="handleCellKeydown($event, cell)"
                >
                  <span class="flex w-full min-w-0 items-center gap-2">
                    <span class="quantity-matrix__dot h-2.5 w-2.5 flex-none rounded-full" aria-hidden="true" />
                    <span class="truncate text-13px font-800 text-ink">{{ summaryLabel(cell) }}</span>
                  </span>
                  <span class="w-full truncate text-11px text-ink-soft">{{ assigneeLabel(cell) }}</span>
                  <span v-if="cell.summary?.completedAt" class="text-11px text-ink-faint font-mono">
                    {{ cell.summary.completedAt.slice(0, 10) }}
                  </span>
                  <span
                    v-if="cell.draftCount"
                    class="inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-10px font-700 text-warn-ink"
                  >
                    <i class="i-lucide-triangle-alert" aria-hidden="true" />
                    草稿异常 {{ cell.draftCount }}
                  </span>
                </button>

                <div
                  v-if="openCellId === cell.id"
                  class="quantity-matrix__actions absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[color-mix(in_srgb,var(--ink)_86%,transparent)] px-2"
                  :aria-label="`${cell.unitName}操作`"
                >
                  <button
                    v-if="!readonly"
                    type="button"
                    :aria-label="`配置 ${cell.unitName}`"
                    data-quantity-action="configure"
                    :data-quantity-cell-id="cell.id"
                    class="rounded-[var(--radius-btn)] border border-white/45 bg-white/12 px-3 py-1.5 text-12px font-700 text-white outline-none hover:bg-white/22 focus-visible:[box-shadow:0_0_0_3px_var(--brand-ring)]"
                    @click="emit('configure', cell)"
                    @keydown.esc.stop.prevent="closeActions(cell.id, true)"
                  >
                    配置
                  </button>
                  <button
                    v-if="!readonly"
                    type="button"
                    :aria-label="`登记 ${cell.unitName}`"
                    data-quantity-action="complete"
                    :data-quantity-cell-id="cell.id"
                    class="rounded-[var(--radius-btn)] border border-white bg-white px-3 py-1.5 text-12px font-700 text-ink outline-none hover:bg-brand-soft focus-visible:[box-shadow:0_0_0_3px_var(--brand-ring)]"
                    @click="emit('complete', cell)"
                    @keydown.esc.stop.prevent="closeActions(cell.id, true)"
                  >
                    登记
                  </button>
                  <button
                    type="button"
                    :aria-label="`详情 ${cell.unitName}`"
                    data-quantity-action="detail"
                    :data-quantity-cell-id="cell.id"
                    class="rounded-[var(--radius-btn)] border border-white/45 bg-white/12 px-3 py-1.5 text-12px font-700 text-white outline-none hover:bg-white/22 focus-visible:[box-shadow:0_0_0_3px_var(--brand-ring)]"
                    @click="emit('detail', cell)"
                    @keydown.esc.stop.prevent="closeActions(cell.id, true)"
                  >
                    详情
                  </button>
                </div>
              </template>
              <span v-else class="block h-full bg-surface-2" aria-label="本楼层无此房号" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-surface-2 px-4 py-2.5 text-11px text-ink-soft">
      <span class="font-700 text-ink">状态</span>
      <span class="inline-flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full bg-brand" />阶段完成</span>
      <span class="inline-flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full bg-warn" />草稿 / 异常</span>
      <span class="inline-flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full border border-brand bg-brand-soft" />已配置责任</span>
      <span class="inline-flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full border border-line bg-panel" />尚未指派</span>
      <span class="ml-auto">Tab 进入矩阵 · 方向键移动 · Enter 打开操作</span>
    </div>
  </section>
</template>

<style scoped>
.quantity-matrix__cell[data-state="completed"][data-month-tone="0"] {
  background: color-mix(in srgb, var(--brand-soft) 72%, var(--panel));
}

.quantity-matrix__cell[data-state="completed"][data-month-tone="1"] {
  background: color-mix(in srgb, var(--ok-soft) 72%, var(--panel));
}

.quantity-matrix__cell[data-state="completed"][data-month-tone="2"] {
  background: color-mix(in srgb, var(--warn-soft) 70%, var(--panel));
}

.quantity-matrix__cell[data-state="completed"][data-month-tone="3"] {
  background: color-mix(in srgb, var(--brand-soft) 48%, var(--surface-3));
}

.quantity-matrix__cell[data-state="completed"] .quantity-matrix__dot {
  background: var(--brand);
}

.quantity-matrix__cell[data-state="draft"] {
  background: var(--warn-soft);
}

.quantity-matrix__cell[data-state="draft"] .quantity-matrix__dot {
  background: var(--warn);
}

.quantity-matrix__cell[data-state="assigned"] {
  background: color-mix(in srgb, var(--brand-soft) 42%, var(--panel));
}

.quantity-matrix__cell[data-state="assigned"] .quantity-matrix__dot {
  border: 1px solid var(--brand);
  background: var(--brand-soft);
}

.quantity-matrix__cell[data-state="unassigned"] .quantity-matrix__dot {
  border: 1px solid var(--line-strong);
  background: var(--panel);
}

.quantity-matrix__primary:hover {
  background: color-mix(in srgb, var(--brand-soft) 28%, transparent);
}

@media (prefers-reduced-motion: no-preference) {
  .quantity-matrix__actions {
    animation: quantity-actions-in var(--dur-fast) var(--ease-snappy);
  }
}

@keyframes quantity-actions-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
