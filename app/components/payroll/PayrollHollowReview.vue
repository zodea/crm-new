<script setup lang="ts">
import type { PayrollHollowRead, PayrollHollowRow } from '~/lib/payroll/central-hollow-deduction-contract'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import KitButton from '~/components/ui/KitButton.vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollHollowStore } from '~/stores/payroll-hollow'
import PayrollACommandState from './PayrollACommandState.vue'

const props = withDefaults(defineProps<{ read: PayrollHollowRead, returnTo: string, blocked?: boolean, readonly?: boolean }>(), { blocked: false, readonly: false })
const emit = defineEmits<{ changed: [], locked: [locked: boolean] }>()
const store = usePayrollHollowStore()
const kit = useKitUI()
const pending = computed(() => store.getPending(props.read))
const working = shallowRef(false)
const error = shallowRef('')
const errorPanel = shallowRef<{ focus: () => void } | null>(null)
const busy = computed(() => working.value || props.blocked)
const started = computed(() => props.read.snapshot?.start ?? null)
const startLabel = computed(() => started.value ? props.read.eligibility.canStart ? '重新开始扣款' : '本单已开始扣款' : '开始扣款')
const writable = computed(() => !props.readonly && props.read.state === 'available' && props.read.eligibility.canStart && !!props.read.target.statementId && props.read.context.origin === 'real' && !props.read.context.readonly && props.read.context.capabilities.includes('payroll:write') && !busy.value && !pending.value)
const stateLabels: Record<PayrollHollowRow['state'], string> = { 'ready': '待人工开始', 'disabled': '本分项未启用', 'rectified': '已全部整改', 'already-processed': '原单已处理', 'needs-decision': '待明确处理规则', 'unknown': '依据未获证明' }
const missingCurrentRows = computed(() => props.read.current ? props.read.rows.filter(row => !props.read.current!.rows.some(current => current.fact.recordId === row.fact.recordId)) : [])
let active = true
onDeactivated(() => {
  active = false
  working.value = false
})
onActivated(() => {
  active = true
})
watch(() => !!pending.value || working.value, value => emit('locked', value), { immediate: true })
onBeforeUnmount(() => {
  active = false
  emit('locked', false)
})
function source(row: PayrollHollowRow) {
  const result = row.source ? resolveNavigationTarget(row.source, { returnTo: props.returnTo }) : null
  return result?.state === 'resolved' ? result.to : null
}
function rowState(row: PayrollHollowRow) {
  const original = started.value?.lines.find(line => line.recordId === row.fact.recordId)
  return original ? `本单已开始扣款 · 原采用 ${original.count} 处` : stateLabels[row.state]
}
function currentChange(row: PayrollHollowRow) {
  const original = props.read.rows.find(value => value.fact.recordId === row.fact.recordId)
  if (!original)
    return `当前新增记录 · ${stateLabels[row.state]}`
  const changes = [
    original.fact.inspection.input.count === row.fact.inspection.input.count ? null : `检查 ${original.fact.inspection.input.count}→${row.fact.inspection.input.count}`,
    original.fact.rectifiedCount === row.fact.rectifiedCount ? null : `整改 ${original.fact.rectifiedCount}→${row.fact.rectifiedCount}`,
    original.fact.remainingCount === row.fact.remainingCount ? null : `余量 ${original.fact.remainingCount}→${row.fact.remainingCount}`,
    original.policy.unitAmount === row.policy.unitAmount ? null : `单价 ${payrollAmount(original.policy.unitAmount)}→${payrollAmount(row.policy.unitAmount)}`,
    original.fact.originalPartyName === row.fact.originalPartyName ? null : `原责任 ${original.fact.originalPartyName}→${row.fact.originalPartyName}`,
  ].filter(Boolean)
  return changes.length ? changes.join('；') : `与原冻结相同 · ${stateLabels[row.state]}`
}
async function capture(cause: unknown) {
  error.value = toErrorMessage(cause)
  await nextTick()
  if (active)
    errorPanel.value?.focus()
}
async function execute(recover = false) {
  const read = props.read
  if (busy.value || (!recover && !writable.value) || !read.target.statementId || !read.scope)
    return
  const original = pending.value
  if (!recover) {
    const accepted = await kit.confirm({ variant: 'simple', title: '确认开始本单空鼓扣款', message: '将重新核对本单原责任下的未整改处数、分项开关和单处金额。只有完整符合条件的来源才会采用；已发原单及实际现金不会在此修改。', confirmLabel: '开始扣款' })
    if (!accepted || read !== props.read || !writable.value || !active)
      return
  }
  working.value = true
  error.value = ''
  try {
    if (recover && original)
      await store.recover(original)
    else
      await store.start(read)
    const operation = store.getPending(read)
    const refreshed = await store.loadStatement({ origin: read.context.origin }, read.scope.formatFamily, read.target.statementId)
    if (!active || read !== props.read)
      return
    if (!operation)
      throw new Error('原空鼓扣款提交尚未能核对，请保留原目标。')
    store.acknowledge(operation, refreshed)
    emit('changed')
    kit.success('本单空鼓扣款已启动并核对，请重新核对工资后确认实际发放。')
  }
  catch (cause) {
    if (active && read === props.read)
      await capture(cause)
  }
  finally { working.value = false }
}
function refresh() {
  emit('changed')
}
onBeforeRouteLeave(async () => {
  if (!pending.value && !working.value)
    return true
  await capture(new Error('请先核对本单原空鼓扣款提交，再离开。'))
  return false
})
</script>

<template>
  <section id="section-hollow-deduction" class="panel grid min-w-0 gap-4 p-4" aria-label="工资空鼓列示与人工扣款">
    <h3 class="font-700">
      空鼓与本次扣款
    </h3>
    <p class="text-12px leading-5 text-ink-soft">
      检查和整改只作为原来源列示。经办人明确开始后才参与本单扣款；不自动暂扣、退款或改变已发工资。
    </p>
    <PayrollACommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" focusable @recover="execute(true)" @refresh="refresh" />
    <p v-if="read.departureNotice" class="rounded border border-warn/30 bg-warn-soft p-3 text-12px leading-5" role="status">
      {{ read.departureNotice.message }}
    </p>
    <p v-for="reason in [...read.reasons, ...read.eligibility.reasons]" :key="reason" class="text-12px leading-5 text-warn">
      {{ reason }}
    </p>
    <p v-if="!read.rows.length" class="text-12px text-ink-faint">
      {{ read.state === 'available' ? '当前请款主体没有可列示的空鼓检查记录，不等于已逐户排查为零。' : '原空鼓检查依据尚未能完整读取。' }}
    </p>
    <div v-else class="min-w-0 max-w-full overflow-x-auto rounded border border-line" tabindex="0" aria-label="空鼓原记录明细，可横向滚动">
      <table class="w-full border-collapse text-12px">
        <thead class="bg-panel-2 text-left">
          <tr>
            <th class="min-w-58 p-3">
              原位置与责任
            </th><th class="min-w-25 p-3">
              检查 / 整改 / 余量
            </th><th class="min-w-27 p-3 text-right">
              单处金额
            </th><th class="min-w-32 p-3 text-right">
              待核金额
            </th><th class="min-w-52 p-3">
              本次处理与来源
            </th>
          </tr>
        </thead><tbody>
          <tr v-for="row in read.rows" :key="row.fact.recordId">
            <td class="border-t border-line p-3 leading-5">
              {{ row.fact.location.locationLabel }}<span class="block text-ink-soft">原责任：{{ row.fact.originalPartyName }}</span>
            </td><td class="border-t border-line p-3 font-mono">
              {{ row.fact.inspection.input.count }} / {{ row.fact.rectifiedCount }} / {{ row.fact.remainingCount }} 处
            </td><td class="whitespace-nowrap border-t border-line p-3 text-right font-mono">
              {{ payrollAmount(row.policy.unitAmount) }}
            </td><td class="whitespace-nowrap border-t border-line p-3 text-right font-mono">
              {{ payrollAmountSummary(row.amount) }}
            </td><td class="border-t border-line p-3 leading-5">
              <span class="block">{{ rowState(row) }}</span><NuxtLink v-if="source(row)" :to="source(row)!" class="cell--link">
                查看原户检查与整改
              </NuxtLink><p v-for="reason in row.sourceUnavailableReasons" v-else :key="reason" class="text-ink-faint">
                {{ reason }}
              </p><p v-for="reason in row.reasons" :key="reason" class="text-warn">
                {{ reason }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <dl class="grid min-w-0 grid-cols-2 gap-3 text-12px lg:grid-cols-4">
      <div v-for="amount in [{ label: '本次请款合计', value: read.totals.claimSubtotal }, { label: '同簿此前已处理扣款', value: read.totals.previousProcessed }, { label: '本单已开始扣款', value: read.totals.currentDeduction }, { label: '扣款后核算应发', value: read.totals.grossAmount }]" :key="amount.label" class="min-w-0 rounded border border-line p-3">
        <dt class="text-ink-soft">
          {{ amount.label }}
        </dt><dd class="mt-2 break-words font-mono font-700">
          {{ payrollAmountSummary(amount.value) }}
        </dd>
      </div>
    </dl>
    <section v-if="read.current" class="grid min-w-0 gap-3 rounded border border-line p-3" aria-label="已发后当前空鼓来源">
      <div>
        <h4 class="font-700">
          当前原来源（不改原工资）
        </h4><p class="mt-1 text-12px leading-5 text-ink-soft">
          下列内容用于解释已发后的整改、改量、改价或责任变化；上方冻结扣款与实发金额保持原样。
        </p>
      </div>
      <p v-if="read.current.departureNotice" class="rounded border border-warn/30 bg-warn-soft p-3 text-12px leading-5" role="status">
        {{ read.current.departureNotice.message }}
      </p>
      <p v-for="reason in read.current.reasons" :key="reason" class="text-12px leading-5 text-warn">
        {{ reason }}
      </p>
      <p v-if="!read.current.rows.length" class="text-12px text-ink-faint">
        {{ read.current.state === 'available' ? '当前没有可列示记录；原冻结记录仍保留在上方。' : '当前原来源未能完整读取；原冻结记录仍保留在上方。' }}
      </p>
      <div v-else class="min-w-0 max-w-full overflow-x-auto rounded border border-line" tabindex="0" aria-label="当前空鼓来源与原冻结对照，可横向滚动">
        <table class="w-full border-collapse text-12px">
          <thead class="bg-panel-2 text-left">
            <tr>
              <th class="min-w-58 p-3">
                当前位置与责任
              </th><th class="min-w-25 p-3">
                检查 / 整改 / 余量
              </th><th class="min-w-27 p-3 text-right">
                当前单价
              </th><th class="min-w-64 p-3">
                相对原冻结变化
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="row in read.current.rows" :key="row.fact.recordId">
              <td class="border-t border-line p-3 leading-5">
                {{ row.fact.location.locationLabel }}<span class="block text-ink-soft">原责任：{{ row.fact.originalPartyName }}</span>
              </td>
              <td class="border-t border-line p-3 font-mono">
                {{ row.fact.inspection.input.count }} / {{ row.fact.rectifiedCount }} / {{ row.fact.remainingCount }} 处
              </td>
              <td class="whitespace-nowrap border-t border-line p-3 text-right font-mono">
                {{ payrollAmount(row.policy.unitAmount) }}
              </td>
              <td class="border-t border-line p-3 leading-5">
                <span class="block">{{ currentChange(row) }}</span><NuxtLink v-if="source(row)" :to="source(row)!" class="cell--link">
                  查看当前原户记录
                </NuxtLink><p v-for="reason in row.sourceUnavailableReasons" v-else :key="reason" class="text-ink-faint">
                  {{ reason }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-for="row in missingCurrentRows" :key="row.fact.recordId" class="text-12px leading-5 text-warn">
        当前来源未列出原冻结记录：{{ row.fact.location.locationLabel }}；请按原记录查看原因，不能据此删除原扣款。
      </p>
    </section>
    <p v-if="!read.target.statementId" class="text-12px text-ink-soft">
      请先保存工资草稿，再对这张单明确开始扣款。
    </p>
    <KitButton v-if="!readonly" class="justify-self-start" :disabled="!writable" @click="execute(false)">
      {{ startLabel }}
    </KitButton>
  </section>
</template>
