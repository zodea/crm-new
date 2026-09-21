<script setup lang="ts">
import type { PayrollBatchDecision, PayrollBatchPlanRead, PayrollBatchPreviewRead } from '~/lib/payroll/central-batch-service-contract'
import type { PayrollContext, PayrollStatementRow } from '~/lib/payroll/central-contract'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { parsePayrollBatchFundingFen } from '~/lib/payroll/central-batch-calculation'

const props = defineProps<{
  open: boolean
  context: PayrollContext
  projectId: string
  month: string
  rows: PayrollStatementRow[]
}>()
const emit = defineEmits<{ 'update:open': [boolean], 'complete': [] }>()
const store = usePayrollBatchStore()
const purpose = ref<'check' | 'release'>('release')
const fundingInput = ref('')
const preview = shallowRef<PayrollBatchPreviewRead | null>(null)
const plan = shallowRef<PayrollBatchPlanRead | null>(null)
const decisions = ref<Record<string, 'apply' | 'defer'>>({})
const amounts = ref<Record<string, string>>({})
const allocations = ref<Record<string, Record<string, string>>>({})
const busy = ref(false)
const error = ref('')

const query = computed(() => ({ origin: props.context.origin, projectId: props.projectId, month: props.month }))
const selectedIds = computed(() => props.rows.map(row => row.id))
const remaining = computed(() => plan.value ? plan.value.items.length - plan.value.nextItemIndex : 0)
const planLabel = computed(() => {
  if (!plan.value)
    return ''
  if (plan.value.state === 'complete')
    return '批次已完成；暂缓项仍保持未发。'
  if (plan.value.state === 'needs-recheck')
    return '原工资依据或执行版本发生变化，请关闭后重新预览。'
  if (plan.value.state === 'prepared')
    return '下一张原工资命令已保存，继续时只会恢复同一编号和正文。'
  return `尚有 ${remaining.value} 项待逐单执行。`
})

function fenInput(value: number | null): string {
  return value === null ? '' : (value / 100).toFixed(2)
}
function outcomeLabel(itemId: string): string {
  const outcome = plan.value?.outcomes.find(item => item.itemId === itemId)
  if (!outcome)
    return '结果不可用'
  if (outcome.state === 'succeeded')
    return outcome.actualAmountFen === null ? '成功' : `成功 · 实际 ${fenInput(outcome.actualAmountFen)} 元`
  if (outcome.state === 'unknown')
    return outcome.plannedAmountFen === null ? '待核实' : `待核实 · 计划 ${fenInput(outcome.plannedAmountFen)} 元`
  return outcome.plannedAmountFen === null ? '确定未执行' : `确定未执行 · 实际 0.00 元 / 计划 ${fenInput(outcome.plannedAmountFen)} 元`
}
function draftSnapshot() {
  return { purpose: purpose.value, statementIds: selectedIds.value, fundingInput: fundingInput.value, amounts: { ...amounts.value }, allocations: structuredClone(allocations.value), ...(plan.value ? { planId: plan.value.planId } : {}) }
}
function remember() {
  store.rememberDraft(props.context, props.projectId, props.month, draftSnapshot())
}
function initialize(read: PayrollBatchPreviewRead) {
  const restored = store.getDraft(props.context, props.projectId, props.month, selectedIds.value)
  decisions.value = {}
  amounts.value = {}
  allocations.value = {}
  for (const item of read.items) {
    const suggestion = read.funding?.items.find(row => row.itemId === item.target.itemId)?.suggestedAmountFen ?? null
    const amount = restored?.amounts[item.target.itemId] ?? fenInput(suggestion)
    decisions.value[item.target.itemId] = item.reasons.length || suggestion === null ? 'defer' : 'apply'
    amounts.value[item.target.itemId] = amount
    let amountFen = 0
    try {
      amountFen = amount ? parsePayrollBatchFundingFen(amount) : 0
    }
    catch { /* 保留可编辑草稿；固定计划时再给出明确字段错误。 */ }
    allocations.value[item.target.itemId] = Object.fromEntries(item.members.map((member, index) => [member.workerId, restored?.allocations[item.target.itemId]?.[member.workerId] ?? fenInput(index === 0 ? amountFen : 0)]))
  }
}
async function readPreview() {
  error.value = ''
  busy.value = true
  try {
    const fundingAmountFen = purpose.value === 'release' ? parsePayrollBatchFundingFen(fundingInput.value) : null
    const read = await store.preview(query.value, { purpose: purpose.value, projectId: props.projectId, month: props.month, statementIds: selectedIds.value, fundingAmountFen })
    preview.value = read
    plan.value = null
    initialize(read)
    remember()
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
function buildDecision(item: PayrollBatchPreviewRead['items'][number]): PayrollBatchDecision {
  if (decisions.value[item.target.itemId] === 'defer')
    return { kind: 'defer' }
  if (purpose.value === 'check')
    return { kind: 'check' }
  const actualAmountFen = parsePayrollBatchFundingFen(amounts.value[item.target.itemId] ?? '')
  const itemAllocations = allocations.value[item.target.itemId] ?? {}
  return { kind: 'release', actualAmountFen, allocations: item.members.map(member => ({ workerId: member.workerId, amountFen: parsePayrollBatchFundingFen(itemAllocations[member.workerId] ?? '') })) }
}
async function confirmPlan() {
  if (!preview.value)
    return
  error.value = ''
  busy.value = true
  try {
    const read = preview.value
    const input = { purpose: read.input.purpose, projectId: read.input.projectId, month: read.input.month, previewVersion: read.previewVersion, fundingAmountFen: read.input.fundingAmountFen, items: read.items.map(item => ({ ...item.target, decision: buildDecision(item) })) }
    plan.value = await store.confirm(read, input)
    remember()
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function advance() {
  if (!plan.value)
    return
  error.value = ''
  busy.value = true
  try {
    plan.value = await store.advance(plan.value)
    remember()
    if (plan.value.state === 'complete')
      emit('complete')
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
function amountChanged(itemId: string) {
  const item = preview.value?.items.find(row => row.target.itemId === itemId)
  if (!item)
    return
  try {
    const amount = parsePayrollBatchFundingFen(amounts.value[itemId] ?? '')
    const current = allocations.value[itemId] ?? {}
    allocations.value[itemId] = Object.fromEntries(item.members.map((member, index) => [member.workerId, index === 0 ? fenInput(amount) : current[member.workerId] ?? '0.00']))
    remember()
  }
  catch { remember() }
}
function allocationChanged(itemId: string, workerId: string, event: Event) {
  const target = event.target as HTMLInputElement
  allocations.value[itemId] = { ...(allocations.value[itemId] ?? {}), [workerId]: target.value }
  remember()
}
watch(() => props.open, async (open) => {
  if (!open)
    return
  const restored = store.getDraft(props.context, props.projectId, props.month, selectedIds.value)
  purpose.value = restored?.purpose ?? 'release'
  fundingInput.value = restored?.fundingInput ?? ''
  preview.value = null
  plan.value = null
  error.value = ''
  if (restored?.planId) {
    busy.value = true
    try {
      plan.value = await store.loadPlan(query.value, restored.planId)
    }
    catch { /* 计划不可读时保留原资金输入，允许重新预览。 */ }
    finally { busy.value = false }
  }
}, { immediate: true })
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[min(880px,calc(100dvh-24px))] w-[min(980px,calc(100dvw-24px))] min-w-0 flex-col overflow-hidden p-0" @escape-key-down="busy && $event.preventDefault()" @interact-outside="busy && $event.preventDefault()">
      <div class="border-b border-line px-5 py-4">
        <DialogTitle>批量核对与资金安排</DialogTitle>
        <DialogDescription class="mt-1">
          {{ projectId }} · {{ month }} · 已选 {{ rows.length }} 份工资。确认计划不会直接发放，后续按原单逐项执行。
        </DialogDescription>
      </div>
      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section v-if="!plan" class="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <label class="grid gap-1 text-12px">用途<select v-model="purpose" class="field-input" :disabled="busy || !!preview"><option value="release">批量发放</option><option value="check">批量核对</option></select></label>
          <label v-if="purpose === 'release'" class="grid gap-1 text-12px">本期资金总额（元）<input v-model="fundingInput" class="field-input" inputmode="decimal" placeholder="0.00" :disabled="busy || !!preview" @input="remember"></label>
          <KitButton :disabled="busy || !rows.length" @click="readPreview">
            {{ preview ? '重新预览' : '生成预览' }}
          </KitButton>
        </section>

        <section v-if="preview && !plan" class="space-y-3">
          <div v-if="preview.funding" class="grid gap-2 rounded-lg border border-line bg-surface-soft p-3 text-12px sm:grid-cols-4">
            <span>可发余额：{{ fenInput(preview.funding.eligibleTotalFen) || '未知' }} 元</span><span>建议合计：{{ fenInput(preview.funding.suggestedTotalFen) || '未知' }} 元</span><span>未分配：{{ fenInput(preview.funding.unallocatedFen) || '未知' }} 元</span><span>超出：{{ fenInput(preview.funding.overAllocatedFen) }} 元</span>
          </div>
          <p v-for="reason in preview.reasons" :key="reason" class="rounded-md bg-warning/10 px-3 py-2 text-12px text-warning-strong">
            {{ reason }}
          </p>
          <article v-for="item in preview.items" :key="item.target.itemId" class="rounded-lg border border-line p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div><strong>{{ item.leaderName || '负责人未记录' }}</strong><span class="ml-2 text-12px text-ink-soft">{{ item.target.formatFamily }} · {{ item.status }}</span></div>
              <label class="flex items-center gap-2 text-12px"><input v-model="decisions[item.target.itemId]" type="radio" value="defer" @change="remember">暂缓</label>
              <label v-if="!item.reasons.length" class="flex items-center gap-2 text-12px"><input v-model="decisions[item.target.itemId]" type="radio" value="apply" @change="remember">{{ purpose === 'check' ? '核对' : '执行发放' }}</label>
            </div>
            <p class="mt-1 text-12px text-ink-soft">
              当前可发：{{ fenInput(item.eligibleAmountFen) || '未知' }} 元 · 取整：{{ item.rounding.state === 'configured' ? item.rounding.rule.kind === 'off' ? '明确关闭' : '向下整百' : item.rounding.state === 'missing' ? '尚未配置' : '不适用' }}
            </p>
            <ul v-if="item.reasons.length" class="mt-2 list-disc pl-5 text-12px text-danger">
              <li v-for="reason in item.reasons" :key="reason">
                {{ reason }}
              </li>
            </ul>
            <template v-if="purpose === 'release' && decisions[item.target.itemId] === 'apply'">
              <label class="mt-3 grid max-w-60 gap-1 text-12px">实际发放（元）<input v-model="amounts[item.target.itemId]" class="field-input" inputmode="decimal" @change="amountChanged(item.target.itemId)"></label>
              <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label v-for="member in item.members" :key="member.workerId" class="grid gap-1 text-12px">{{ member.workerName || member.workerId }}<input :value="allocations[item.target.itemId]?.[member.workerId] ?? ''" class="field-input" inputmode="decimal" @input="allocationChanged(item.target.itemId, member.workerId, $event)"></label>
              </div>
            </template>
          </article>
        </section>

        <section v-if="plan" class="rounded-lg border border-line p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong>批次状态：{{ plan.state }}</strong><p class="mt-1 text-12px text-ink-soft">
                {{ planLabel }}
              </p>
            </div><KitButton v-if="plan.state === 'ready' || plan.state === 'prepared'" :disabled="busy" @click="advance">
              {{ plan.state === 'prepared' ? '恢复当前项' : '执行下一项' }}
            </KitButton>
          </div>
          <ol class="mt-4 space-y-2 text-12px">
            <li v-for="item in plan.items" :key="item.target.itemId" class="flex justify-between gap-3 rounded bg-surface-soft px-3 py-2">
              <span>{{ item.leaderName || item.target.statementId }} · {{ item.target.formatFamily }}</span><span>{{ outcomeLabel(item.target.itemId) }}</span>
            </li>
          </ol>
        </section>
        <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-3 py-2 text-12px text-danger">
          {{ error }}
        </p>
      </div>
      <DialogFooter class="border-t border-line px-5 py-3">
        <KitButton v-if="preview && !plan" :disabled="busy" @click="confirmPlan">
          固定批次计划
        </KitButton>
        <KitButton variant="secondary" :disabled="busy" @click="emit('update:open', false)">
          关闭
        </KitButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
