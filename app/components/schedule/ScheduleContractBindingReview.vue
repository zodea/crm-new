<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { ScheduleContractBindingPreview } from '~/lib/schedule/contract-binding'
import { computed } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'

const props = withDefaults(defineProps<{
  preview: ScheduleContractBindingPreview
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  bind: []
}>()

interface DifferenceRow {
  id: string
  name: string
  unit: string
  mapping: string
  provisionalQty: number
  contractQty: number
  differenceQty: number
}

const columns: KitTableColumn[] = [
  { field: 'name', title: '排程分项', minWidth: 180 },
  { field: 'unit', title: '单位', width: 72, align: 'center' },
  { field: 'mapping', title: '合同映射', width: 100, align: 'center', slot: 'mapping' },
  { field: 'provisionalQty', title: '暂估量', width: 112, align: 'right' },
  { field: 'contractQty', title: '合同量', width: 112, align: 'right' },
  { field: 'differenceQty', title: '量差', width: 112, align: 'right', slot: 'difference' },
]

const rows = computed<DifferenceRow[]>(() =>
  props.preview.items.map(item => ({
    id: item.id,
    name: item.name,
    unit: item.unit || '—',
    mapping: item.mapped ? '已映射' : '未映射',
    provisionalQty: item.provisionalQty,
    contractQty: item.contractQty,
    differenceQty: item.differenceQty,
  })),
)

function quantityLabel(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 4,
  }).format(value)
}
</script>

<template>
  <section class="binding-review flex min-w-0 flex-col gap-3" aria-labelledby="binding-review-title">
    <header class="panel flex flex-wrap items-start gap-3 p-4">
      <div class="min-w-0 flex-1">
        <div class="text-11px font-700 tracking-wide text-brand">
          合同绑定复核
        </div>
        <h2 id="binding-review-title" class="mt-0.5 text-18px font-850 text-ink">
          绑定差异复核
        </h2>
        <p class="mt-1 break-words text-12px text-ink-soft">
          {{ preview.contractName }} · {{ preview.contractNo }}
        </p>
      </div>
      <div class="min-w-48 rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2 text-11px">
        <span class="block text-ink-faint">目标楼栋分组</span>
        <strong class="mt-0.5 block break-words text-ink">{{ preview.groupName }}</strong>
      </div>
    </header>

    <section class="panel p-4" aria-labelledby="binding-building-title">
      <div class="flex flex-wrap items-center gap-2">
        <h3 id="binding-building-title" class="text-13px font-800 text-ink">
          楼栋覆盖
        </h3>
        <span class="text-11px text-ink-faint">
          {{ preview.buildings.filter(building => building.covered).length }}/{{ preview.buildings.length }} 栋已覆盖
        </span>
      </div>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
        <div
          v-for="building in preview.buildings"
          :key="building.id"
          class="flex min-w-0 items-center gap-2 rounded-[var(--radius-btn)] border px-3 py-2"
          :class="building.covered ? 'border-ok/30 bg-ok-soft' : 'border-danger/30 bg-danger-soft'"
        >
          <span
            class="h-2 w-2 flex-none rounded-full"
            :class="building.covered ? 'bg-ok' : 'bg-danger'"
          />
          <strong class="min-w-0 flex-1 truncate text-12px text-ink">{{ building.name }}</strong>
          <span class="text-10px" :class="building.covered ? 'text-ok-ink' : 'text-danger-ink'">
            {{ building.covered ? `${building.contractLineCount} 条清单` : '未覆盖' }}
          </span>
        </div>
      </div>
      <div v-if="preview.extraContractBuildings.length" class="mt-3 border-t border-line pt-3">
        <span class="text-11px font-700 text-warn-ink">合同额外楼栋（不会自动纳入）</span>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="building in preview.extraContractBuildings"
            :key="building.id"
            class="chip-warn"
          >
            {{ building.name }}
          </span>
        </div>
      </div>
    </section>

    <section v-if="preview.blockers.length || preview.warnings.length" class="grid gap-2">
      <div
        v-if="preview.blockers.length"
        class="panel border-danger/30 bg-danger-soft p-3 text-12px text-danger-ink"
        role="alert"
      >
        <strong class="block">必须先处理</strong>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          <li v-for="blocker in preview.blockers" :key="blocker">
            {{ blocker }}
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap gap-2 border-t border-danger/20 pt-3">
          <NuxtLink
            :to="{ path: '/contract/boq', query: { project: preview.projectId, contract: preview.contractId } }"
            class="btn-secondary"
          >
            补齐合同清单证据
          </NuxtLink>
          <NuxtLink
            :to="{ path: `/schedule/${preview.projectId}`, query: { group: preview.groupId } }"
            class="btn-secondary"
          >
            返回调整或拆分分组
          </NuxtLink>
        </div>
      </div>
      <div
        v-if="preview.warnings.length"
        class="panel border-warn/30 bg-warn-soft p-3 text-12px text-warn-ink"
        role="status"
      >
        <strong class="block">请核对</strong>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          <li v-for="warning in preview.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>
      </div>
    </section>

    <section class="min-w-0" aria-labelledby="binding-item-title">
      <div class="section-heading">
        <h3 id="binding-item-title" class="text-13px font-800 text-ink">
          分项与数量差异
        </h3>
        <span class="text-11px text-ink-faint">
          暂估量保留，仅把分组依据改为合同清单
        </span>
      </div>
      <KitTable
        :columns="columns"
        :data="rows"
        :min-rows="Math.max(3, Math.min(rows.length, 8))"
        row-key="id"
        empty="当前分组没有可复核的排程分项"
      >
        <template #mapping="{ row }">
          <span :class="row.mapping === '已映射' ? 'status-ok' : 'status-danger'">
            {{ row.mapping }}
          </span>
        </template>
        <template #difference="{ row }">
          <span
            class="font-mono tabular-nums"
            :class="row.differenceQty === 0 ? 'text-ink-soft' : 'text-warn-ink'"
          >
            {{ row.differenceQty > 0 ? '+' : '' }}{{ quantityLabel(row.differenceQty) }}
          </span>
        </template>
      </KitTable>
    </section>

    <footer class="panel flex flex-wrap items-center justify-between gap-3 p-3">
      <p class="min-w-0 flex-1 text-11px text-ink-soft">
        绑定后保留现有工序、基线、完成事实与暂估量，不自动扩充楼栋。
      </p>
      <KitButton
        type="button"
        variant="primary"
        :loading="busy"
        :disabled="busy || !preview.canBind"
        @click="emit('bind')"
      >
        确认绑定合同
      </KitButton>
    </footer>
  </section>
</template>

<style scoped>
.binding-review {
  container-type: inline-size;
}

@container (max-width: 30rem) {
  .binding-review > footer {
    align-items: stretch;
  }

  .binding-review > footer .btn-accent {
    width: 100%;
  }
}
</style>
