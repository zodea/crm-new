<script setup lang="ts">
import type { QuantityMatrixCell, QuantityMatrixView } from '~/lib/quantity/matrix'

const props = defineProps<{
  matrix: QuantityMatrixView
}>()

const emit = defineEmits<{
  configure: [cell: QuantityMatrixCell]
}>()

const selectedCellId = shallowRef('')

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

function inspectDetail(cell: QuantityMatrixCell) {
  selectedCellId.value = cell.id
}

function completedLabel(completedAt: string | null): string {
  return completedAt ? completedAt.slice(0, 10) : '尚未完成'
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <QuantityMatrix
      :matrix="matrix"
      @configure="emit('configure', $event)"
      @detail="inspectDetail"
    />

    <section
      v-if="selectedCell"
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
