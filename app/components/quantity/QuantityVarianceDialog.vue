<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  QuantityVarianceBasis,
  QuantityVarianceFact,
  QuantityVarianceRow,
} from '~/lib/quantity/variance'
import { computed, ref, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { db } from '~/lib/db/client'
import { formatQuantityValue } from '~/lib/quantity/format'
import {
  buildQuantityVarianceRows,
  filterQuantityVarianceRows,
  loadQuantityVarianceFacts,
} from '~/lib/quantity/variance'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  open: boolean
  projectId: string
  initialBuildingId?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const ALL = '__all__'
const basis = ref<QuantityVarianceBasis>('field')
const buildingId = ref(ALL)
const section = ref<string[]>([])
const trade = ref<string[]>([])
const itemKeyword = ref('')
const facts = ref<QuantityVarianceFact[]>([])
const loading = ref(false)
const error = ref('')
let loadSequence = 0

const basisOptions = [
  { key: 'contract', label: '合同量' },
  { key: 'provisional', label: '暂定量' },
  { key: 'field', label: '现场量' },
]

const basisLabel = computed(() =>
  basisOptions.find(option => option.key === basis.value)?.label ?? '所选量',
)
const allRows = computed(() => buildQuantityVarianceRows(facts.value, basis.value))

function uniqueOptions(
  rows: readonly QuantityVarianceRow[],
  key: 'buildingId' | 'section' | 'trade',
  labelKey: 'buildingName' | 'section' | 'trade',
) {
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const value = row[key]
    if (!value || seen.has(value))
      return []
    seen.add(value)
    return [{ key: value, label: row[labelKey] }]
  })
}

const buildingOptions = computed(() => [
  { key: ALL, label: '全部楼栋' },
  ...uniqueOptions(allRows.value, 'buildingId', 'buildingName'),
])
const sectionOptions = computed(() => uniqueOptions(allRows.value, 'section', 'section'))
const tradeOptions = computed(() => uniqueOptions(allRows.value, 'trade', 'trade'))
const visibleRows = computed(() => filterQuantityVarianceRows(allRows.value, {
  buildingId: buildingId.value === ALL ? undefined : buildingId.value,
  section: section.value,
  trade: trade.value,
  itemKeyword: itemKeyword.value,
}))
const columns = computed<KitTableColumn[]>(() => [
  { field: 'buildingName', title: '楼栋', width: 90, fixed: 'left' },
  { field: 'section', title: '分部', minWidth: 110 },
  { field: 'trade', title: '工种', minWidth: 100 },
  { field: 'itemName', title: '分项名称', minWidth: 150 },
  { field: 'unit', title: '单位', width: 64, align: 'center' },
  { field: 'contractQty', title: '合同量（含变更）', width: 132, align: 'right', slot: 'contractQty' },
  { field: 'basisQty', title: basisLabel.value, width: 116, align: 'right', slot: 'basisQty' },
  { field: 'differenceQty', title: '量差', width: 104, align: 'right', slot: 'differenceQty' },
  { field: 'contractUnitPrice', title: '合同单价', width: 120, align: 'right', slot: 'unitPrice' },
  { field: 'differenceAmount', title: '量差金额', width: 132, align: 'right', slot: 'differenceAmount' },
])
const computableAmountTotal = computed(() => visibleRows.value.reduce(
  (sum, row) => sum + (row.differenceAmount ?? 0),
  0,
))
const incompleteAmountRows = computed(() =>
  visibleRows.value.filter(row => row.differenceAmount == null).length,
)
const sourceUpdatedAt = computed(() => facts.value.reduce(
  (latest, fact) => fact.updatedAt > latest ? fact.updatedAt : latest,
  '',
))

function resetFilters() {
  basis.value = 'field'
  buildingId.value = props.initialBuildingId
    && allRows.value.some(row => row.buildingId === props.initialBuildingId)
    ? props.initialBuildingId
    : ALL
  section.value = []
  trade.value = []
  itemKeyword.value = ''
}

async function load() {
  const sequence = ++loadSequence
  facts.value = []
  error.value = ''
  if (!props.projectId) {
    loading.value = false
    resetFilters()
    return
  }
  loading.value = true
  try {
    const next = await loadQuantityVarianceFacts(db, props.projectId)
    if (sequence !== loadSequence)
      return
    facts.value = next
    resetFilters()
  }
  catch (cause) {
    if (sequence === loadSequence)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (sequence === loadSequence)
      loading.value = false
  }
}

watch(
  () => [props.open, props.projectId] as const,
  ([open]) => {
    if (open)
      void load()
  },
)

function quantityCell(value: number | null, missingCount: number): string {
  return value == null ? `缺 ${missingCount} 条` : formatQuantityValue(value)
}

function differenceClass(value: number | null): string {
  if (value == null || value === 0)
    return 'text-ink-soft'
  return value > 0 ? 'text-danger' : 'text-success'
}

function priceCell(row: QuantityVarianceRow): string {
  if (row.priceStatus === 'missing')
    return `缺 ${row.missingPriceCount} 条`
  if (row.priceStatus === 'mixed')
    return '多价格'
  return yuan(row.contractUnitPrice)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex h-[min(820px,calc(100dvh-24px))] w-[min(1380px,calc(100dvw-24px))] min-w-0 flex-col overflow-hidden p-0"
    >
      <header class="flex-none border-b border-line px-5 py-4 pr-12">
        <DialogTitle>量差总表</DialogTitle>
        <DialogDescription class="mt-1 text-12px leading-5">
          按楼栋 × 分项汇总实际户所挂户型模板；量差 = 所选量 − 合同量（含已审批变更），不产生独立台账。
        </DialogDescription>
      </header>

      <div
        data-ui="quantity-variance-scroll"
        class="quantity-variance__body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4"
      >
        <div class="flex flex-none flex-wrap items-end gap-3" aria-label="量差筛选">
          <SelectFilter v-model="basis" label="对比口径" :options="basisOptions" :min-width="112" />
          <SelectFilter v-model="buildingId" label="楼栋" :options="buildingOptions" :min-width="116" />
          <KitMultiSelectFilter v-model="section" label="分部" :options="sectionOptions" :min-width="128" />
          <KitMultiSelectFilter v-model="trade" label="工种" :options="tradeOptions" :min-width="116" />
          <label class="grid min-w-[180px] flex-1 gap-1 text-12px font-700 text-ink-soft">
            <span>分项</span>
            <input
              v-model.trim="itemKeyword"
              type="search"
              class="field-input h-8 min-w-0"
              placeholder="搜索分项名称"
            >
          </label>
          <button type="button" class="btn-secondary h-8" :disabled="loading" @click="load">
            <span class="i-lucide-refresh-cw mr-1" :class="{ 'animate-spin': loading }" aria-hidden="true" />
            刷新
          </button>
        </div>

        <div class="grid flex-none gap-2 sm:grid-cols-3">
          <div class="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <div class="text-10px font-700 text-ink-faint">
              当前范围
            </div>
            <div class="mt-0.5 text-14px font-800 text-ink">
              {{ visibleRows.length }} 个楼栋分项
            </div>
          </div>
          <div class="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <div class="text-10px font-700 text-ink-faint">
              可计算量差金额
            </div>
            <div class="mt-0.5 font-mono text-14px font-800" :class="differenceClass(computableAmountTotal)">
              {{ yuan(computableAmountTotal) }}
            </div>
          </div>
          <div class="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <div class="text-10px font-700 text-ink-faint">
              数据完整性
            </div>
            <div class="mt-0.5 text-12px font-700" :class="incompleteAmountRows ? 'text-warn' : 'text-success'">
              {{ incompleteAmountRows ? `${incompleteAmountRows} 行缺值未计` : '当前范围可完整计算' }}
            </div>
          </div>
        </div>

        <div
          v-if="error"
          role="alert"
          class="flex-none rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-12px text-danger"
        >
          量差数据读取失败：{{ error }}
        </div>

        <div
          data-ui="quantity-variance-table"
          class="quantity-variance__table h-80 min-w-0 flex-none overflow-hidden md:h-auto md:min-h-0 md:flex-1"
        >
          <KitTable
            :columns="columns"
            :data="visibleRows"
            :loading="loading"
            :min-rows="8"
            row-key="id"
            :empty="{
              title: '当前筛选下没有量差数据',
              description: '请调整楼栋、分部、工种或分项筛选。',
            }"
          >
            <template #contractQty="{ row }">
              <span
                class="font-mono"
                :class="row.contractQty == null ? 'text-warn' : 'text-ink'"
                :title="row.contractQty == null ? '合同量缺失，不参与量差计算' : ''"
              >
                {{ quantityCell(row.contractQty, row.missingContractCount) }}
              </span>
            </template>
            <template #basisQty="{ row }">
              <span
                class="font-mono"
                :class="row.basisQty == null ? 'text-warn' : 'text-ink'"
                :title="row.basisQty == null ? `${basisLabel}缺失，不会回退为其他口径` : ''"
              >
                {{ quantityCell(row.basisQty, row.missingBasisCount) }}
              </span>
            </template>
            <template #differenceQty="{ row }">
              <span class="font-mono font-700" :class="differenceClass(row.differenceQty)">
                {{ formatQuantityValue(row.differenceQty) }}
              </span>
            </template>
            <template #unitPrice="{ row }">
              <span
                class="font-mono"
                :class="row.priceStatus === 'missing' ? 'text-warn' : 'text-ink'"
                :title="row.priceStatus === 'mixed' ? '同一汇总行包含多个有效合同单价，金额按各明细单价分别计算后汇总' : ''"
              >
                {{ priceCell(row) }}
              </span>
            </template>
            <template #differenceAmount="{ row }">
              <span class="font-mono font-700" :class="differenceClass(row.differenceAmount)">
                {{ yuan(row.differenceAmount) }}
              </span>
            </template>
          </KitTable>
        </div>

        <p class="flex-none text-10px leading-4 text-ink-faint">
          <span v-if="sourceUpdatedAt">数据截至 {{ sourceUpdatedAt.replace('T', ' ').slice(0, 19) }}。</span>
          缺失合同量、{{ basisLabel }}或合同单价时保持“不可计算”，不会用 0 或其他量源替代。
        </p>
      </div>

      <DialogFooter class="flex-none border-t border-line px-5 py-3">
        <button type="button" class="btn-secondary" @click="emit('update:open', false)">
          关闭
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
