<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { QuantityMeasureTotal } from '~/lib/quantity/totals'
import type { ScheduleBindingPreview } from '~/lib/schedule/central-binding-contract'
import { computed } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { formatQuantityValue } from '~/lib/quantity/format'

const props = defineProps<{ preview: ScheduleBindingPreview, sourceVersion: string, readonly?: boolean, busy?: boolean, bound?: boolean }>()
const emit = defineEmits<{ bind: [trigger?: HTMLElement], repair: [lineId?: string] }>()
const coveredCount = computed(() => props.preview.buildings.filter(building => building.covered).length)
const rows = computed(() => props.preview.items.map(item => ({ ...item, key: JSON.stringify([item.id, item.unit]) })))
const columns: KitTableColumn[] = [
  { field: 'name', title: '排程分项', minWidth: 160 },
  { field: 'unit', title: '单位', width: 76, slot: 'unit' },
  { field: 'mapped', title: '合同映射', width: 90, slot: 'mapping' },
  { field: 'provisional', title: '冻结暂估量', minWidth: 168, slot: 'provisional' },
  { field: 'contract', title: '合同量', minWidth: 168, slot: 'contract' },
  { field: 'differenceQty', title: '合同量 − 暂估量', minWidth: 148, slot: 'difference' },
  { field: 'reasons', title: '来源与不可比说明', minWidth: 220, slot: 'reasons' },
  { field: 'contractLineIds', title: '合同清单来源', minWidth: 156, slot: 'sources' },
]
function measureLabel(value: QuantityMeasureTotal) {
  if (value.completeness === 'complete')
    return formatQuantityValue(value.value)
  const known = value.knownValue == null ? '未知' : `已知 ${formatQuantityValue(value.knownValue)}`
  return `${known}${value.missingCount ? ` · 缺 ${value.missingCount} 项` : ''}${value.unitMissing ? ' · 单位未提供' : ''}`
}
function requestBinding(event: MouseEvent) {
  emit('bind', event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined)
}
</script>

<template>
  <section class="grid min-w-0 gap-3" aria-label="绑定差异复核">
    <header class="panel min-w-0 p-4">
      <h2 class="text-16px font-800">
        {{ bound ? '绑定时保存的差异' : '绑定差异复核' }}
      </h2>
      <p class="mt-1 break-words text-12px text-ink-soft">
        {{ preview.contractName }} · {{ preview.contractNo }}
      </p>
      <details class="mt-2 min-w-0 text-11px text-ink-faint">
        <summary class="cursor-pointer">
          查看本次资料版本
        </summary><p class="mt-2 break-all">
          {{ sourceVersion }}
        </p>
      </details>
    </header>
    <section class="panel min-w-0 p-4" aria-label="楼栋覆盖">
      <div class="flex flex-wrap gap-2">
        <h3 class="text-13px font-800">
          楼栋覆盖
        </h3><span class="text-12px text-ink-faint">{{ coveredCount }}/{{ preview.buildings.length }} 栋已覆盖</span>
      </div>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
        <div v-for="building in preview.buildings" :key="building.id" class="flex min-w-0 items-center gap-2 rounded border p-3" :class="building.covered ? 'border-ok/30 bg-ok-soft' : 'border-danger/30 bg-danger-soft'">
          <strong class="min-w-0 flex-1 break-words text-12px">{{ building.name }}</strong>
          <span class="flex-none text-11px" :class="building.covered ? 'text-ok-ink' : 'text-danger-ink'">{{ building.covered ? `${building.contractLineCount} 条清单` : '未覆盖' }}</span>
        </div>
      </div>
      <p v-if="preview.extraContractBuildings.length" class="mt-3 break-words text-12px text-warn-ink">
        合同额外楼栋（不会自动纳入）：{{ preview.extraContractBuildings.map(building => building.name).join('、') }}
      </p>
    </section>
    <section v-if="preview.blockers.length" class="panel border-danger/30 bg-danger-soft p-4 text-12px text-danger-ink" role="alert">
      <h3 class="font-800">
        必须先处理
      </h3>
      <ul class="mt-2 list-disc space-y-1 pl-4">
        <li v-for="blocker in preview.blockers" :key="blocker">
          {{ blocker }}
        </li>
      </ul>
      <KitButton v-if="!bound" class="mt-3" :disabled="readonly || busy" @click="emit('repair')">
        补齐合同楼栋证据
      </KitButton>
      <p class="mt-2 leading-6">
        只可更正有来源依据的合同清单楼栋，不能通过自动移除楼栋或拆分分组绕过核对。
      </p>
    </section>
    <section v-if="preview.warnings.length" class="panel border-warn/30 bg-warn-soft p-3 text-12px text-warn-ink" role="status">
      <h3 class="font-800">
        请核对
      </h3><ul class="mt-1 list-disc space-y-1 pl-4">
        <li v-for="warning in preview.warnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
    </section>
    <section class="min-w-0" aria-label="分项与数量差异">
      <div class="section-heading">
        <h3 class="text-13px font-800">
          分项与数量差异
        </h3><p class="text-11px text-ink-faint">
          按分项及单位分别核对；缺量不当作零。
        </p>
      </div>
      <KitTable :columns="columns" :data="rows" row-key="key" :row-height="56" :min-rows="Math.max(3, Math.min(rows.length, 8))" empty="没有可复核的排程分项">
        <template #unit="{ row }">
          {{ row.unit || '未提供' }}
        </template>
        <template #mapping="{ row }">
          <span :class="row.mapped ? 'status-ok' : 'status-danger'">{{ row.mapped ? '已映射' : '未映射' }}</span>
        </template>
        <template #provisional="{ row }">
          <span class="whitespace-normal leading-5" :class="row.provisional.completeness === 'complete' ? 'text-ink' : 'text-warn-ink'">{{ measureLabel(row.provisional) }}</span>
        </template>
        <template #contract="{ row }">
          <span class="whitespace-normal leading-5" :class="row.contract.completeness === 'complete' ? 'text-ink' : 'text-warn-ink'">{{ measureLabel(row.contract) }}</span>
        </template>
        <template #difference="{ row }">
          <span class="font-mono" :class="row.differenceQty == null || row.differenceQty !== 0 ? 'text-warn-ink' : 'text-ink-soft'">{{ row.differenceQty == null ? '不可确定' : `${row.differenceQty > 0 ? '+' : ''}${formatQuantityValue(row.differenceQty)}` }}</span>
        </template>
        <template #reasons="{ row }">
          <div role="region" :aria-label="`${row.name} ${row.unit} 完整来源说明`" tabindex="0" class="max-h-11 overflow-y-auto whitespace-normal leading-4 text-11px focus-visible:outline focus-visible:outline-brand">
            {{ row.reasons.join('；') || '同分项、同单位，来源完整' }} · {{ row.floorPlanIds.length }} 份冻结楼层计划
          </div>
        </template>
        <template #sources="{ row }">
          <div v-if="row.contractLineIds.length" role="region" :aria-label="`${row.name} ${row.unit} 共${row.contractLineIds.length}条清单来源`" :tabindex="row.contractLineIds.length > 1 ? 0 : undefined" class="grid max-h-11 gap-1 overflow-y-auto focus-visible:outline focus-visible:outline-brand">
            <button v-for="(lineId, index) in row.contractLineIds" :key="lineId" type="button" class="block border-0 bg-transparent p-0 text-left text-12px leading-5 text-brand underline" :disabled="busy" @click="emit('repair', lineId)">
              查看清单来源 {{ index + 1 }}
            </button>
          </div>
          <span v-if="!row.contractLineIds?.length" class="text-11px text-ink-faint">没有可追溯的清单关系</span>
        </template>
      </KitTable>
    </section>
    <footer v-if="!bound" class="panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-3">
      <p class="min-w-0 flex-1 text-12px leading-6 text-ink-soft">
        数量差异供核对，暂估来源不会被改写。确认前会再次验证权限、楼栋关系和资料版本。
      </p>
      <KitButton variant="primary" :loading="busy" :disabled="readonly || busy || !preview.canBind" @click="requestBinding">
        确认绑定合同
      </KitButton>
    </footer>
  </section>
</template>
