<script setup lang="ts">
import type { ClearanceBindingInput } from './clearance-binding-input'
import type { ExpenseClearanceSourceDTO } from '~/lib/finance/clearance-verification'
import type { OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { financeDraftMoney } from '~/lib/finance/input-number'

interface AllocationTarget { id: string, originalExpenseLineId: string, amount: number | null }
const props = defineProps<{ draft: OtherSettlementDraft, expenses: readonly ExpenseClearanceSourceDTO[], targets: readonly AllocationTarget[], confirmed: boolean, disabled: boolean, unsaved: boolean }>()
const emit = defineEmits<{ patch: [value: Partial<OtherSettlementDraft>], link: [] }>()
const input = defineModel<ClearanceBindingInput>({ required: true })
const sources = computed(() => props.expenses.filter(source => props.draft.originalExpenses?.some(row => row.originalExpenseLineId === source.id)))
const proofs = computed(() => sources.value.flatMap(source => source.clearanceProofs.filter(proof => proof.id === source.qualification.verificationId).map(proof => ({ source, proof }))))
const selected = computed(() => proofs.value.find(row => row.proof.id === input.value.verificationId))
const bindingTargets = computed(() => props.targets.filter(target => target.originalExpenseLineId === selected.value?.source.id))
function adopted(sourceId: string) {
  return props.draft.originalExpenses?.find(row => row.originalExpenseLineId === sourceId)
}
function remaining(source: ExpenseClearanceSourceDTO, verificationId: string, itemId: string) {
  return source.clearanceItemAvailability.find(row => row.verificationId === verificationId && row.itemId === itemId)?.amountRemaining ?? null
}
function portion(sourceId: string) {
  const row = adopted(sourceId)
  const bindings = row?.clearanceAllocations ?? []
  if (row?.amount === null || row?.amount === undefined || !Number.isFinite(row.amount) || bindings.some(binding => !Number.isFinite(binding.amount)))
    return { total: null, old: null, fresh: null }
  const old = bindings.reduce((sum, binding) => sum + binding.amount, 0)
  return { total: row.amount, old, fresh: row.amount - old }
}
function chooseItem(sourceId: string, verificationId: string, itemId: string, amount: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked && (!Number.isFinite(amount) || amount <= 0))
    return
  const originalExpenses = props.draft.originalExpenses?.map(row => row.originalExpenseLineId !== sourceId ? row : { ...row, clearanceAllocations: checked ? [...(row.clearanceAllocations ?? []), { verificationId, itemId, amount }] : (row.clearanceAllocations ?? []).filter(binding => binding.itemId !== itemId) })
  emit('patch', { originalExpenses })
}
function changeAmount(sourceId: string, itemId: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('patch', { originalExpenses: props.draft.originalExpenses?.map(row => row.originalExpenseLineId !== sourceId ? row : { ...row, clearanceAllocations: row.clearanceAllocations?.map(binding => binding.itemId === itemId ? { ...binding, amount: value === '' ? Number.NaN : Number(value) } : binding) }) })
}
function selectProof(event: Event) {
  input.value = { verificationId: (event.target as HTMLSelectElement).value, bindings: [] }
}
function addBinding() {
  input.value = { ...input.value, bindings: [...input.value.bindings, { expenseAllocationId: '', itemId: '', amount: '' }] }
}
</script>

<template>
  <section v-if="sources.length" class="panel min-w-0 p-4" aria-label="旧份额关联与待实付">
    <h2 class="m-0 text-14px font-700">
      旧份额关联与待实付
    </h2>
    <p class="text-12px leading-6 text-ink-muted">
      新增份额和已核旧份额可以在同一结算明示承接。旧处理记录不等于已付现金；保存关联不会产生银行付款或改写原已确认结算。
    </p>
    <div v-for="source in sources" :key="source.id" class="mt-3 min-w-0 rounded border border-line p-3">
      <h3 class="m-0 break-words text-13px">
        {{ source.expenseItem }} · {{ source.applicantNameSnapshot }}
      </h3>
      <p role="status" class="break-words text-12px">
        {{ source.qualification.message }}
      </p>
      <dl class="grid min-w-0 gap-3 sm:grid-cols-3" :aria-label="`${source.expenseItem} 承接金额`">
        <div v-for="metric in [{ label: '本次新增采用', value: portion(source.id).fresh }, { label: '承接已核旧份额', value: portion(source.id).old }, { label: '总采用', value: portion(source.id).total }, { label: '可新增采用额度', value: source.qualification.newAdoptableAmount }, { label: '旧份额实际已付', value: source.qualification.legacyPaidAmount }, { label: '原链待实付', value: source.qualification.legacyUnpaidAmount }]" :key="metric.label">
          <dt class="text-12px text-ink-muted">
            {{ metric.label }}
          </dt><dd class="m-0 font-mono">
            {{ metric.value === null ? '待核实' : financeDraftMoney(metric.value) }}
          </dd>
        </div>
      </dl>
      <NuxtLink :to="`/finance/reimbursement/${source.headerId}?origin=real`" class="text-12px text-brand underline">
        查看原费用与替代核验
      </NuxtLink>
      <fieldset v-if="!confirmed" class="mt-3 min-w-0" :disabled="disabled || source.qualification.state !== 'verified'">
        <legend class="text-12px">
          本次明确承接的旧份额
        </legend>
        <template v-for="row in proofs.filter(row => row.source.id === source.id)" :key="row.proof.id">
          <div v-for="item in row.proof.items" :key="item.id" class="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
            <label class="min-w-0 break-words text-12px"><input type="checkbox" :checked="adopted(source.id)?.clearanceAllocations?.some(binding => binding.itemId === item.id)" :disabled="!adopted(source.id)?.clearanceAllocations?.some(binding => binding.itemId === item.id) && (remaining(source, row.proof.id, item.id) === null || (remaining(source, row.proof.id, item.id) ?? -1) <= 0)" :aria-label="`承接旧份额 ${item.matchBasis}`" @change="chooseItem(source.id, row.proof.id, item.id, remaining(source, row.proof.id, item.id) ?? Number.NaN, $event)">{{ item.matchBasis }} · 已核 {{ financeDraftMoney(item.amount) }} · 尚可承接 {{ remaining(source, row.proof.id, item.id) === null ? '待核实' : financeDraftMoney(remaining(source, row.proof.id, item.id)) }}<span v-if="item.missingOriginalDocument" class="block text-warn-ink">原单缺失，已采用替代证据</span></label>
            <label v-if="adopted(source.id)?.clearanceAllocations?.some(binding => binding.itemId === item.id)" class="text-12px">本次旧份额金额<input type="number" min="0" step="0.01" :max="remaining(source, row.proof.id, item.id) ?? undefined" :value="Number.isFinite(adopted(source.id)?.clearanceAllocations?.find(binding => binding.itemId === item.id)?.amount) ? adopted(source.id)?.clearanceAllocations?.find(binding => binding.itemId === item.id)?.amount : ''" class="field-input mt-1" :aria-label="`旧份额 ${item.matchBasis} 本次金额`" @input="changeAmount(source.id, item.id, $event)"></label>
          </div>
        </template>
      </fieldset>
      <p v-if="source.clearanceLinks.length" class="break-words text-12px text-ink-muted">
        原明确关联共 {{ source.clearanceLinks.length }} 条，按真实采用行保留；不凭相同金额再生成关联。
      </p>
    </div>
    <fieldset v-if="confirmed && proofs.length" class="mt-4 min-w-0" :disabled="disabled">
      <legend class="font-700 text-13px">
        为已确认结算追加旧份额关联
      </legend>
      <label class="field-block mt-2"><span class="field-label">选择已核旧份额来源</span><select :value="input.verificationId" class="field-input" aria-label="选择已核旧份额来源" @change="selectProof"><option value="">请选择</option><option v-for="row in proofs" :key="row.proof.id" :value="row.proof.id">{{ row.source.expenseItem }} · {{ row.proof.basis }}</option></select></label>
      <template v-if="selected">
        <div v-for="(binding, index) in input.bindings" :key="index" class="mt-3 grid min-w-0 gap-3 rounded border border-line p-3 sm:grid-cols-3">
          <label class="text-12px">实际采用行<select v-model="binding.expenseAllocationId" class="field-input mt-1" :aria-label="`第 ${index + 1} 项实际采用行`"><option value="">请选择</option><option v-for="target in bindingTargets" :key="target.id" :value="target.id">{{ target.id }} · {{ target.amount === null ? '金额待核实' : financeDraftMoney(target.amount) }}</option></select></label>
          <label class="text-12px">已核旧份额<select v-model="binding.itemId" class="field-input mt-1" :aria-label="`第 ${index + 1} 项已核旧份额`"><option value="">请选择</option><option v-for="item in selected.proof.items" :key="item.id" :value="item.id">{{ item.matchBasis }} · {{ financeDraftMoney(item.amount) }}</option></select></label>
          <label class="text-12px">明确重叠金额<input v-model="binding.amount" inputmode="decimal" class="field-input mt-1" :aria-label="`第 ${index + 1} 项明确重叠金额`"></label>
          <KitButton type="button" @click="input.bindings = input.bindings.filter((_row, position) => position !== index)">
            移除关联项
          </KitButton>
        </div>
        <KitButton class="mt-3" type="button" :disabled="!bindingTargets.length" @click="addBinding">
          新增明确关联
        </KitButton>
        <p v-if="!bindingTargets.length" class="text-12px text-warn-ink">
          当前没有同一原费用的真实采用行，不能自由填写编号。
        </p>
        <p v-if="unsaved" class="text-12px text-warn-ink">
          请先核对已保存版本，不能将普通编辑或附件变更混入关联命令。
        </p>
        <KitButton class="mt-3" type="button" :disabled="disabled || unsaved || !bindingTargets.length" @click="emit('link')">
          保存旧份额关联
        </KitButton>
      </template>
    </fieldset>
  </section>
</template>
