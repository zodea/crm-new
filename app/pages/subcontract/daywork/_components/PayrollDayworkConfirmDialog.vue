<script setup lang="ts">
import type { PayrollDayworkFormRead } from '~/lib/payroll/central-daywork-contract'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ read: PayrollDayworkFormRead, open: boolean }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const store = useDayworkCentralStore()
const kit = useKitUI()
const basis = shallowRef(props.read)
const pending = computed(() => store.getDayworkPending(basis.value))
const command = pending.value?.restoredFromDescriptor ? null : pending.value?.command
const initial = command?.action.kind === 'confirm-daywork' ? command.action.confirmation : { witness: props.read.record?.witness ?? '', confirmedOn: props.read.record?.confirmedOn ?? '' }
const draft = ref({ ...initial })
const original = JSON.stringify(initial)
const busy = shallowRef(false)
const error = shallowRef('')
const changedAfter = shallowRef(false)
const readFailed = shallowRef(false)
const refreshedBasis = shallowRef(false)
let alive = true
onScopeDispose(() => {
  alive = false
})
const dirty = computed(() => JSON.stringify(draft.value) !== original)
const locked = computed(() => busy.value || !!pending.value || changedAfter.value)
const canConfirm = computed(() => !readFailed.value && !basis.value.context.readonly && basis.value.context.capabilities.includes('payroll:write') && basis.value.eligibility.canConfirm)
async function mayClose() {
  if (busy.value || pending.value)
    return false
  return !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃证明信息修改', message: '当前证明信息尚未保存，确认放弃？', confirmLabel: '放弃修改' })
}
useTabCloseGuard(mayClose)
useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (dirty.value || pending.value) {
    event.preventDefault()
    event.returnValue = ''
  }
})
async function close(open: boolean) {
  if (!open && await mayClose())
    emit('close')
}
async function refresh() {
  if (locked.value || !props.open)
    return
  const opening = props.read
  const value = basis.value
  busy.value = true
  try {
    const next = await store.loadDayworkForm({ origin: value.context.origin }, { recordId: value.recordId! })
    if (!alive || !props.open || props.read !== opening)
      return
    if (next.recordId !== value.recordId || next.context.origin !== value.context.origin || next.context.workspaceId !== value.context.workspaceId || next.context.actorId !== value.context.actorId)
      throw new Error('当前记录或经办身份已变化，原证明信息仍保留，请重新打开原记录核实。')
    basis.value = next
    refreshedBasis.value = true
    readFailed.value = false
    error.value = ''
  }
  catch (cause) {
    if (alive && props.open && props.read === opening) {
      readFailed.value = true
      error.value = toErrorMessage(cause)
    }
  }
  finally { busy.value = false }
}
async function submit(recover = false) {
  if (busy.value || changedAfter.value || (!recover && (pending.value || !canConfirm.value)))
    return
  const opening = props.read
  const value = basis.value
  busy.value = true
  error.value = ''
  try {
    const existing = pending.value
    const result = recover && existing ? await store.recoverDaywork(existing) : await store.confirmDaywork(value, { ...draft.value })
    const operation = store.getDayworkPending(value)
    const refreshed = await store.loadDayworkForm({ origin: value.context.origin }, { recordId: result.recordId })
    if (!alive || !props.open || props.read !== opening || basis.value !== value || !operation)
      return
    const ack = store.acknowledgeDaywork(operation, refreshed)
    if (ack.changedSinceCommand) {
      changedAfter.value = true
      error.value = '原提交已完成，记录随后有更新。原证明输入仍保留，请关闭后查看当前记录。'
      emit('changed')
      return
    }
    emit('changed')
    emit('close')
    kit.success('签工已人工确认。')
  }
  catch (cause) {
    if (alive && props.open && props.read === opening)
      error.value = toErrorMessage(cause)
  }
  finally { busy.value = false }
}
</script>

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="max-h-[calc(100dvh-24px)] w-[min(540px,calc(100dvw-24px))] flex flex-col overflow-hidden p-0" @escape-key-down="locked && $event.preventDefault()" @interact-outside="locked && $event.preventDefault()">
      <div class="shrink-0 border-b border-line px-5 py-4">
        <DialogTitle>人工确认签工</DialogTitle>
        <DialogDescription class="mt-1 text-12px leading-5">
          {{ basis.record?.workerName || '姓名未记录' }} · {{ basis.record?.workDate }} · {{ basis.record?.laborUnits }} 工。确认只记录本次真实证明信息。
        </DialogDescription>
      </div>
      <div class="grid min-h-0 max-h-[min(65dvh,560px)] gap-4 overflow-y-auto px-5 py-4">
        <p v-if="refreshedBasis" class="text-12px leading-5">
          已按当前记录重新核对，证明输入仍保留。当前施工内容：{{ basis.record?.workContent || '未记录' }}；请核实后再次确认。
        </p>
        <p v-for="reason in basis.eligibility.reasons" :key="reason" class="text-12px leading-5 text-warn">
          {{ reason }}
        </p>
        <label class="grid gap-1 text-12px">证明人<input v-model="draft.witness" class="field-input min-w-0" aria-label="确认签工证明人" :disabled="locked"></label><label class="grid gap-1 text-12px">确认日期<input v-model="draft.confirmedOn" type="date" class="field-input min-w-0" aria-label="人工确认日期" :disabled="locked"></label>
        <p v-if="error" role="alert" class="text-12px leading-5 text-danger">
          {{ error }}
        </p><p v-if="pending" class="text-12px leading-5 text-warn">
          {{ pending.state === 'awaiting-read' ? '确认已保存，等待读取原记录。' : '原提交结果尚未确认，证明信息已保留。' }}
        </p>
      </div>
      <DialogFooter class="flex shrink-0 flex-wrap gap-2 border-t border-line px-5 py-4">
        <Button variant="outline" :disabled="busy || !!pending" @click="close(false)">
          关闭
        </Button><Button v-if="pending" :disabled="busy" @click="submit(true)">
          核对原提交
        </Button><Button v-if="!pending && !changedAfter && (error || refreshedBasis)" variant="outline" :disabled="busy" @click="refresh()">
          按当前记录重新核对证明信息
        </Button><Button v-if="!pending" :disabled="locked || !canConfirm" @click="submit()">
          确认签工
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
