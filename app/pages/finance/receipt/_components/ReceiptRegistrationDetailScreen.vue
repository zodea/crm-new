<script setup lang="ts">
import type { ReceiptDetail } from '~/lib/receipt/contract'
import type { DataOriginDTO, ProblemDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, useTemplateRef, watch } from 'vue'
import EntityDetailShell from '~/components/ui/EntityDetailShell.vue'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'
import { ownerFinalSettlementReceiptIsActive } from '~/lib/owner-document/central-repository'
import { receiptProblemFromUnknown } from '~/lib/receipt/repository'
import { receiptFormPath, validateReceiptReturnTo } from '~/lib/receipt/return-context'
import { yuan } from '~/lib/util/money'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import ReceiptReferenceLink from '../../../../components/receipt/ReceiptReferenceLink.vue'
import ReceiptFilesPanel from './ReceiptFilesPanel.vue'

const route = useRoute()
const id = String(route.params.id ?? '')
const origin = shallowRef<DataOriginDTO>('real')
const pagePath = route.path
const visibility = useDataVisibilityStore()
const repository = useNuxtApp().$repositories.receipts
const detail = shallowRef<ReceiptDetail | null>(null)
const problem = shallowRef<ProblemDTO | null>(null)
const loading = shallowRef(true)
const region = useTemplateRef<HTMLElement>('region')
let generation = 0
let active = true
let activated = false
const returnTo = computed(() => validateReceiptReturnTo(route.path === pagePath ? route.query.returnTo : undefined, origin.value) ?? '/finance/receipt')
const currentPath = computed(() => `${pagePath}?${new URLSearchParams({ origin: origin.value, returnTo: returnTo.value })}`)
const title = computed(() => detail.value?.record.draft.no || '收款详情')
const shellState = computed(() => loading.value ? 'loading' : problem.value?.code === 'forbidden' ? 'forbidden' : problem.value?.code === 'not-found' ? 'not-found' : problem.value ? 'error' : 'ready')
const canEdit = computed(() => !loading.value && !problem.value && detail.value?.record.dataOrigin === 'real' && detail.value.capabilities.includes('receipt:write'))
useTabTitle(() => detail.value?.record.draft.no)

async function load() {
  if (!active || route.path !== pagePath)
    return
  const current = ++generation
  loading.value = true
  detail.value = null
  problem.value = null
  const requestedOrigin = route.query.origin
  if ((requestedOrigin !== 'real' && requestedOrigin !== 'demo') || !isStableRouteIdentity(id)) {
    problem.value = { code: 'invalid-query', message: '收款身份或来源无效，请从列表重新打开', retryable: false, fieldErrors: {}, traceId: null }
    loading.value = false
    return
  }
  origin.value = requestedOrigin
  try {
    const value = await repository.detail(id, { origin: requestedOrigin, includeDemo: visibility.includeDemo })
    if (current !== generation)
      return
    detail.value = value
  }
  catch (cause) {
    if (current === generation)
      problem.value = receiptProblemFromUnknown(cause).problem
  }
  finally {
    if (current === generation)
      loading.value = false
  }
  if (current === generation && detail.value) {
    await nextTick()
    region.value?.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
  }
}
watch([() => route.query.origin, () => visibility.includeDemo], () => void load(), { immediate: true })
onActivated(() => {
  active = true
  if (activated)
    void load()
  activated = true
})
onDeactivated(() => {
  active = false
  generation++
  detail.value = null
})
onScopeDispose(() => {
  active = false
  generation++
})
</script>

<template>
  <div ref="region" class="min-w-0">
    <EntityDetailShell :title="title" subtitle="甲方客户向我方支付的收款登记" :back-to="returnTo" back-label="返回来源页面" :state="shellState" :state-description="problem?.message" state-action-label="重新读取" @state-action="load">
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="origin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ origin === 'demo' ? '演示' : '正式' }}</span><KitStatusTag :tone="financeStatusTone(detail.record.draft.status)">
            {{ financeStatusLabel(detail.record.draft.status) }}
          </KitStatusTag>
        </template>
      </template>
      <template #actions>
        <KitButton @click="load">
          重新读取
        </KitButton><NuxtLink v-if="canEdit" :to="receiptFormPath(id, currentPath)" class="btn-primary h-8 px-4 text-12px">
          编辑收款
        </NuxtLink>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="3">
          <Metric label="登记金额" :value="detail.record.draft.amount === null ? '未填写' : yuan(detail.record.draft.amount)" /><Metric label="有效收款" :value="yuan(ownerFinalSettlementReceiptIsActive(detail.record.draft.status) ? detail.record.draft.amount : '0.00')" /><Metric label="收款日期" :value="detail.record.draft.receiptDate || '未填写'" />
        </MetricGrid>
      </template>
      <div v-if="detail" class="grid min-w-0 gap-4">
        <section class="panel grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="收款详情字段">
          <div v-for="[key, label] in [['project', '项目'], ['customer', '付款方客户'], ['contract', '施工合同']] as const" :key="key" class="grid min-w-0 gap-1">
            <span class="text-11px text-ink-faint">{{ label }}</span><ReceiptReferenceLink :reference="detail[key]" :origin="origin" />
          </div>
          <div v-for="[key, label] in [['payerAccount', '付款方账号'], ['paymentMethod', '收款方式'], ['acceptanceBillNo', '承兑汇票号'], ['billDueDate', '汇票到期日'], ['periodNo', '收款期次'], ['bankSerialNo', '银行流水号'], ['handler', '经办人'], ['reviewStatus', '审核状态']] as const" :key="key" class="grid min-w-0 gap-1">
            <span class="text-11px text-ink-faint">{{ label }}</span><span class="break-words text-13px">{{ detail.record.draft[key] || '未记录' }}</span>
          </div>
        </section>
        <section class="panel min-w-0 p-4" aria-label="合同情况">
          <SectionHeader title="合同情况" /><p v-if="detail.contract.state !== 'resolved'" class="mb-0 text-12px text-ink-faint">
            {{ detail.contract.state === 'forbidden' ? '施工合同无读权，合同指标不可用。' : '未关联可读施工合同，合同指标不适用。' }}
          </p><template v-else>
            <StatePanel v-if="detail.contractProblem" kind="error" title="合同指标暂不可完整读取" :description="detail.contractProblem.message" compact /><MetricGrid :cols="4" class="mt-3">
              <Metric label="合同原额" :value="yuan(detail.amounts.contractOriginal)" /><Metric label="合同变更额" :value="yuan(detail.amounts.contractChange)" /><Metric label="变更后合同金额" :value="yuan(detail.amounts.contract)" /><Metric label="合同累计收款" :value="yuan(detail.amounts.cumulativeReceipt)" /><Metric label="累计收款（不含本次）" :value="yuan(detail.amounts.cumulativeReceiptExcludingCurrent)" /><Metric label="收款 / 合同占比" :value="detail.amounts.receiptRatio === null ? '—' : `${(Number(detail.amounts.receiptRatio) * 100).toFixed(2)}%`" /><Metric label="开票未收款" :value="yuan(detail.amounts.invoicedUnreceived)" />
            </MetricGrid><p class="mb-0 text-12px text-ink-faint">
              质保及变现口径尚无已记录来源，当前不可确定。
            </p>
          </template>
        </section>
        <section class="panel grid gap-4 p-4 sm:grid-cols-2" aria-label="收款分类与类型">
          <div v-for="label in ['收款分类', '收款类型']" :key="label" class="grid gap-1">
            <span class="text-11px text-ink-faint">{{ label }}</span><span class="text-13px text-ink-faint">未记录</span>
          </div>
        </section>
        <ReceiptFilesPanel :record="detail.record" />
        <section class="panel p-4" aria-label="备注">
          <SectionHeader title="备注" /><p class="mb-0 whitespace-pre-wrap break-words text-12px">
            {{ detail.record.draft.note || '未填写备注。' }}
          </p>
        </section>
        <section class="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="系统信息">
          <div v-for="[key, label] in [['createdAt', '创建时间'], ['createdBy', '创建人'], ['updatedAt', '更新时间'], ['updatedBy', '更新人']] as const" :key="key" class="grid min-w-0 gap-1">
            <span class="text-11px text-ink-faint">{{ label }}</span><span class="break-words text-12px">{{ detail.record[key] || '未记录' }}</span>
          </div>
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>
