<script setup lang="ts">
import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import type { QuotationRead } from '~/lib/material-quotation/contract'
import type { DeliveryPriceRecordInput, PricePartyInput } from '~/lib/material/price-analysis'
import type { MaterialSourcePriceFact } from '~/lib/material/price-source-facts'
import { computed, ref, shallowRef, watch } from 'vue'
import { comparablePriceDifference, convertOriginalPrice } from '~/lib/material/price-comparison'
import { buildMaterialSourcePriceFacts, filterMaterialSourcePrices } from '~/lib/material/price-source-facts'

const props = defineProps<{
  read?: QuotationRead | null
  contractRows?: readonly ContractPriceFact[] | null
  records?: readonly DeliveryPriceRecordInput[] | null
  suppliers?: readonly PricePartyInput[]
  projects?: readonly PricePartyInput[]
  native?: boolean
}>()
const allRows = computed(() => buildMaterialSourcePriceFacts({ quotations: props.read, contracts: props.contractRows, deliveries: props.records, suppliers: props.suppliers, nativeContracts: props.native }))
const search = ref('')
const projectId = ref('')
const supplierSelection = ref('')
const rows = computed(() => filterMaterialSourcePrices(allRows.value, { search: search.value, projectId: projectId.value, unlinkedOnly: supplierSelection.value === 'unlinked', supplierId: supplierSelection.value.startsWith('id:') ? supplierSelection.value.slice(3) : '' }))
const projects = computed(() => [...new Set(allRows.value.flatMap(row => row.projectId ? [row.projectId] : []))])
const suppliers = computed(() => [...new Set(allRows.value.flatMap(row => row.supplierId ? [row.supplierId] : []))])
const projectName = (id: string) => props.projects?.find(row => row.id === id)?.name ?? props.contractRows?.find(row => row.projectId === id)?.projectName ?? id
const supplierName = (id: string) => props.suppliers?.find(row => row.id === id)?.name ?? props.contractRows?.find(row => row.supplierId === id)?.supplierName ?? id
const candidateKey = ref('')
const baseKey = ref('')
const targetUnit = ref('')
const basis = ref('')
const materialBasis = ref('')
const factor = shallowRef<string | number>('')
const candidate = computed(() => rows.value.find(row => row.key === candidateKey.value))
const base = computed(() => rows.value.find(row => row.key === baseKey.value))
const kinds = { quotation: '未签约询价', contract: '合同约定价', delivery: '实际送货价' }
const result = computed(() => {
  if (!candidate.value)
    return null
  try {
    const conversion = { unit: targetUnit.value, factor: Number(factor.value), basis: basis.value }
    return { converted: convertOriginalPrice(candidate.value, conversion, '请明确比较单位、正换算系数和真实依据'), comparison: base.value ? comparablePriceDifference(base.value, candidate.value, { ...conversion, materialBasis: materialBasis.value }) : null, error: '' }
  }
  catch (cause) {
    return { converted: null, comparison: null, error: cause instanceof Error ? cause.message : '比较条件无效' }
  }
})
function resetConversion() {
  targetUnit.value = ''
  factor.value = ''
  basis.value = ''
  materialBasis.value = ''
}
function resetSelection() {
  candidateKey.value = ''
  baseKey.value = ''
  resetConversion()
}
watch(candidateKey, resetConversion)
watch([search, projectId, supplierSelection], resetSelection, { flush: 'sync' })
watch(() => [props.read?.meta.sourceVersion, props.read?.meta.authorizedScope.fingerprint, props.contractRows, props.records], resetSelection, { flush: 'sync' })
function chooseLabel(row: MaterialSourcePriceFact) {
  return row.kind === 'quotation' ? `比较 ${row.partyName} 版本 ${row.version} ${row.materialName}` : `比较 ${kinds[row.kind]} ${row.sourceLabel} ${row.lineId}`
}
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="三来源原价与比较">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <SectionHeader title="三来源原价与比较" /><NuxtLink to="/material/quotations" class="btn-secondary">
        报价清单
      </NuxtLink>
    </div>
    <p class="m-0 text-13px text-ink-soft">
      原价按真实报价、合同或送货原行展示。报价保留每次冻结版本，未关联报价方保留原文；名称相同不自动合并。来源中已关联 {{ suppliers.length }} 个目录身份，不作为当前材料签约采购家数。
    </p>
    <p v-if="read && read.meta.authorizedScope.coverage !== 'complete'" class="m-0 text-13px text-ink-soft">
      报价读取范围受权限限制，不能作为全部报价数量。
    </p>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="grid gap-1 text-13px">搜索原材料 / 规格 / 等级<input v-model="search" type="search" class="field-input w-full" aria-label="搜索三来源原材料"></label>
      <label class="grid gap-1 text-13px">实际项目范围<select v-model="projectId" class="field-input w-full" aria-label="原价项目范围"><option value="">全部范围（含未知）</option><option v-for="project in projects" :key="project" :value="project">{{ projectName(project) }}</option></select></label>
      <label class="grid gap-1 text-13px">真实分供方身份<select v-model="supplierSelection" class="field-input w-full" aria-label="原价分供方身份"><option value="">全部身份与未关联原文</option><option value="unlinked">仅未关联原文</option><option v-for="supplier in suppliers" :key="supplier" :value="`id:${supplier}`">{{ supplierName(supplier) }}</option></select></label>
    </div>
    <p v-if="projectId" class="m-0 text-12px text-ink-soft">
      本项目包含明确通用报价与真实关联项目原行；适用范围未知资料不冒充本项目报价。
    </p>
    <p v-if="!rows.length" class="m-0 text-13px text-ink-soft">
      当前可读取范围与筛选下暂无原价来源
    </p>
    <div v-else class="min-w-0 overflow-x-auto" role="region" tabindex="0" aria-label="报价原价横向滚动区域">
      <table class="w-full min-w-1150px text-left text-12px">
        <thead>
          <tr class="border-b border-line">
            <th class="py-2">
              真实来源
            </th><th>原文 / 目录身份</th><th>名称 / 规格 / 等级 / 品牌</th><th>原单位</th><th>原单价</th><th>税口径 / 本行税率</th><th>运费条件</th><th>数量 / 付款 / 有效条件</th><th>比较</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-b border-line last:border-0">
            <td class="py-3">
              <span>{{ kinds[row.kind] }}</span><NuxtLink :to="row.sourceLink" class="block text-brand">
                {{ row.sourceLabel }}
              </NuxtLink><p class="m-0">
                {{ row.date ?? '原日期未知' }}
              </p><p class="m-0 text-10px text-ink-faint">
                {{ row.lineId }}
              </p><p v-if="row.kind !== 'quotation'" class="m-0 text-10px text-ink-faint">
                {{ row.version ? `当前版本 ${row.version}` : '当前原行，版本未提供' }}
              </p><p v-if="row.fileIds.length" class="m-0 break-all text-10px text-ink-faint">
                原件 {{ row.fileIds.join(' / ') }}
              </p>
            </td>
            <td>
              {{ row.partyName }}<p class="m-0 text-11px text-ink-soft">
                {{ row.supplierId ?? '未关联目录身份' }}
              </p>
            </td>
            <td>{{ [row.materialName, row.spec, row.grade, row.brand].filter(Boolean).join(' / ') }}</td><td>{{ row.unit }}</td><td>{{ row.unitPrice === null ? '未知' : row.unitPrice.toLocaleString() }}</td>
            <td>{{ row.taxIncluded === null ? '未知' : row.taxIncluded ? '含税' : '不含税' }} / {{ row.taxRate === null ? '未知' : `${row.taxRate}%` }}</td><td>{{ row.freight ?? '未知' }}</td><td>{{ [row.quantityCondition, row.paymentCondition, row.validity].map(value => value ?? '未知').join(' / ') }}</td>
            <td>
              <button type="button" class="btn-secondary" :aria-label="chooseLabel(row)" @click="candidateKey = row.key">
                选择
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="candidate" class="grid gap-3 border-t border-line pt-3">
      <p class="m-0 break-words text-13px">
        当前比较来源：{{ kinds[candidate.kind] }} · {{ candidate.partyName }} · {{ candidate.sourceLabel }} · {{ candidate.materialName }}，原价 {{ candidate.unitPrice === null ? '未知' : candidate.unitPrice }} / {{ candidate.unit }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label class="grid gap-1 text-13px">比较单位<input v-model="targetUnit" class="field-input w-full" aria-label="报价比较单位"></label><label class="grid gap-1 text-13px">原单位数量转换系数<input v-model="factor" type="number" step="any" class="field-input w-full" aria-label="报价换算系数"></label><label class="grid gap-1 text-13px">真实换算依据<input v-model="basis" class="field-input w-full" aria-label="报价换算依据"></label>
        <label class="grid gap-1 text-13px">基准原价<select v-model="baseKey" class="field-input w-full" aria-label="基准原价"><option value="">只查看换算原价</option><option v-for="row in rows.filter(row => row.key !== candidateKey)" :key="row.key" :value="row.key">{{ kinds[row.kind] }} · {{ row.partyName }} · {{ row.sourceLabel }} · {{ row.materialName }} · {{ row.unit }}</option></select></label><label v-if="base" class="grid gap-1 text-13px sm:col-span-2">材料规格与等级核对依据<input v-model="materialBasis" class="field-input w-full" aria-label="材料核对依据"></label>
      </div>
      <p v-if="result?.error" role="status" class="m-0 text-13px text-danger">
        {{ result.error }}
      </p><p v-if="result?.converted" role="status" class="m-0 text-13px">
        本次换算原价：{{ result.converted.unitPrice === null ? '未知' : result.converted.unitPrice.toLocaleString() }} / {{ result.converted.unit }}；原资料保持不变。
      </p><p v-if="result?.comparison" role="status" class="m-0 text-13px">
        {{ result.comparison.difference === null ? '价差未计算' : `本次价差 ${result.comparison.difference.toLocaleString()}` }} · {{ result.comparison.reason }}
      </p>
    </div>
  </section>
</template>
