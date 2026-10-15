<script setup lang="ts">
import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import { computed, shallowRef, watch } from 'vue'
import { compareContractPrice, contractPriceSourceLink } from '~/lib/material-contract/price-facts'
import { normalizeMaterialIdentityText } from '~/lib/material/price-analysis'

const props = defineProps<{ rows: readonly ContractPriceFact[] }>()
const search = shallowRef('')
const selected = shallowRef('')
const targetUnit = shallowRef('')
const factor = shallowRef<string | number>('')
const basis = shallowRef('')
const key = (row: ContractPriceFact) => JSON.stringify([row.dataOrigin, row.contractId, row.lineId])
const rows = computed(() => props.rows.filter(row => normalizeMaterialIdentityText([row.materialName, row.spec, row.materialGrade].join(' ')).includes(normalizeMaterialIdentityText(search.value))))
const conversion = computed(() => {
  const row = rows.value.find(row => selected.value === key(row))
  if (!row || !targetUnit.value.trim() || !String(factor.value).trim() || !basis.value.trim())
    return null
  try {
    return compareContractPrice(row, { unit: targetUnit.value.trim(), factor: Number(factor.value), basis: basis.value.trim() })
  }
  catch {
    return null
  }
})
const validConversion = computed(() => conversion.value !== null)
const comparisons = computed(() => rows.value.map(row => conversion.value?.original === row ? conversion.value : compareContractPrice(row)))
watch(() => props.rows, () => {
  selected.value = ''
  targetUnit.value = ''
  factor.value = ''
  basis.value = ''
})
function money(value: number | null) {
  return value === null ? '—' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}
function link(row: ContractPriceFact) {
  return contractPriceSourceLink(row)
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="合同约定单价">
    <header class="section-heading flex-wrap justify-between gap-2">
      <h2 class="text-13px font-800 text-ink">
        合同约定单价
      </h2>
      <input v-model="search" type="search" class="form-input w-full sm:w-70" aria-label="搜索合同价格材料 / 规格 / 材质" placeholder="材料 / 规格 / 材质">
    </header>
    <p class="px-3 py-2 text-11px text-ink-soft">
      来源为有效合同或补充协议明细。— 表示未记录；税点只读取本行，不采用合同头默认值。材质缺失保持未记录。税费或运费条件未核实、单位不一致时仅展示原价，不评定同条件最低价或差价。
    </p>
    <p v-if="!rows.length" role="status" class="px-3 py-6 text-12px text-ink-soft">
      暂无符合条件的合同约定价
    </p>
    <div v-else class="overflow-x-auto" role="region" tabindex="0" aria-label="合同约定价格表">
      <table class="w-full min-w-[920px] border-collapse text-12px">
        <thead>
          <tr class="bg-surface-2 text-left text-ink-soft">
            <th class="px-3 py-2">
              材料 / 规格 / 材质
            </th><th class="px-3">
              签订日期
            </th><th class="px-3">
              分供方
            </th><th class="px-3">
              合同
            </th><th class="px-3">
              原单位 / 含税单价
            </th><th class="px-3">
              税点
            </th><th class="px-3">
              比较单位 / 单价
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in comparisons" :key="key(row.original)" class="border-t border-line" data-testid="contract-price-row">
            <td class="px-3 py-2">
              {{ row.original.materialName }} · {{ row.original.spec || '规格未记录' }} · {{ row.original.materialGrade || '材质未记录' }}
            </td>
            <td class="px-3">
              {{ row.original.date || '—' }}
            </td><td class="px-3">
              {{ row.original.supplierName || '—' }}
            </td>
            <td class="px-3">
              <NuxtLink :to="link(row.original)" class="text-brand hover:underline">
                {{ row.original.contractName || row.original.contractNo }}
              </NuxtLink>
            </td>
            <td class="px-3 font-mono">
              {{ row.original.unit || '—' }} / {{ money(row.original.taxInclusiveUnitPrice) }}
            </td>
            <td class="px-3" data-testid="contract-price-tax">
              {{ row.original.applicableTaxRate === null ? '—' : `${row.original.applicableTaxRate}%` }}
            </td>
            <td class="px-3 font-mono" data-testid="contract-price-comparison">
              {{ row.unit || '—' }} / {{ money(row.unitPrice) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <details v-if="rows.length" class="border-t border-line px-3 py-2 text-12px">
      <summary class="cursor-pointer font-700">
        按明确依据换算比较单位
      </summary>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>原明细<select v-model="selected" class="form-input mt-1 w-full" aria-label="选择换算合同明细"><option value="">选择一行</option><option v-for="row in rows" :key="key(row)" :value="key(row)">{{ row.contractName }} · {{ row.materialName }} · {{ row.unit }}</option></select></label>
        <label>比较单位<input v-model="targetUnit" class="form-input mt-1 w-full" aria-label="合同价格比较单位"></label>
        <label>1 原单位对应倍数<input v-model="factor" type="number" min="0" step="any" class="form-input mt-1 w-full" aria-label="合同价格换算倍数"></label>
        <label>核实依据<input v-model="basis" class="form-input mt-1 w-full" aria-label="合同价格换算依据"></label>
      </div>
      <p v-if="selected && !validConversion" role="status" class="mt-2 text-warn">
        缺少可靠比较单位、正倍数或依据，按原单位查看。
      </p>
      <p v-else-if="selected" role="status" class="mt-2 text-ink-soft">
        本次比较依据：{{ basis }}。仅派生比较值，原合同量、价、单位保持。
      </p>
    </details>
  </section>
</template>
