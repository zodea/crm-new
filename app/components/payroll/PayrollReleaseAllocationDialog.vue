<script setup lang="ts">
import type {
  WageAllocationInput,
  WageStatement,
} from '~/lib/payroll/statements'
import { computed, ref, watch } from 'vue'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'

const props = defineProps<{
  open: boolean
  statement: WageStatement
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': [actualAmount: number, allocations: WageAllocationInput[]]
}>()

interface AllocationDraft {
  workerId: string
  workerName: string
  isLeader: boolean
  amount: number
}

const actualAmount = ref(0)
const drafts = ref<AllocationDraft[]>([])
const allocationTouched = ref(false)

function toFen(value: number): number | null {
  if (!Number.isFinite(value) || value < 0)
    return null
  const fen = value * 100
  return Math.abs(fen - Math.round(fen)) <= 1e-8 ? Math.round(fen) : null
}

function distributeToLeader(amount = actualAmount.value) {
  const amountFen = toFen(amount)
  drafts.value = props.statement.members.map(member => ({
    ...member,
    amount: member.isLeader && amountFen != null ? amountFen / 100 : 0,
  }))
  allocationTouched.value = false
}

function resetForm() {
  actualAmount.value = props.statement.grossAmount
  distributeToLeader(props.statement.grossAmount)
}

watch(
  () => [props.open, props.statement.id] as const,
  ([open]) => {
    if (open)
      resetForm()
  },
  { immediate: true },
)

const actualFen = computed(() => toFen(actualAmount.value))
const grossFen = computed(() => toFen(props.statement.grossAmount) ?? 0)
const allocatedFen = computed(() => drafts.value.reduce((sum, draft) => {
  const amountFen = toFen(Number(draft.amount))
  return amountFen == null ? Number.NaN : sum + amountFen
}, 0))
const remainingFen = computed(() =>
  actualFen.value == null || !Number.isFinite(allocatedFen.value)
    ? null
    : actualFen.value - allocatedFen.value,
)
const canConfirm = computed(() =>
  actualFen.value != null
  && actualFen.value > 0
  && actualFen.value <= grossFen.value
  && drafts.value.length === props.statement.members.length
  && Number.isFinite(allocatedFen.value)
  && remainingFen.value === 0,
)
const validationMessage = computed(() => {
  if (actualFen.value == null)
    return '实际发放金额必须是非负且精确到分的数字'
  if (actualFen.value <= 0)
    return '实际发放金额必须大于 0'
  if (actualFen.value > grossFen.value)
    return `实际发放不能超过核算应发 ${money(props.statement.grossAmount)}`
  if (!Number.isFinite(allocatedFen.value))
    return '成员分配金额必须非负并精确到分'
  if (remainingFen.value !== 0)
    return `成员合计与实际发放相差 ${money(Math.abs(remainingFen.value ?? 0) / 100)}`
  return ''
})

function updateActual(value: string) {
  actualAmount.value = Number(value)
  if (!allocationTouched.value)
    distributeToLeader(actualAmount.value)
}

function updateAllocation(workerId: string, value: string) {
  allocationTouched.value = true
  const draft = drafts.value.find(item => item.workerId === workerId)
  if (draft)
    draft.amount = Number(value)
}

function close() {
  emit('update:open', false)
}

function confirmRelease() {
  if (!canConfirm.value || actualFen.value == null)
    return
  emit(
    'confirm',
    actualFen.value / 100,
    drafts.value.map(draft => ({
      workerId: draft.workerId,
      amount: (toFen(Number(draft.amount)) ?? 0) / 100,
    })),
  )
  close()
}

function money(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[min(600px,calc(100dvw-24px))] p-0">
      <div class="border-b border-line px-5 py-4">
        <DialogTitle>
          确认实际发放
        </DialogTitle>
        <DialogDescription class="mt-1 text-12px leading-5">
          核算应发 {{ money(statement.grossAmount) }}。默认全部分配给负责人，也可按实际收款情况拆分给组员。
        </DialogDescription>
      </div>

      <div class="max-h-[min(65dvh,560px)] overflow-y-auto px-5 py-4">
        <label class="grid gap-1.5 text-12px font-700 text-ink-soft sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
          <span>实际发放总额</span>
          <input
            :value="actualAmount"
            aria-label="实际发放总额"
            class="h-9 min-w-0 rounded border border-line px-2 font-mono text-ink"
            type="number"
            min="0"
            :max="statement.grossAmount"
            step="0.01"
            @input="updateActual(($event.target as HTMLInputElement).value)"
          >
        </label>

        <div class="mt-4 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-13px font-800 text-ink">
              组内收款分配
            </h3>
            <p class="mt-0.5 text-11px text-ink-faint">
              零金额成员仍会保留在发放快照中。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" @click="distributeToLeader()">
            全部给负责人
          </Button>
        </div>

        <div class="mt-3 divide-y divide-line rounded-md border border-line">
          <label
            v-for="draft in drafts"
            :key="draft.workerId"
            class="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
          >
            <span class="min-w-0">
              <span class="text-13px font-700 text-ink">{{ draft.workerName }}</span>
              <span v-if="draft.isLeader" class="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-10px font-700 text-brand">
                负责人
              </span>
            </span>
            <input
              :value="draft.amount"
              :aria-label="`${draft.workerName}分配金额`"
              class="h-9 min-w-0 rounded border border-line px-2 text-right font-mono text-ink"
              type="number"
              min="0"
              step="0.01"
              @input="updateAllocation(draft.workerId, ($event.target as HTMLInputElement).value)"
            >
          </label>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-3 rounded-md bg-surface-2 px-3 py-2.5 text-12px">
          <p class="text-ink-soft">
            已分配
            <strong class="ml-1 font-mono text-ink">
              {{ Number.isFinite(allocatedFen) ? money(allocatedFen / 100) : '—' }}
            </strong>
          </p>
          <p class="text-right text-ink-soft">
            待分配
            <strong
              class="ml-1 font-mono"
              :class="remainingFen === 0 ? 'text-success' : 'text-danger'"
            >
              {{ remainingFen == null ? '—' : money(Math.abs(remainingFen) / 100) }}
            </strong>
          </p>
        </div>
        <p
          v-if="validationMessage"
          role="alert"
          class="mt-2 text-11px leading-5 text-danger"
        >
          {{ validationMessage }}
        </p>
      </div>

      <DialogFooter class="border-t border-line px-5 py-3">
        <Button type="button" variant="outline" @click="close">
          取消
        </Button>
        <Button type="button" variant="accent" :disabled="!canConfirm" @click="confirmRelease">
          确认已发放
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
