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

interface PriceCell {
  supplier: string
  entry: PriceEntry | undefined
  isLowest: boolean
}

// 预计算「材料 × 供应商」矩阵，避免模板逐格重复调用 getPrice/isLowest（O(行×列) 重算）
const rows = computed(() =>
  displayMaterials.value.map((m) => {
    const validPrices = m.prices.filter(p => !p.excluded).map(p => p.price)
    const lowest = validPrices.length > 1 ? Math.min(...validPrices) : null
    const cells: PriceCell[] = suppliers.value.map((supplier) => {
      const entry = m.prices.find(p => p.supplier === supplier && (!p.excluded || showExcluded.value))
      const isLowest = !!entry && !entry.excluded && lowest !== null && entry.price === lowest
      return { supplier, entry, isLowest }
    })
    return { material: m, cells, dimmed: m.prices.every(p => p.excluded) }
  }),
)

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
            v-for="row in rows"
            :key="row.material.id"
            class="border-t border-line hover:bg-surface-3"
            :class="row.dimmed ? 'opacity-50' : ''"
          >
            <td class="px-3 py-2 border-r border-line sticky left-0 bg-panel z-10 font-600">
              {{ row.material.name }}
            </td>
            <td class="px-2 py-2 border-r border-line text-ink-soft">{{ row.material.unit }}</td>
            <td
              v-for="c in row.cells"
              :key="c.supplier"
              class="px-3 py-2 border-r border-line text-right font-mono"
            >
              <template v-if="c.entry">
                <span
                  :class="c.isLowest ? 'text-ok font-700' : c.entry.excluded ? 'text-ink-faint line-through' : ''"
                >
                  {{ fmtMoney(c.entry.price) }}
                </span>
                <span v-if="c.isLowest" class="text-ok ml-1">✓</span>
                <span v-if="c.entry.excluded" class="text-10px text-ink-faint ml-1">[剔除]</span>
              </template>
              <span v-else class="text-ink-faint">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
