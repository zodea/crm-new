<script setup lang="ts">
import type { QuotationRecord } from '~/lib/material-quotation/contract'
import QuotationOriginalFiles from '~/components/material/quotation/QuotationOriginalFiles.vue'
import { bindReadAuthority } from '~/lib/read-model/authority'

const route = useRoute()
const repository = useMaterialQuotationRepository()
const record = shallowRef<QuotationRecord | null>(null)
const error = ref('')
const loading = ref(false)
const version = ref('')
const canWrite = ref(false)
let generation = 0
let active = true
const id = computed(() => String(route.params.id ?? ''))
const selected = computed(() => record.value?.history.find(history => history.version === version.value) ?? null)
const relation = computed(() => record.value?.relations?.find(row => row.version === version.value) ?? null)
function invalidate() {
  generation++
  record.value = null
  version.value = ''
  canWrite.value = false
  loading.value = false
}
bindReadAuthority(invalidate)
async function load() {
  const current = ++generation
  record.value = null
  loading.value = true
  error.value = ''
  try {
    const result = await repository.list()
    if (!active || current !== generation)
      return
    const row = result.records.find(row => row.id === id.value)
    if (!row)
      throw new Error('报价不存在或没有关联来源的读取权限')
    record.value = row
    const requested = typeof route.query.version === 'string' ? route.query.version : row.version
    if (!row.history.some(history => history.version === requested))
      throw new Error('报价来源版本不存在')
    version.value = requested
    canWrite.value = result.capabilities.includes('material-quotation:write')
  }
  catch (cause) {
    if (active && current === generation) {
      record.value = null
      error.value = cause instanceof Error ? cause.message : '报价读取失败'
    }
  }
  finally {
    if (current === generation)
      loading.value = false
  }
}
watch(() => `${id.value}:${String(route.query.version ?? '')}`, () => void load(), { immediate: true })
onDeactivated(() => {
  active = false
  invalidate()
})
onBeforeUnmount(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
useTabTitle(computed(() => record.value ? `材料报价 · ${record.value.draft.partyName}` : '材料报价'))
</script>

<template>
  <div class="grid min-w-0 gap-4 p-4">
    <header class="panel flex flex-wrap justify-between gap-3 p-4">
      <h1 class="m-0 text-20px font-700">
        材料报价
      </h1><div class="flex gap-2">
        <NuxtLink to="/material/quotations" class="btn-secondary">
          返回清单
        </NuxtLink><NuxtLink v-if="record && canWrite" :to="`/material/quotations/form/${record.id}`" class="btn-primary">
          编辑报价
        </NuxtLink>
      </div>
    </header>
    <StatePanel v-if="loading" kind="loading" title="正在读取报价" /><StatePanel v-else-if="error" kind="error" title="报价读取失败" :description="error" action-label="重试" @action="load" />
    <template v-else-if="record && selected">
      <section class="panel grid min-w-0 gap-3 p-4">
        <label class="grid max-w-80 gap-1 text-13px">查看冻结版本<select v-model="version" class="field-input w-full" data-testid="quotation-history"><option v-for="history in record.history" :key="history.version" :value="history.version">版本 {{ history.version }} · {{ history.occurredAt }}</option></select></label><h2 class="m-0 break-words text-17px font-700">
          {{ selected.draft.partyName }}
        </h2><p class="m-0 text-13px text-ink-soft">
          原报价日期 {{ selected.draft.quotationDate ?? '未知' }} · {{ selected.draft.scope === 'general' ? '明确通用报价' : selected.draft.scope === 'project' ? `项目 ${selected.draft.projectId}` : '适用范围未知' }} · {{ selected.draft.supplierId ? `明确分供方 ${selected.draft.supplierId}` : '未关联分供方目录' }}
        </p><p v-if="relation" class="m-0 break-words text-13px text-ink-soft">
          已确认当前关联：{{ relation.projectId ? `项目 ${relation.projectId}` : '无项目' }} · {{ relation.supplierId ? `分供方 ${relation.supplierId}` : '未关联分供方' }} · 迁入批次 {{ relation.importBatchId }}。上方原始编号和冻结资料保持原文。
        </p><p class="m-0 break-all text-11px text-ink-faint">
          报价身份 {{ record.id }} · 原命令 {{ selected.commandId }}
        </p><div class="overflow-x-auto" tabindex="0" aria-label="报价原价横向滚动区域">
          <table class="w-full min-w-900px text-left text-13px">
            <thead>
              <tr class="border-b border-line">
                <th class="py-2">
                  名称 / 规格 / 等级 / 品牌
                </th><th>单位</th><th>原报价单价</th><th>数量</th><th>税口径</th><th>适用税率</th><th>运费 / 数量 / 付款 / 有效条件</th>
              </tr>
            </thead><tbody>
              <tr v-for="line in selected.draft.lines" :key="line.id" class="border-b border-line last:border-0">
                <td class="py-3">
                  {{ [line.name, line.spec, line.grade, line.brand].filter(Boolean).join(' / ') }}
                </td><td>{{ line.unit }}</td><td>{{ line.unitPrice === null ? '未知' : line.unitPrice.toLocaleString() }}</td><td>{{ line.quantity === null ? '未知' : line.quantity }}</td><td>{{ line.taxIncluded === null ? '未知' : line.taxIncluded ? '含税' : '不含税' }}</td><td>{{ line.taxRate === null ? '未知' : `${line.taxRate}%` }}</td><td>{{ [line.freight, line.quantityCondition, line.paymentCondition, line.validity].map(value => value ?? '未知').join(' / ') }}</td>
              </tr>
            </tbody>
          </table>
        </div><p class="m-0 whitespace-pre-wrap break-words text-13px">
          {{ selected.draft.note || '此版本无备注' }}
        </p>
      </section><section class="panel p-4">
        <SectionHeader title="此版本报价原件" /><QuotationOriginalFiles :id="record.id" :version="selected.version" :files="selected.files" :can-read="true" />
      </section>
    </template>
  </div>
</template>
