<script setup lang="ts">
import type { PayrollHollowConfigQuery, PayrollHollowConfigRead, PayrollHollowPolicyDraft } from '~/lib/payroll/central-hollow-deduction-contract'
import { useEventListener, useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import KitButton from '~/components/ui/KitButton.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollHollowStore } from '~/stores/payroll-hollow'
import PayrollACommandState from './PayrollACommandState.vue'

interface Row extends Omit<PayrollHollowPolicyDraft, 'enabled' | 'unitAmount'> { enabled: boolean | null, unitAmount: string }
interface Cache { rows: Row[], baseline: string, sourceVersion: string }
const props = withDefaults(defineProps<{ config: PayrollHollowConfigQuery, origin: 'real' | 'demo', blocked?: boolean }>(), { blocked: false })
const emit = defineEmits<{ locked: [locked: boolean], changed: [] }>()
const store = usePayrollHollowStore()
const kit = useKitUI()
const target = () => payrollACanonical([props.origin, props.config])
const ui = usePayrollRead(target, () => store.loadConfig({ origin: props.origin }, props.config))
const { current, loading } = ui
const read = shallowRef<PayrollHollowConfigRead | null>(null)
const rows = shallowRef<Row[]>([])
const baseline = shallowRef('[]')
const needsRecheck = shallowRef(false)
const staleRead = shallowRef<PayrollHollowConfigRead | null>(null)
const working = shallowRef(false)
const error = shallowRef('')
const errorPanel = shallowRef<{ focus: () => void } | null>(null)
const cache = useSessionStorage<Record<string, Cache>>('payroll-hollow-policy-inputs-v1', {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
const key = (value: PayrollHollowConfigRead) => payrollACanonical([value.context.workspaceId, value.context.actorId, value.context.origin, value.query])
const matching = computed(() => read.value && payrollACanonical([read.value.context.origin, read.value.query]) === target() ? read.value : null)
const pending = computed(() => matching.value ? store.getPending(matching.value) : null)
const busy = computed(() => props.blocked || loading.value || working.value)
const dirty = computed(() => payrollACanonical(rows.value) !== baseline.value)
const editable = computed(() => !!matching.value && !!current.value && current.value.eligibility.canSave && props.origin === 'real' && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write') && !busy.value && !pending.value && !ui.error.value)
const fromDraft = (draft: PayrollHollowPolicyDraft): Row => ({ ...draft, unitAmount: draft.unitAmount === null ? '' : String(draft.unitAmount) })
function initial(value: PayrollHollowConfigRead): Row[] {
  return value.policies.map(policy => ({ policyId: value.revisions.find(revision => revision.id === policy.revisionId)?.policyId ?? null, baseRevisionId: policy.revisionId, itemId: policy.itemId, enabled: policy.enabled, unitAmount: policy.unitAmount === null ? '' : String(policy.unitAmount), effectiveMonth: value.query.month }))
}
function remember() {
  if (matching.value)
    cache.value = { ...cache.value, [key(matching.value)]: { rows: JSON.parse(JSON.stringify(rows.value)), baseline: baseline.value, sourceVersion: matching.value.context.sourceVersion } }
}
function adopt(value: PayrollHollowConfigRead, persist = true) {
  read.value = value
  rows.value = initial(value)
  baseline.value = payrollACanonical(rows.value)
  needsRecheck.value = false
  if (persist)
    remember()
}
watch(current, (value) => {
  if (!value)
    return
  const saved = cache.value[key(value)]
  adopt(value, false)
  if (saved && typeof saved.baseline === 'string' && typeof saved.sourceVersion === 'string' && Array.isArray(saved.rows) && saved.rows.every(row => row && ['itemId', 'unitAmount', 'effectiveMonth'].every(field => typeof row[field as keyof Row] === 'string') && [true, false, null].includes(row.enabled))) {
    rows.value = JSON.parse(JSON.stringify(saved.rows))
    baseline.value = saved.baseline
    needsRecheck.value = dirty.value
  }
  const operation = store.getPending(value)
  if (operation?.command.action.kind === 'save-hollow-policies') {
    const originals = operation.command.action.policies.map(fromDraft)
    rows.value = [...rows.value.filter(row => !originals.some(original => original.itemId === row.itemId)), ...originals]
    needsRecheck.value = false
  }
})
watch(() => !!pending.value || working.value, value => emit('locked', value), { immediate: true })
onBeforeUnmount(() => {
  remember()
  emit('locked', false)
})
function change(index: number, patch: Partial<Row>) {
  if (editable.value) {
    rows.value = rows.value.map((row, i) => i === index ? { ...row, ...patch } : row)
    error.value = ''
    remember()
  }
}
async function capture(cause: unknown) {
  error.value = toErrorMessage(cause)
  if (projectProblemFromUnknown(cause).problem.code === 'stale-source') {
    staleRead.value = current.value
    needsRecheck.value = true
  }
  await nextTick()
  if (ui.active.value)
    errorPanel.value?.focus()
}
async function recheck() {
  if (!current.value || !editable.value)
    return
  if (staleRead.value === current.value) {
    await capture(new Error('请先重新读取资料，再采用当前扣款配置依据。'))
    return
  }
  const value = current.value
  const before = payrollACanonical(rows.value)
  if (!await kit.confirm({ variant: 'simple', title: '采用当前扣款配置依据', message: '保留开关、单处金额及月份输入，采用本次已读取的原修订；保存时仍将验证来源。', confirmLabel: '保留输入并采用' }) || value !== current.value || before !== payrollACanonical(rows.value) || pending.value)
    return
  const latest = initial(value)
  rows.value = rows.value.map((row) => {
    const original = latest.find(item => item.itemId === row.itemId)
    return original ? { ...row, policyId: original.policyId, baseRevisionId: original.baseRevisionId } : row
  })
  read.value = value
  baseline.value = payrollACanonical(latest)
  needsRecheck.value = false
  remember()
}
async function execute(recover = false) {
  const value = matching.value
  if (!value || busy.value || (!recover && (!editable.value || !dirty.value || needsRecheck.value)))
    return
  const requested = target()
  const original = pending.value
  working.value = true
  error.value = ''
  try {
    if (recover && original) {
      await store.recover(original)
    }
    else {
      const old = JSON.parse(baseline.value) as Row[]
      const changed = rows.value.filter(row => !old.some(prior => payrollACanonical(prior) === payrollACanonical(row)))
      if (changed.some(row => row.enabled === null))
        throw new Error('请明确本分项是否启用；未记录不能当成停用。')
      await store.savePolicies(value, changed.map(row => ({ ...row, enabled: row.enabled === true, unitAmount: row.unitAmount.trim() === '' ? null : Number(row.unitAmount) })))
    }
    const operation = store.getPending(value)
    const fresh = await store.loadConfig({ origin: value.context.origin }, value.query)
    if (!ui.active.value || requested !== target())
      return
    if (!operation)
      throw new Error('原扣款配置提交尚未能核对，请保留原输入。')
    store.acknowledge(operation, fresh)
    ui.current.value = fresh
    adopt(fresh)
    emit('changed')
    kit.success('空鼓分项配置已保存并核对。')
  }
  catch (cause) {
    if (ui.active.value && requested === target())
      await capture(cause)
  }
  finally { working.value = false }
}
async function mayLeave() {
  if (pending.value || working.value) {
    await capture(new Error('请先核对原空鼓配置提交，再离开或更换范围。'))
    return false
  }
  remember()
  return true
}
defineExpose({ mayLeave })
onBeforeRouteLeave(mayLeave)
useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  remember()
  if (dirty.value || pending.value) {
    event.preventDefault()
    event.returnValue = ''
  }
})
</script>

<template>
  <section id="section-hollow-config" class="panel my-4 grid min-w-0 gap-4 p-4" aria-label="空鼓分项扣款配置">
    <h3 class="font-700">
      空鼓分项扣款配置
    </h3><p class="text-12px leading-5 text-ink-soft">
      配置按本项目与原请款主体保存；A 工资另区分普通和管理簿。默认单处金额 30 元，明确开启也须在具体工资单人工开始扣款。关闭页面保留未保存输入。
    </p>
    <PayrollACommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error || ui.error.value" focusable @recover="execute(true)" @refresh="ui.load" />
    <p v-if="loading" role="status" class="text-12px">
      正在读取原主体分项开关…
    </p>
    <p v-for="reason in [...current?.reasons ?? [], ...current?.eligibility.reasons ?? []]" :key="reason" class="text-12px text-warn">
      {{ reason }}
    </p>
    <section v-if="needsRecheck" class="grid gap-2 rounded border border-warn/30 p-3 text-12px">
      <p>未保存输入已恢复，请先核对当前原修订后继续保存。</p><KitButton class="justify-self-start" :disabled="!editable" @click="recheck">
        采用当前扣款配置依据
      </KitButton>
    </section>
    <p v-if="matching && !rows.length" class="text-12px text-ink-faint">
      当前主体没有可配置的原分项。
    </p>
    <article v-for="(row, index) in rows" :key="row.itemId" class="grid min-w-0 gap-3 rounded border border-line p-3" :aria-label="`${matching?.policies.find(policy => policy.itemId === row.itemId)?.itemName || '原分项名称未读取'}空鼓配置`">
      <p class="text-12px font-700">
        {{ matching?.policies.find(policy => policy.itemId === row.itemId)?.itemName || '原分项名称未读取' }}
      </p>
      <div class="grid min-w-0 gap-3 sm:grid-cols-3">
        <label class="grid min-w-0 gap-1 text-12px">是否启用<select class="field-input min-w-0 w-full" aria-label="空鼓分项是否启用" :value="row.enabled === null ? '' : String(row.enabled)" :disabled="!editable" @change="change(index, { enabled: ($event.target as HTMLSelectElement).value === '' ? null : ($event.target as HTMLSelectElement).value === 'true' })"><option value="">未记录，须明确选择</option><option value="false">不启用</option><option value="true">启用</option></select></label><label class="grid min-w-0 gap-1 text-12px">单处金额（元/处）<input class="field-input min-w-0 w-full" type="number" min="0" step="any" aria-label="空鼓单处金额" :value="row.unitAmount" :disabled="!editable" @input="change(index, { unitAmount: ($event.target as HTMLInputElement).value })"></label><label class="grid min-w-0 gap-1 text-12px">生效月份<input class="field-input min-w-0 w-full" type="month" aria-label="空鼓配置生效月份" :value="row.effectiveMonth" :disabled="!editable" @input="change(index, { effectiveMonth: ($event.target as HTMLInputElement).value })"></label>
      </div>
      <p class="break-words text-11px leading-5 text-ink-soft">
        原值：{{ matching?.policies.find(policy => policy.itemId === row.itemId)?.enabled === null ? '开关未记录' : matching?.policies.find(policy => policy.itemId === row.itemId)?.enabled ? '启用' : '不启用' }} · {{ payrollAmount(matching?.policies.find(policy => policy.itemId === row.itemId)?.unitAmount ?? null) }} / 处 · {{ row.baseRevisionId ? '保留原修订，保存时再次核对' : '尚无本主体修订' }}
      </p>
      <p v-if="row.unitAmount.trim() === ''" class="text-12px leading-5 text-warn" role="status">
        本次单处金额未填写，不会按零或默认 30 元计算。
      </p>
    </article>
    <KitButton class="justify-self-start" :disabled="!editable || !dirty || needsRecheck" @click="execute(false)">
      {{ working ? '正在核对保存…' : '保存空鼓分项配置' }}
    </KitButton>
  </section>
</template>
