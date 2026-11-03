<script setup lang="ts">
import type { PayrollAFeesFormRead } from '~/lib/payroll/central-a-fees-contract'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollActualLocation } from '~/lib/payroll/adjustment-navigation'
import PayrollAFeeLinesTable from './PayrollAFeeLinesTable.vue'
import PayrollANegativeLinesTable from './PayrollANegativeLinesTable.vue'

const props = defineProps<{
  read: PayrollAFeesFormRead
  returnTo: string
}>()
const route = useRoute()
const panel = shallowRef<HTMLElement | null>(null)
let active = true
let focusRequest = 0
const management = computed(() => props.read.book?.bookPurpose === 'management')
const amounts = computed(() => [{ label: '普通工作金额', value: props.read.totals.workAmount }, { label: '逐条补贴', value: props.read.totals.subsidyAmount }, { label: '管理费', value: props.read.totals.managementAmount }, { label: '负价清单', value: props.read.totals.negativeAmount }, { label: '清单合计', value: props.read.totals.listAmount }, { label: '累计应付', value: props.read.totals.cumulativeAmount }, { label: '本簿此前实际已领', value: props.read.totals.previouslyPaid }, { label: '本次核算应发', value: props.read.totals.grossAmount }])
async function focus() {
  const request = ++focusRequest
  const wanted = route.query.focus
  if (!active || typeof wanted !== 'string' || !props.read.fees?.lines.some(line => line.feeId === wanted))
    return
  await nextTick()
  if (!active || request !== focusRequest || route.query.focus !== wanted)
    return
  const row = [...panel.value?.querySelectorAll<HTMLElement>('[data-fee-focus]') ?? []].find(row => row.dataset.feeFocus === wanted)
  row?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  row?.focus({ preventScroll: true })
}
watch([() => route.query.focus, () => props.read], () => void focus(), { flush: 'post', immediate: true })
onActivated(() => {
  active = true
  void focus()
})
onDeactivated(() => {
  active = false
  focusRequest += 1
})
onScopeDispose(() => {
  active = false
  focusRequest += 1
})
</script>

<template>
  <section id="section-fees" ref="panel" class="panel grid min-w-0 scroll-mt-4 gap-4 p-4" aria-label="工资费用组成">
    <SectionHeader :title="management ? '管理费进度款 · 独立管理簿' : '普通施工工资 · 补贴组成'" />
    <p v-if="!read.fees" class="text-12px text-warn" role="status">
      费用依据未能完整读取，不能按无费用核算。
    </p>
    <template v-else>
      <p v-if="read.bookProof.state !== 'proven'" class="text-12px text-warn">
        {{ read.bookProof.reasons.join('；') }}
      </p>
      <p v-if="management" class="text-12px leading-5 text-ink-soft">
        {{ read.fees.management?.revision.evidenceNote }}。本簿只累计自己的实际已领，不扣除管理人普通施工簿的工资。
      </p>
      <div class="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="amount in amounts" :key="amount.label" class="min-w-0 rounded border border-line p-3">
          <p class="text-12px text-ink-faint">
            {{ amount.label }}
          </p><p class="mt-1 break-words font-mono text-14px font-700">
            {{ payrollAmountSummary(amount.value) }}
          </p><p v-for="reason in amount.value.reasons" :key="reason" class="mt-1 break-all text-11px text-warn">
            {{ reason }}
          </p>
        </div>
      </div>
      <PayrollAFeeLinesTable :lines="read.fees.lines" :return-to="returnTo" />
      <PayrollANegativeLinesTable v-if="management" :lines="read.fees.negativeLines" />
      <section class="grid gap-2" aria-label="本簿此前实际已领">
        <h3 class="text-13px font-700">
          本簿此前实际已领
        </h3><p v-if="!read.previousBookPayments.length" class="text-12px text-ink-faint">
          当前没有已证明的本簿此前实付。
        </p><div v-for="payment in read.previousBookPayments" :key="payment.statementId" class="flex flex-wrap items-start justify-between gap-2 border-b border-line py-2 text-12px">
          <NuxtLink :to="payrollActualLocation({ kind: 'released-statement', statementId: payment.statementId }, read.context.origin, returnTo)" class="cell--link">
            {{ payment.month }} 原工资
          </NuxtLink><span class="font-mono">{{ payrollAmountSummary(payment.amount) }}</span>
        </div>
      </section>
    </template>
  </section>
</template>
