<script setup lang="ts">
import type {
  PaymentApplicationDetail,
} from '~/lib/finance/payment-detail'
import { onBeforeUnmount } from 'vue'
import { useProjectSupplierReturnContext } from '~/composables/useProjectSupplierReturnContext'
import { approvalAmountLabel } from '~/lib/finance/approval-amount'
import { financeStatusLabel } from '~/lib/finance/status'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'
import { useFinanceStore } from '~/stores/finance'

const route = useRoute()
const finance = useFinanceStore()
const detail = shallowRef<PaymentApplicationDetail | null>(null)
const errorMessage = shallowRef('')
const settledId = shallowRef('')
let requestVersion = 0
let active = true
const applicationId = computed(() => String(route.params.id ?? ''))
bindReadAuthority((problem) => {
  ++requestVersion
  detail.value = null
  errorMessage.value = problem.message
  settledId.value = applicationId.value
})

const projectSupplierReturn = useProjectSupplierReturnContext(
  () => detail.value?.projectId,
  () => detail.value?.supplierId,
)
const shellState = computed<'ready' | 'loading' | 'error' | 'not-found'>(() => {
  if (detail.value?.id === applicationId.value)
    return 'ready'
  if (settledId.value !== applicationId.value)
    return 'loading'
  if (errorMessage.value)
    return 'error'
  return 'not-found'
})
const statusText = computed(() => detail.value ? financeStatusLabel(detail.value.status) : '')
const statusClass = computed(() => {
  if (detail.value?.status === 'approved' || ['已审批', '已批复'].includes(detail.value?.status ?? ''))
    return 'chip-ok'
  if (detail.value?.status === 'submitted' || detail.value?.status === '已提交')
    return 'chip-warn'
  return 'chip-brand'
})
const insightStatusText = computed(() => {
  const count = detail.value?.insight.attentionCount ?? 0
  return count ? `有 ${count} 项检查待处理` : '检查项均已通过'
})
const insightStatusClass = computed(() => detail.value?.insight.attentionCount ? 'text-warn-ink' : 'text-ok-ink')

useTabTitle(() => detail.value?.name ? `${detail.value.name} · 付款申请` : '付款申请详情')

function date(value: string): string {
  return value ? value.slice(0, 10) : '—'
}

async function load() {
  const id = applicationId.value
  if (!id)
    return
  const currentRequest = ++requestVersion
  detail.value = null
  errorMessage.value = ''
  settledId.value = ''
  try {
    const next = await finance.paymentApplicationDetail(id)
    if (currentRequest !== requestVersion)
      return
    detail.value = next
  }
  catch (cause) {
    if (currentRequest === requestVersion)
      errorMessage.value = `付款申请详情加载失败：${toErrorMessage(cause)}`
  }
  finally {
    if (currentRequest === requestVersion)
      settledId.value = id
  }
}

function openEdit() {
  if (applicationId.value)
    void navigateTo(`/finance/payment/${applicationId.value}`)
}

function createPayment() {
  const current = detail.value
  if (!current)
    return
  const query: Record<string, string> = {
    paymentApplicationId: current.id,
    amount: String(current.registrationAmount),
  }
  if (current.projectId)
    query.projectId = current.projectId
  if (current.supplierId)
    query.supplierId = current.supplierId
  void navigateTo({ path: '/finance/records/new', query })
}
function sourceLabel(value?: string): string {
  return value === 'frozen' ? '历史冻结依据；当前来源尚未核实' : value === 'forbidden' ? '当前身份无来源读取权限' : value === 'unavailable' ? '当前真实来源待核验' : ''
}

watch(applicationId, () => {
  if (active)
    void load()
}, { immediate: true })
onDeactivated(() => {
  active = false
  requestVersion += 1
})
onBeforeUnmount(() => {
  active = false
  ++requestVersion
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
</script>

<template>
  <EntityDetailShell
    :title="detail?.name || '付款申请详情'"
    :subtitle="detail ? `${detail.no || '未编号'} · ${detail.projectName || '公司付款'} · ${detail.supplierName || detail.bizType}` : ''"
    :back-to="projectSupplierReturn?.to || '/finance/payment'"
    :back-label="projectSupplierReturn ? '返回项目分供方工作台' : '返回付款申请'"
    aside-label="智能业务洞察"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '付款申请不存在或已删除' : '付款申请详情加载失败'"
    :state-description="shellState === 'error' ? errorMessage : ''"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        付
      </div>
    </template>

    <template #status>
      <span v-if="detail" class="chip" :class="statusClass">{{ statusText }}</span>
    </template>

    <template #metadata>
      <p v-if="detail" class="mt-1 text-11px text-ink-faint">
        申请人 {{ detail.applicant || '—' }} · 申请日期 {{ date(detail.applyDate) }} · 业务类型 {{ detail.bizType || '—' }}
      </p>
    </template>

    <template #actions>
      <KitButton v-if="detail?.projectId" variant="secondary" @click="navigateTo(`/project/${detail.projectId}`)">
        <span class="i-lucide-building-2 mr-1" aria-hidden="true" />查看项目
      </KitButton>
      <KitButton v-if="detail && detail.registrationAmount > 0 && detail.canRegisterPayment !== false" variant="secondary" data-testid="payment-application-create-payment" @click="createPayment">
        <span class="i-lucide-banknote-arrow-up mr-1" aria-hidden="true" />登记支付
      </KitButton>
      <KitButton v-if="detail?.canEdit !== false" variant="primary" data-testid="payment-application-edit" @click="openEdit">
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑申请
      </KitButton>
    </template>

    <template #summary>
      <MetricGrid v-if="detail" :cols="6">
        <Metric label="申请金额" :value="detail.applyAmount" :money="true" />
        <Metric label="本期批复金额" :value="detail.approvedAmount ?? '—'" :money="true" :status="approvalAmountLabel(detail.approvedAmountState)" />
        <Metric label="已确认支付" :value="detail.paidAmount" :money="true" tone="ok" />
        <Metric label="待支付" :value="detail.unpaidAmount ?? '—'" :money="true" :status="detail.unpaidAmount === null ? '历史批复待核验' : ''" :tone="detail.unpaidAmount === null ? undefined : detail.unpaidAmount ? 'danger' : 'ok'" />
        <Metric label="已关联发票" :value="detail.invoiceAllocated" :money="true" />
        <Metric v-if="detail.invoiceState === '先款后票'" label="待回票" :value="detail.pendingInvoiceAmount ?? '—'" :money="detail.pendingInvoiceAmount !== null" :tone="detail.pendingInvoiceAmount === null ? undefined : detail.pendingInvoiceAmount > 0 ? 'danger' : 'ok'" :status="detail.pendingInvoiceAmount === null ? '尚未核实' : undefined" />
      </MetricGrid>
    </template>

    <template v-if="detail">
      <section class="panel mb-4 overflow-hidden" aria-labelledby="payment-application-basic-title">
        <SectionHeader id="payment-application-basic-title" title="申请资料" />
        <dl class="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          <div class="info-cell">
            <dt class="text-11px text-ink-faint">
              申请编号
            </dt>
            <dd class="mt-1 font-mono text-12px text-ink">
              {{ detail.no || '自动编号' }}
            </dd>
          </div>
          <div class="info-cell">
            <dt class="text-11px text-ink-faint">
              实际收款对象
            </dt>
            <dd class="mt-1 text-12px font-700 text-ink">
              {{ detail.supplierName || '旧姓名待核验' }}
            </dd>
          </div>
          <div class="info-cell">
            <dt class="text-11px text-ink-faint">
              成本分类
            </dt>
            <dd class="mt-1 text-12px text-ink">
              {{ detail.costName || '—' }}
            </dd>
          </div>
          <div class="info-cell sm:col-span-2 lg:col-span-3">
            <dt class="text-11px text-ink-faint">
              付款内容
            </dt>
            <dd class="mt-1 whitespace-pre-wrap break-words text-12px leading-5 text-ink">
              {{ detail.payContent || '暂无付款内容' }}
            </dd>
          </div>
        </dl>
      </section>

      <section v-if="detail.contractId" class="panel mb-4 overflow-hidden" aria-labelledby="payment-application-contract-title">
        <SectionHeader id="payment-application-contract-title" title="合同付款情况" />
        <p v-if="sourceLabel(detail.contractSourceState)" class="px-4 py-2 text-12px text-ink-soft">
          {{ sourceLabel(detail.contractSourceState) }}；累计结算与支付金额保留待核验状态。
        </p>
        <div class="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          <div class="info-cell">
            <span class="text-11px text-ink-faint">关联合同</span>
            <NuxtLink v-if="!detail.contractSourceState || detail.contractTarget" :to="detail.contractTarget || `/contract/${detail.contractId}`" class="mt-1 block truncate text-12px text-brand hover:underline">
              {{ detail.contractNo || detail.contractName || '查看合同' }}
            </NuxtLink>
            <span v-else class="mt-1 block break-words text-12px">{{ detail.contractNo || detail.contractName || detail.contractId }}</span>
          </div>
          <div class="info-cell">
            <span class="text-11px text-ink-faint">合同金额</span>
            <strong class="mt-1 block font-mono text-12px text-ink">{{ detail.contractAmount === null ? '待核验' : yuan(detail.contractAmount) }}</strong>
          </div>
          <div class="info-cell">
            <span class="text-11px text-ink-faint">累计已结算</span>
            <strong class="mt-1 block font-mono text-12px text-ink">{{ detail.contractSettledAmount === null ? '待核验' : yuan(detail.contractSettledAmount) }}</strong>
          </div>
          <div class="info-cell">
            <span class="text-11px text-ink-faint">本次申请后付款额</span>
            <strong class="mt-1 block font-mono text-12px text-brand">{{ detail.contractPaidAmount === null ? '待核验' : yuan(detail.contractPaidAmount + detail.applyAmount) }}</strong>
          </div>
        </div>
      </section>

      <section class="panel mb-4 overflow-hidden" aria-labelledby="payment-application-settlement-title">
        <SectionHeader id="payment-application-settlement-title" title="付款关联结算" :subtitle="`${detail.settlements.length} 条 · 已关联 ${yuan(detail.settlementAllocated)} · 差额 ${yuan(detail.settlementDifference)}`" />
        <div v-if="detail.settlements.length" class="overflow-x-auto">
          <table class="detail-table min-w-160">
            <thead><tr><th>结算单</th><th>结算日期</th><th>结算金额</th><th>本次关联</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="row in detail.settlements" :key="row.id">
                <td class="font-600 text-ink">
                  <NuxtLink v-if="row.sourceState === 'readable'" :to="`/contract/other-settlement/${row.id}?origin=real`" class="text-brand hover:underline">
                    {{ row.no || row.name || row.id }}
                  </NuxtLink>
                  <span v-else>{{ row.no || row.name || row.id }}</span>
                </td>
                <td>{{ date(row.settlementDate) }}</td>
                <td class="font-mono">
                  {{ row.totalAmount === null ? '来源待核验' : yuan(row.totalAmount) }}
                </td>
                <td class="font-mono text-brand">
                  {{ yuan(row.allocatedAmount) }}
                </td>
                <td>{{ sourceLabel(row.sourceState) || row.status || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="px-4 py-5 text-12px text-ink-faint">
          当前业务类型没有可展示的结算分摊。
        </p>
      </section>

      <section class="panel mb-4 overflow-hidden" aria-labelledby="payment-application-invoice-title">
        <SectionHeader id="payment-application-invoice-title" title="付款关联发票" :subtitle="`${detail.invoices.length} 张 · 回票类型 ${detail.invoiceState || '—'}`" />
        <div v-if="detail.invoices.length" class="overflow-x-auto">
          <table class="detail-table min-w-160">
            <thead><tr><th>发票号码</th><th>开票日期</th><th>发票含税金额</th><th>本次关联</th></tr></thead>
            <tbody>
              <tr v-for="row in detail.invoices" :key="row.id">
                <td>
                  <NuxtLink v-if="!row.sourceState || row.sourceState === 'readable'" :to="`/finance/invoice/${row.id}`" class="text-brand hover:underline">
                    {{ row.invoiceNumber || '未编号发票' }}
                  </NuxtLink>
                  <span v-else>{{ row.invoiceNumber || row.id }}</span>
                </td>
                <td>{{ date(row.invoiceDate) }}</td>
                <td class="font-mono">
                  {{ sourceLabel(row.sourceState) || yuan(row.totalAmount) }}
                </td>
                <td class="font-mono text-brand">
                  {{ yuan(row.allocatedAmount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="px-4 py-5 text-12px text-ink-faint">
          {{ detail.invoiceState === '无需发票' ? '本申请无需发票。' : detail.invoiceState === '先款后票' ? `暂无发票分摊，待回票 ${detail.pendingInvoiceAmount === null ? '尚未核实' : yuan(detail.pendingInvoiceAmount)}。` : detail.invoiceState === '先票后款' ? '暂无发票分摊。' : '回票类型尚未核实，请核对原记录。' }}
        </p>
      </section>

      <section class="panel overflow-hidden" aria-labelledby="payment-application-payment-title">
        <SectionHeader id="payment-application-payment-title" title="支付明细" :subtitle="`${detail.payments.length} 笔 · 已确认 ${yuan(detail.paidAmount)} · 待支付 ${yuan(detail.unpaidAmount)}`" />
        <div v-if="detail.payments.length" class="overflow-x-auto">
          <table class="detail-table min-w-180">
            <thead><tr><th>支付记录</th><th>支付日期</th><th>支付金额</th><th>本申请分摊</th><th>确认状态</th></tr></thead>
            <tbody>
              <tr v-for="row in detail.payments" :key="row.id">
                <td>
                  <NuxtLink :to="`/finance/records/${row.id}`" class="text-brand hover:underline">
                    {{ row.no || '查看支付记录' }}
                  </NuxtLink>
                </td>
                <td>{{ date(row.paymentDate) }}</td>
                <td class="font-mono">
                  {{ yuan(row.amount) }}
                </td>
                <td class="font-mono text-brand">
                  {{ yuan(row.allocatedAmount) }}
                </td>
                <td><span class="chip" :class="row.confirmationStatus === 'confirmed' ? 'chip-ok' : 'chip-warn'">{{ row.confirmationStatus === 'confirmed' ? '已确认' : row.confirmationStatus === 'needs_review' ? '待核对' : '草稿' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="px-4 py-5 text-12px text-ink-faint">
          {{ detail.paymentSourceState === 'forbidden' ? '当前身份无支付明细读取权限，不能据此判断没有支付记录。' : '暂无支付记录，可从右上角“登记支付”开始。' }}
        </p>
      </section>
    </template>

    <template #aside>
      <PaymentApplicationInsightPanel v-if="detail" :detail="detail" :status-text="insightStatusText" :status-class="insightStatusClass" />
    </template>
  </EntityDetailShell>
</template>

<style scoped>
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: var(--ink-soft);
}

.detail-table th,
.detail-table td {
  border-bottom: 1px solid var(--line);
  padding: 9px 12px;
  text-align: left;
  white-space: nowrap;
}

.detail-table th {
  background: var(--surface-2);
  color: var(--ink-faint);
  font-size: 11px;
  font-weight: 700;
}

.detail-table tbody tr:last-child td {
  border-bottom: 0;
}
</style>
