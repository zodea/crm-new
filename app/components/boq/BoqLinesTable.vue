<script setup lang="ts">
import type { BoqCatalogSection, BoqLineView } from '~/lib/boq/read-model'
import type { KitTableColumn } from '~/lib/kit/table'
import { boqCatalogScopeLineIds } from '~/lib/boq/catalog'

const props = withDefaults(defineProps<{
  lines: readonly BoqLineView[]
  catalog: readonly BoqCatalogSection[]
  scopeKey?: string
  search?: string
  loading?: boolean
}>(), {
  scopeKey: 'all',
  search: '',
  loading: false,
})

const emit = defineEmits<{
  edit: [line: BoqLineView]
  formula: [line: BoqLineView]
  plan: [line: BoqLineView]
  remove: [line: BoqLineView]
}>()

const columns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52, fixed: 'left' },
  { field: 'itemName', title: '分项名称', minWidth: 170, fixed: 'left' },
  { field: 'unitType', title: '户型', width: 78 },
  { field: 'room', title: '房间 / 部位', minWidth: 116 },
  { field: 'unit', title: '单位', width: 70, align: 'center' },
  { field: 'effectiveQty', title: '合同工程量', width: 116, align: 'right', slot: 'quantity' },
  { field: 'effectiveUnitPrice', title: '合同单价', width: 116, align: 'right', slot: 'unitPrice' },
  { field: 'effectiveAmount', title: '合价', type: 'money', width: 128 },
  { field: 'traceKey', title: '来源追溯', minWidth: 210, slot: 'source' },
  { type: 'action', title: '操作', width: 144, resizable: false },
]

const filteredLines = computed(() => {
  const keyword = props.search.trim().toLocaleLowerCase('zh-CN')
  const scopeLineIds = boqCatalogScopeLineIds(props.scopeKey, props.catalog)
  return props.lines.filter((line) => {
    if (scopeLineIds && !scopeLineIds.has(line.id))
      return false
    if (!keyword)
      return true
    return [
      line.section,
      line.trade,
      line.itemName,
      line.unitType,
      line.room,
      line.spec,
      line.traceKey,
    ].some(value => value.toLocaleLowerCase('zh-CN').includes(keyword))
  })
})

function decimal(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
}
</script>

<template>
  <div class="boq-lines-table min-w-0">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-11px text-ink-faint">
      <span>当前 {{ filteredLines.length }} 行 · 合同量与合同价已叠加已签证变更</span>
      <span v-if="filteredLines.some(line => line.manuallyCorrected)" class="chip-warn">
        {{ filteredLines.filter(line => line.manuallyCorrected).length }} 行人工修正
      </span>
    </div>
    <KitTable
      :columns="columns"
      :data="[...filteredLines]"
      :loading="loading"
      :min-rows="10"
      empty="当前目录没有清单行"
    >
      <template #quantity="{ row }">
        <div class="text-right font-mono tabular-nums">
          {{ decimal(row.effectiveQty) }}
          <span v-if="row.effectiveQty !== row.baseQty" class="ml-1 text-10px text-brand">
            (原 {{ decimal(row.baseQty) }})
          </span>
        </div>
      </template>
      <template #unitPrice="{ row }">
        <div class="text-right font-mono tabular-nums">
          ¥{{ decimal(row.effectiveUnitPrice) }}
          <span v-if="row.effectiveUnitPrice !== row.baseUnitPrice" class="ml-1 text-10px text-brand">
            (原 {{ decimal(row.baseUnitPrice) }})
          </span>
        </div>
      </template>
      <template #source="{ row }">
        <div class="min-w-0 py-1">
          <div class="truncate text-12px text-ink" :title="row.traceKey">
            {{ row.traceKey || `变更新增 · ${row.changeOrderId}` }}
          </div>
          <div class="mt-0.5 flex items-center gap-1">
            <span v-if="row.manuallyCorrected" class="chip-warn">已人工修正</span>
            <span v-if="row.changeOrderId" class="chip-brand">已签证新增</span>
            <span v-if="row.ownerSupplied" class="chip">甲供材</span>
          </div>
        </div>
      </template>
      <template #action="{ row }">
        <div class="flex items-center justify-start gap-1">
          <button
            type="button"
            class="btn-ghost grid h-7 w-7 place-items-center p-0"
            :disabled="Boolean(row.changeOrderId)"
            :title="row.changeOrderId ? '已签证变更新增行不可直接修改' : '编辑清单行'"
            :aria-label="`编辑清单行：${row.itemName}`"
            @click="emit('edit', row)"
          >
            <span aria-hidden="true" class="i-lucide-pencil h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="btn-ghost grid h-7 w-7 place-items-center p-0"
            :disabled="!row.itemId"
            :title="row.itemId ? '前往工程量域维护现场复核算式' : '该行尚未匹配标准分项'"
            :aria-label="`现场算式：${row.itemName} ${row.unitType} ${row.room}`"
            @click="emit('formula', row)"
          >
            <span aria-hidden="true" class="i-lucide-calculator h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="btn-ghost grid h-7 w-7 place-items-center p-0"
            title="前往排程域查看该分项的楼层计划"
            :aria-label="`楼层计划：${row.itemName} ${row.unitType} ${row.room}`"
            @click="emit('plan', row)"
          >
            <span aria-hidden="true" class="i-lucide-calendar-clock h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="btn-danger grid h-7 w-7 place-items-center p-0"
            :aria-label="`删除清单行：${row.itemName}`"
            title="删除清单行"
            @click="emit('remove', row)"
          >
            <span aria-hidden="true" class="i-lucide-trash-2 h-3.5 w-3.5" />
          </button>
        </div>
      </template>
    </KitTable>
  </div>
</template>
