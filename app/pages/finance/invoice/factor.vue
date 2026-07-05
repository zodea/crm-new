<script setup lang="ts">
import { moneyToChinese } from '~/lib/util/chinese-amount'

const toast = useToast()

interface Factor {
  id: number
  name: string
  unit: string
  unitPrice: number
  upperLimit: number
}

let nextFactorId = 1
const targetAmount = ref(128640)
const taxRate = ref(13)
const decimalPlaces = ref(2)
const factors = ref<Factor[]>([
  { id: nextFactorId++, name: 'HRB400 螺纹钢 Φ12', unit: '吨', unitPrice: 3800, upperLimit: 50 },
  { id: nextFactorId++, name: 'C30 商品混凝土', unit: 'm³', unitPrice: 420, upperLimit: 100 },
])

const taxExcAmount = computed(() => {
  const rate = taxRate.value / 100
  return +(targetAmount.value / (1 + rate)).toFixed(decimalPlaces.value)
})
const taxAmount = computed(() => {
  return +(targetAmount.value - taxExcAmount.value).toFixed(decimalPlaces.value)
})

function addFactor() {
  factors.value.push({ id: nextFactorId++, name: '', unit: '', unitPrice: 0, upperLimit: 10 })
}

function removeFactor(id: number) {
  factors.value = factors.value.filter(f => f.id !== id)
}

interface Combination {
  items: { factor: Factor, qty: number, subtotal: number }[]
  total: number
  diff: number
}

const combinations = ref<Combination[]>([])
const calculating = ref(false)
const calcTime = ref(0)

function calculate() {
  calculating.value = true
  combinations.value = []
  const start = performance.now()
  const target = targetAmount.value
  const results: Combination[] = []
  const MAX_RESULTS = 200
  const TIME_LIMIT = 2000

  function dfs(idx: number, items: Combination['items'], currentTotal: number) {
    if (performance.now() - start > TIME_LIMIT) return
    if (results.length >= MAX_RESULTS) return

    if (idx === factors.value.length) {
      if (currentTotal > 0) {
        results.push({
          items: [...items],
          total: currentTotal,
          diff: Math.abs(currentTotal - target),
        })
      }
      return
    }

    const f = factors.value[idx]
    for (let qty = 0; qty <= f.upperLimit; qty++) {
      const subtotal = +(qty * f.unitPrice).toFixed(decimalPlaces.value)
      const newTotal = +(currentTotal + subtotal).toFixed(decimalPlaces.value)
      if (newTotal > target * 1.01) break

      if (qty > 0) {
        items.push({ factor: f, qty, subtotal })
      }
      dfs(idx + 1, items, newTotal)
      if (qty > 0) {
        items.pop()
      }
    }
  }

  dfs(0, [], 0)
  results.sort((a, b) => a.diff - b.diff)
  combinations.value = results.slice(0, 50)
  calcTime.value = Math.round(performance.now() - start)
  calculating.value = false

  if (results.length === 0) {
    toast.warning('未找到匹配方案，尝试调整因子或上限')
  }
}

function fmtMoney(v: number): string {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const { copy: copyToClipboard } = useClipboard({ legacy: true })

async function copyText(text: string) {
  try {
    await copyToClipboard(text)
    toast.success('已复制')
  }
  catch {
    toast.error('复制失败')
  }
}

const TAX_RATES = [13, 9, 6, 3, 1]

function handlePaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')
  if (!text || !text.includes('\t')) return
  e.preventDefault()
  const lines = text.trim().split('\n')
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length >= 3) {
      factors.value.push({
        id: nextFactorId++,
        name: parts[0].trim(),
        unit: parts[1].trim(),
        unitPrice: Number.parseFloat(parts[2]) || 0,
        upperLimit: parts[3] ? (Number.parseInt(parts[3]) || 10) : 10,
      })
    }
  }
  toast.success(`已导入 ${lines.length} 个因子`)
}
</script>

<template>
  <div @paste="handlePaste">
    <!-- Row 1: 输入面板 + 金额卡片 -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <!-- 输入面板 -->
      <div class="border border-line bg-panel p-4">
        <h4 class="text-13px font-700 text-ink mb-3">目标金额</h4>
        <div class="mb-3">
          <label class="field-label">目标含税金额 (元)</label>
          <input v-model.number="targetAmount" type="number" class="field-input w-full font-mono text-17px">
        </div>
        <div class="flex gap-3 mb-3">
          <div class="flex-1">
            <label class="field-label">税率</label>
            <div class="flex gap-1">
              <button
                v-for="r in TAX_RATES"
                :key="r"
                class="px-2.5 py-1 text-12px font-600 rounded-[3px] border cursor-pointer transition-colors"
                :class="taxRate === r ? 'bg-brand text-white border-brand' : 'border-line text-ink-soft hover:border-brand'"
                @click="taxRate = r"
              >
                {{ r }}%
              </button>
            </div>
          </div>
          <div>
            <label class="field-label">小数位</label>
            <input v-model.number="decimalPlaces" type="number" min="0" max="4" class="field-input w-16">
          </div>
        </div>
      </div>

      <!-- 金额卡片 -->
      <div class="border border-line bg-panel p-4">
        <h4 class="text-13px font-700 text-ink mb-3">计算结果</h4>
        <div class="grid grid-cols-3 gap-3">
          <div class="text-center">
            <div class="text-11px text-ink-faint mb-1">价税合计</div>
            <div class="font-mono text-17px font-700 text-ink tabular-nums mb-1">¥{{ fmtMoney(targetAmount) }}</div>
            <button class="text-10px text-brand cursor-pointer hover:underline" @click="copyText(moneyToChinese(targetAmount))">
              {{ moneyToChinese(targetAmount) }} · 复制
            </button>
          </div>
          <div class="text-center">
            <div class="text-11px text-ink-faint mb-1">不含税金额</div>
            <div class="font-mono text-17px font-700 text-ink tabular-nums mb-1">¥{{ fmtMoney(taxExcAmount) }}</div>
            <button class="text-10px text-brand cursor-pointer hover:underline" @click="copyText(moneyToChinese(taxExcAmount))">
              {{ moneyToChinese(taxExcAmount) }} · 复制
            </button>
          </div>
          <div class="text-center">
            <div class="text-11px text-ink-faint mb-1">税额</div>
            <div class="font-mono text-17px font-700 text-ink tabular-nums mb-1">¥{{ fmtMoney(taxAmount) }}</div>
            <button class="text-10px text-brand cursor-pointer hover:underline" @click="copyText(moneyToChinese(taxAmount))">
              {{ moneyToChinese(taxAmount) }} · 复制
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 2: 因子表 + 组合方案 -->
    <div class="grid grid-cols-2 gap-3">
      <!-- 因子表 -->
      <div class="border border-line bg-panel p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-13px font-700 text-ink">开票因子</h4>
          <div class="flex gap-1.5">
            <button class="btn-secondary text-12px" @click="addFactor">
              <span class="i-lucide-plus text-12px mr-0.5" /> 新增
            </button>
          </div>
        </div>
        <div class="border border-line">
          <table class="w-full text-12px">
            <thead>
              <tr class="bg-surface-2">
                <th class="text-left px-2 py-1.5 font-600 text-ink-soft border-r border-line">名称</th>
                <th class="text-left px-2 py-1.5 font-600 text-ink-soft border-r border-line w-16">单位</th>
                <th class="text-right px-2 py-1.5 font-600 text-ink-soft border-r border-line w-20">含税单价</th>
                <th class="text-right px-2 py-1.5 font-600 text-ink-soft border-r border-line w-14">上限</th>
                <th class="px-2 py-1.5 w-8" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in factors" :key="f.id" class="border-t border-line">
                <td class="px-1 py-1 border-r border-line">
                  <input v-model="f.name" class="field-input w-full !py-0.5 !px-1 text-12px">
                </td>
                <td class="px-1 py-1 border-r border-line">
                  <input v-model="f.unit" class="field-input w-full !py-0.5 !px-1 text-12px">
                </td>
                <td class="px-1 py-1 border-r border-line">
                  <input v-model.number="f.unitPrice" type="number" class="field-input w-full !py-0.5 !px-1 text-12px text-right font-mono">
                </td>
                <td class="px-1 py-1 border-r border-line">
                  <input v-model.number="f.upperLimit" type="number" class="field-input w-full !py-0.5 !px-1 text-12px text-right">
                </td>
                <td class="px-1 py-1 text-center">
                  <button class="text-ink-faint hover:text-danger cursor-pointer" @click="removeFactor(f.id)">
                    <span class="i-lucide-trash-2 text-13px" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-10px text-ink-faint mt-2">支持 Ctrl+V 粘贴 Tab 分隔数据（名称\t单位\t单价[\t上限]）</p>
      </div>

      <!-- 组合方案 -->
      <div class="border border-line bg-panel p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-13px font-700 text-ink">
            组合方案
            <span v-if="combinations.length" class="text-ink-faint font-400 ml-1">
              · {{ combinations.length }} 种 · {{ calcTime }}ms
            </span>
          </h4>
          <button
            class="btn-primary text-12px"
            :disabled="calculating || factors.length === 0"
            @click="calculate"
          >
            <span class="i-lucide-calculator text-12px mr-1" /> 计算组合
          </button>
        </div>

        <div v-if="combinations.length" class="space-y-2 max-h-[400px] overflow-y-auto">
          <div
            v-for="(combo, idx) in combinations"
            :key="idx"
            class="border border-line p-2.5"
            :class="combo.diff === 0 ? 'border-ok bg-ok-soft/20' : ''"
          >
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-11px font-600" :class="combo.diff === 0 ? 'text-ok' : 'text-ink-soft'">
                方案 {{ idx + 1 }}
              </span>
              <span class="font-mono text-12px">
                ¥{{ fmtMoney(combo.total) }}
                <span v-if="combo.diff > 0" class="text-warn ml-1">差 {{ fmtMoney(combo.diff) }}</span>
                <span v-else class="text-ok ml-1">精确匹配</span>
              </span>
            </div>
            <div class="text-11px space-y-0.5">
              <div v-for="item in combo.items" :key="item.factor.id" class="flex justify-between">
                <span>{{ item.factor.name }} × {{ item.qty }}{{ item.factor.unit }}</span>
                <span class="font-mono">¥{{ fmtMoney(item.subtotal) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="py-8 text-center text-ink-faint text-13px">
          添加因子后点击「计算组合」
        </div>
      </div>
    </div>
  </div>
</template>
