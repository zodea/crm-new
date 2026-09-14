<script setup lang="ts">
import type { PayrollC2FormRead, PayrollC2ReleaseDraft } from '~/lib/payroll/central-c2-contract'
import { computed, ref, watch } from 'vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { c2InputNumber as payrollInputNumber, c2ReleaseDefault as payrollReleaseDefault, c2ReleaseError as payrollReleaseError } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollReleaseAdjustmentSummary from './PayrollReleaseAdjustmentSummary.vue'

const props = defineProps<{ open: boolean, read: PayrollC2FormRead, busy: boolean, pending: boolean, awaitingRead?: boolean, error: string, initial?: PayrollC2ReleaseDraft | null, readonly?: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'submit': [value: PayrollC2ReleaseDraft], 'change': [value: PayrollC2ReleaseDraft], 'recover': [] }>()
const draft = ref<PayrollC2ReleaseDraft>({ actualAmount: null, allocations: [] })
const touched = ref(false)
const locked = computed(() => props.busy || props.pending)
const validation = computed(() => payrollReleaseError(props.read, draft.value))
const names = computed(() => new Map(props.read.members.map(member => [member.id, member.name || '姓名未记录'])))
watch([() => props.open, () => JSON.stringify([props.read.context.workspaceId, props.read.context.actorId, props.read.context.origin, props.read.statementId])], ([open]) => {
  if (open) {
    draft.value = props.initial ? JSON.parse(JSON.stringify(props.initial)) : payrollReleaseDefault(props.read)
    touched.value = !!props.initial && props.initial.allocations.some(item => item.amount !== (item.workerId === props.read.draft.leaderWorkerId ? props.initial!.actualAmount : 0))
  }
}, { immediate: true })
function actual(value: string) {
  draft.value.actualAmount = payrollInputNumber(value)
  if (!touched.value)
    draft.value.allocations = draft.value.allocations.map(item => ({ ...item, amount: item.workerId === props.read.draft.leaderWorkerId ? draft.value.actualAmount : 0 }))
  emit('change', JSON.parse(JSON.stringify(draft.value)))
}
function allocation(id: string, value: string) {
  touched.value = true
  draft.value.allocations = draft.value.allocations.map(item => item.workerId === id ? { ...item, amount: payrollInputNumber(value) } : item)
  emit('change', JSON.parse(JSON.stringify(draft.value)))
}
function close(value: boolean) {
  if (!locked.value)
    emit('update:open', value)
}
function submit() {
  if (!locked.value && !props.readonly && !validation.value && props.read.eligibility.canRelease)
    emit('submit', JSON.parse(JSON.stringify(draft.value)))
}
</script>

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="w-[min(620px,calc(100dvw-24px))] p-0" @escape-key-down="locked && $event.preventDefault()" @interact-outside="locked && $event.preventDefault()">
      <div class="border-b border-line px-5 py-4">
        <DialogTitle>确认实际发放</DialogTitle>
        <DialogDescription class="mt-1 text-12px leading-5">
          本次核算应发 {{ payrollAmount(read.totals.grossAmount.value) }}。按实际收款填写；确认后保存冻结记录，不能再修改原发放。
        </DialogDescription>
      </div>
      <div class="grid max-h-[min(65dvh,560px)] gap-4 overflow-y-auto px-5 py-4">
        <PayrollReleaseAdjustmentSummary :applications="draft.adjustmentApplications" />
        <label class="grid gap-1 text-12px font-700">实际发放总额<input :value="draft.actualAmount ?? ''" :disabled="locked" aria-label="实际发放总额" class="field-input min-w-0 font-mono" type="number" min="0" step="0.01" @input="actual(($event.target as HTMLInputElement).value)"></label>
        <p class="text-12px text-ink-soft">
          默认付给负责人，可按实际拆分。零金额成员也保留在本次记录中。
        </p>
        <label v-for="item in draft.allocations" :key="item.workerId" class="grid grid-cols-[minmax(0,1fr)_minmax(90px,140px)] items-center gap-3 text-12px">
          <span class="break-words">{{ names.get(item.workerId) }}{{ item.workerId === read.draft.leaderWorkerId ? '（负责人）' : '' }}</span>
          <input :value="item.amount ?? ''" :disabled="locked" :aria-label="`${names.get(item.workerId)}收款金额`" class="field-input min-w-0 font-mono" type="number" min="0" step="0.01" @input="allocation(item.workerId, ($event.target as HTMLInputElement).value)">
        </label>
        <p v-if="validation || error" role="alert" class="text-12px leading-5 text-danger">
          {{ error || validation }}
        </p>
        <p v-if="pending" class="text-12px leading-5 text-warn">
          {{ awaitingRead ? '提交已保存，等待读取原结果，已保留原金额与成员。' : '本次提交结果尚未确认，已保留原金额与成员。请核对原提交。' }}
        </p>
      </div>
      <DialogFooter class="flex flex-wrap gap-2 border-t border-line px-5 py-4">
        <Button variant="outline" :disabled="locked" @click="close(false)">
          取消
        </Button>
        <Button v-if="pending" :disabled="busy" @click="emit('recover')">
          核对原提交
        </Button>
        <Button v-else :disabled="locked || readonly || !!validation || !read.eligibility.canRelease" @click="submit">
          {{ busy ? '正在确认…' : '确认实际发放' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
