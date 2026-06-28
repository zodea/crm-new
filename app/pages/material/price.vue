<script setup lang="ts">
interface PriceEntry {
  supplier: string
  price: number
  date: string
  excluded: boolean
}

interface MaterialRow {
  id: string
  name: string
  unit: string
  prices: PriceEntry[]
}

const showExcluded = ref(false)

const MOCK_DATA: MaterialRow[] = [
  {
    id: 'm1', name: 'HRB400 螺纹钢 Φ12', unit: '吨',
    prices: [
      { supplier: '大板东建材', price: 3800, date: '2026-06', excluded: false },
      { supplier: '鸿运五金', price: 3950, date: '2026-06', excluded: false },
      { supplier: '顺利圆铝业', price: 4100, date: '2026-05', excluded: false },
    ],
  },
  {
    id: 'm2', name: 'C30 商品混凝土', unit: 'm³',
    prices: [
      { supplier: '大板东建材', price: 420, date: '2026-06', excluded: false },
      { supplier: '鸿运五金', price: 445, date: '2026-06', excluded: false },
    ],
  },
  {
    id: 'm3', name: '水泥 P.O 42.5', unit: '吨',
    prices: [
      { supplier: '大板东建材', price: 360, date: '2026-06', excluded: false },
      { supplier: '鸿运五金', price: 355, date: '2026-06', excluded: false },
      { supplier: '顺利圆铝业', price: 370, date: '2026-05', excluded: false },
    ],
  },
  {
    id: 'm4', name: '运费（大板东→合和新城）', unit: '车',
    prices: [
      { supplier: '大板东建材', price: 800, date: '2026-06', excluded: true },
    ],
  },
  {
    id: 'm5', name: '铝单板 3mm', unit: '㎡',
    prices: [
      { supplier: '顺利圆铝业', price: 280, date: '2026-06', excluded: false },
    ],
  },
]

const materials = ref(MOCK_DATA)

const suppliers = computed(() => {
  const set = new Set<string>()
  for (const m of materials.value) {
    for (const p of m.prices) {
      if (!p.excluded || showExcluded.value) set.add(p.supplier)
    }
  }
  return [...set]
})

const displayMaterials = computed(() => {
  return materials.value.filter(m =>
    showExcluded.value || m.prices.some(p => !p.excluded),
  )
})

function getPrice(m: MaterialRow, supplier: string): PriceEntry | undefined {
  return m.prices.find(p => p.supplier === supplier && (!p.excluded || showExcluded.value))
}

function isLowest(m: MaterialRow, supplier: string): boolean {
  const entry = getPrice(m, supplier)
  if (!entry || entry.excluded) return false
  const validPrices = m.prices.filter(p => !p.excluded).map(p => p.price)
  return entry.price === Math.min(...validPrices) && validPrices.length > 1
}

function fmtMoney(v: number): string {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-14px font-800 text-ink">
        单价对比 · {{ displayMaterials.length }} 种材料 · {{ suppliers.length }} 家供应商
      </h2>
      <label class="flex items-center gap-1.5 text-12px text-ink-soft cursor-pointer">
        <input v-model="showExcluded" type="checkbox" class="accent-brand">
        显示已剔除（运费等）
      </label>
    </div>

    <div class="border border-line overflow-x-auto">
      <table class="w-full text-12px">
        <thead>
          <tr class="bg-surface-2">
            <th class="text-left px-3 py-2 font-600 text-ink-soft border-r border-line sticky left-0 bg-surface-2 z-10 w-48">材料名称</th>
            <th class="text-left px-2 py-2 font-600 text-ink-soft border-r border-line w-14">单位</th>
            <th
              v-for="sup in suppliers"
              :key="sup"
              class="text-right px-3 py-2 font-600 text-ink-soft border-r border-line min-w-[120px]"
            >
              {{ sup }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in displayMaterials"
            :key="m.id"
            class="border-t border-line hover:bg-surface-3"
            :class="m.prices.every(p => p.excluded) ? 'opacity-50' : ''"
          >
            <td class="px-3 py-2 border-r border-line sticky left-0 bg-panel z-10 font-600">
              {{ m.name }}
            </td>
            <td class="px-2 py-2 border-r border-line text-ink-soft">{{ m.unit }}</td>
            <td
              v-for="sup in suppliers"
              :key="sup"
              class="px-3 py-2 border-r border-line text-right font-mono"
            >
              <template v-if="getPrice(m, sup)">
                <span
                  :class="isLowest(m, sup) ? 'text-ok font-700' : getPrice(m, sup)!.excluded ? 'text-ink-faint line-through' : ''"
                >
                  {{ fmtMoney(getPrice(m, sup)!.price) }}
                </span>
                <span v-if="isLowest(m, sup)" class="text-ok ml-1">✓</span>
                <span v-if="getPrice(m, sup)!.excluded" class="text-10px text-ink-faint ml-1">[剔除]</span>
              </template>
              <span v-else class="text-ink-faint">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
