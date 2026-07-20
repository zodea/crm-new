<script setup lang="ts">
import type { QuantityMatrixCell, QuantityMatrixView } from '~/lib/quantity/matrix'

const props = defineProps<{
  matrix: QuantityMatrixView
}>()

type InspectorMode = 'configure' | 'detail'

const selectedCellId = shallowRef('')
const inspectorMode = shallowRef<InspectorMode>('detail')

const selectedCell = computed(() => {
  for (const row of props.matrix.rows) {
    const match = row.cells.find(cell => cell?.id === selectedCellId.value)
    if (match)
      return match
  }
  return null
})

watch(() => props.matrix.positions.map(position => position.id).join('|'), () => {
  if (selectedCellId.value && !props.matrix.positions.some(position => position.id === selectedCellId.value))
    selectedCellId.value = ''
})

function inspect(cell: QuantityMatrixCell, mode: InspectorMode) {
  selectedCellId.value = cell.id
  inspectorMode.value = mode
}

function completedLabel(completedAt: string | null): string {
  return completedAt ? completedAt.slice(0, 10) : '尚未完成'
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <QuantityMatrix
      :matrix="matrix"
      @configure="inspect($event, 'configure')"
      @detail="inspect($event, 'detail')"
    />

    <section
      v-if="selectedCell && inspectorMode === 'configure'"
      class="panel px-4 py-3"
      role="region"
      :aria-label="`${selectedCell.unitName}责任配置摘要`"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-14px font-800 text-ink">
          {{ selectedCell.floorName }} · {{ selectedCell.unitName }} · 当前责任
        </h3>
        <span class="text-11px text-ink-faint">只读摘要</span>
      </div>
      <div v-if="selectedCell.assignments.length" class="mt-2 flex flex-wrap gap-2">
        <span v-for="assignment in selectedCell.assignments" :key="assignment.id" class="chip-brand">
          {{ assignment.trade }} · {{ assignment.assigneeName }}
        </span>
      </div>
      <p v-else class="mt-2 text-12px text-ink-soft">
        当前筛选范围内尚未指派。
      </p>
    </section>

    <section
      v-else-if="selectedCell"
      class="panel px-4 py-3"
      role="region"
      :aria-label="`${selectedCell.unitName}阶段时间线`"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-14px font-800 text-ink">
          {{ selectedCell.floorName }} · {{ selectedCell.unitName }} · 阶段时间线
        </h3>
        <span class="text-11px text-ink-faint">总览按月份取最近阶段，此处保留完整记录</span>
      </div>
      <ol v-if="selectedCell.timeline.length" class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <li
          v-for="completion in selectedCell.timeline"
          :key="completion.id"
          class="min-w-0 border border-line rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span :class="completion.status === 'completed' ? 'status-ok' : 'status-warn'" class="truncate text-12px">
              {{ completion.stageName }}
            </span>
            <span class="ml-auto flex-none text-11px text-ink-faint font-mono">{{ completedLabel(completion.completedAt) }}</span>
          </div>
          <div class="mt-1 truncate text-11px text-ink-soft">
            {{ completion.stageTrade }} · {{ completion.assigneeName }}
          </div>
        </li>
      </ol>
      <p v-else class="mt-2 text-12px text-ink-soft">
        当前视角尚无阶段记录。
      </p>
    </section>
  </div>
</template>
