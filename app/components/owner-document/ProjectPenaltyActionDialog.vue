<script setup lang="ts">
import type { OwnerCommercialDocumentCommandContextDTO } from '~/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import { matchesPenaltySettlement } from '~/lib/owner-document/project-penalty'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ detail: OwnerCommercialDocumentDetailReadDTO, mode: 'deduct' | 'rectify' | null, refreshing?: boolean }>()
const emit = defineEmits<{ close: [], saved: [], refresh: [] }>()
const store = useOwnerDocumentStore()
const context = shallowRef<OwnerCommercialDocumentCommandContextDTO | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)
const trigger = shallowRef<HTMLElement | null>(null)
const settlementId = ref<string | null>(null)
const amount = ref('')
const note = ref('')
const deadline = ref('')
const pending = computed(() => store.pendingCommand('project_penalty', props.detail.document.id))
const fieldsLocked = computed(() => saving.value || Boolean(pending.value))
const candidates = computed(() => {
  const document = props.detail.document
  const identity = { projectId: document.project.id, supplierId: document.supplier.id, contractId: document.contract.id }
  return (context.value?.settlements ?? []).filter(row => matchesPenaltySettlement(identity, { ...row, status: 'confirmed' }) && (row.remainingAmount ?? row.amount) > 0)
})
async function fetchSettlements(keyword: string) {
  return candidates.value.filter(row => row.label.includes(keyword.trim())).map(row => ({ id: row.id, label: row.label, hint: `可抵扣 ${yuan(row.remainingAmount ?? row.amount)}` }))
}
const selected = computed(() => candidates.value.find(row => row.id === settlementId.value))
const remaining = computed(() => props.detail.document.amounts.kind === 'project_penalty' ? Number(props.detail.document.amounts.remaining) : 0)

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (pending.value)
      return
    const hydrated = await store.hydrateCommand('project_penalty', props.detail.document.id)
    context.value = hydrated?.context ?? null
    if (hydrated?.recoveryOutcome === 'applied') {
      emit('saved')
      emit('close')
    }
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '候选读取失败' }
  finally { loading.value = false }
}
watch(() => props.mode, async (mode) => {
  if (!mode)
    return
  trigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  conflict.value = false
  context.value = null
  settlementId.value = ''
  amount.value = ''
  note.value = ''
  deadline.value = props.detail.penaltyFacts?.deadline ?? ''
  await load()
}, { immediate: true })

async function save() {
  if (!context.value || fieldsLocked.value || props.refreshing)
    return
  const value = Number(amount.value)
  if (props.mode === 'deduct' && (!selected.value?.version || value <= 0 || value > remaining.value || value > (selected.value.remainingAmount ?? selected.value.amount))) {
    error.value = '请选择有效结算，并填写不超过双方剩余额的正数金额'
    return
  }
  if (props.mode === 'rectify' && !note.value.trim()) {
    error.value = '请填写整改说明'
    return
  }
  const values = props.mode === 'deduct'
    ? { action: 'deduct-penalty' as const, settlementId: selected.value!.id, settlementVersion: selected.value!.version!, amount: value, note: note.value }
    : { action: 'rectify-penalty' as const, deadline: deadline.value || null, note: note.value }
  saving.value = true
  error.value = ''
  try {
    await store.executePenaltyAction({ workspaceId: context.value.workspaceId, actorId: context.value.actorId, requiredCapability: 'subcontract-document:write', kind: 'project_penalty', id: props.detail.document.id, baseVersion: props.detail.document.version, ...values })
    emit('saved')
    emit('close')
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，请重试'
    conflict.value = cause instanceof OwnerCommercialDocumentRepositoryProblem && cause.problem.code === 'conflict'
  }
  finally { saving.value = false }
}
async function recover() {
  if (!pending.value || saving.value)
    return
  saving.value = true
  error.value = ''
  try {
    const recovered = await store.recoverCommand('project_penalty', props.detail.document.id)
    context.value = recovered.context
    if (recovered.outcome === 'applied') {
      emit('saved')
      emit('close')
    }
    else {
      emit('refresh')
      error.value = '原提交未生效，请核对当前余额后重新保存'
    }
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '原提交暂未可靠核对' }
  finally { saving.value = false }
}
async function refreshConflict() {
  emit('refresh')
  await load()
  conflict.value = false
}
function restoreFocus(event: Event) {
  event.preventDefault()
  trigger.value?.focus()
}
</script>

<template>
  <Dialog :open="mode !== null" @update:open="value => { if (!value && !saving) emit('close') }">
    <DialogContent class="w-[min(540px,calc(100vw-24px))] max-h-[85vh] overflow-y-auto p-5" :show-close="!saving" @close-auto-focus="restoreFocus">
      <DialogTitle class="text-18px font-700">
        {{ mode === 'deduct' ? '结算抵扣' : '记录整改' }}
      </DialogTitle>
      <DialogDescription class="mt-2 text-13px text-ink-soft">
        {{ mode === 'deduct' ? '核对真实结算和本次金额，确认后保存独立抵扣记录。' : '记录本次整改情况，保留时间与经办历史。' }}
      </DialogDescription>
      <form class="mt-4 grid gap-4" @submit.prevent="save">
        <p v-if="error" role="alert" class="text-13px text-danger">
          {{ error }}
        </p>
        <button v-if="conflict" type="button" class="btn-secondary" @click="refreshConflict">
          刷新余额后重新核对
        </button>
        <p v-if="loading" role="status">
          正在读取可用资料…
        </p>
        <button v-if="!context && !loading && !pending" type="button" class="btn-secondary" @click="load">
          重新加载
        </button>
        <template v-if="mode === 'deduct' && context">
          <label class="grid gap-2 text-13px">真实分包结算
            <LookupSelect v-model="settlementId" :fetch="fetchSettlements" placeholder="检索真实分包结算" :disabled-reason="fieldsLocked ? '请等待原提交核对' : undefined" />
          </label>
          <p v-if="!candidates.length" class="text-13px text-ink-soft">
            暂无来源一致的已确认结算。请先核对罚扣的合同或分供方关系。
          </p>
          <p class="text-13px text-ink-soft">
            罚扣剩余 {{ yuan(remaining) }}<template v-if="selected">
              · 结算可抵扣 {{ yuan(selected.remainingAmount ?? selected.amount) }}
            </template>
          </p>
          <label class="grid gap-2 text-13px">本次抵扣金额<input v-model="amount" class="input w-full" type="number" min="0.01" step="0.01" required :disabled="fieldsLocked"></label>
        </template>
        <label v-if="mode === 'rectify'" class="grid gap-2 text-13px">整改期限<input v-model="deadline" class="input w-full" type="date" :disabled="fieldsLocked"></label>
        <label class="grid gap-2 text-13px">{{ mode === 'deduct' ? '抵扣备注' : '整改说明' }}<textarea v-model="note" class="input w-full min-h-24" :required="mode === 'rectify'" :disabled="fieldsLocked" /></label>
        <div class="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" class="btn-secondary" :disabled="saving" @click="emit('close')">
            取消
          </button>
          <button v-if="pending" type="button" class="btn-primary" :disabled="saving || loading" @click="recover">
            {{ pending.result ? '重新读取已保存单据' : '核对原提交' }}
          </button>
          <button v-else type="submit" class="btn-primary" :disabled="saving || refreshing || loading || conflict || !context || (mode === 'deduct' && !candidates.length)">
            {{ saving ? '正在保存…' : mode === 'deduct' ? '确认抵扣' : '保存整改' }}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
