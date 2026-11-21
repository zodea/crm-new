<script setup lang="ts">
import type { PayrollAttendanceInput } from '~/lib/payroll/c1-presentation'
import type { PayrollAttendanceFact, PayrollAttendanceRecordDraft, PayrollAttendanceWorker } from '~/lib/payroll/central-attendance-contract'
import { computed, reactive, shallowRef, watch } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { c1InputNumber } from '~/lib/payroll/c1-presentation'

const props = defineProps<{ open: boolean, worker: PayrollAttendanceWorker, workDate: string, records: PayrollAttendanceFact[], busy: boolean, pending: boolean, awaitingRead?: boolean, error: string, readonlyReasons: string[], original?: PayrollAttendanceRecordDraft, initial?: PayrollAttendanceInput }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'save': [record: PayrollAttendanceRecordDraft], 'recover': [], 'change': [input: PayrollAttendanceInput | null] }>()
const kit = useKitUI()
const draft = reactive({ hours: null as number | null, overtimeHours: null as number | null, workContent: '', note: '' })
const original = shallowRef('')
const confirming = shallowRef(false)
const locked = computed(() => props.busy || props.pending)
const valid = computed(() => draft.hours !== null && draft.overtimeHours !== null && draft.hours >= 0 && draft.overtimeHours >= 0 && draft.hours + draft.overtimeHours <= 24)
watch(() => JSON.stringify([props.worker.id, props.workDate]), () => {
  const record = props.records[0]
  const baseline = { hours: record ? record.hours : 8, overtimeHours: record ? record.overtimeHours : 0, workContent: record?.workContent ?? '', note: record?.note ?? '' }
  original.value = JSON.stringify(baseline)
  const input = props.original ?? props.initial ?? baseline
  Object.assign(draft, { hours: input.hours, overtimeHours: input.overtimeHours, workContent: input.workContent, note: input.note })
}, { immediate: true })
watch(draft, () => emit('change', JSON.stringify(draft) === original.value ? null : { ...draft }), { deep: true, flush: 'sync' })
async function close(value: boolean) {
  if (locked.value || confirming.value)
    return
  const target = JSON.stringify([props.worker.id, props.workDate])
  const before = JSON.stringify(draft)
  if (!value && before !== original.value) {
    confirming.value = true
    try {
      const accepted = await kit.confirm({ variant: 'simple', title: '放弃考勤修改', message: '这一天的修改尚未保存，确认放弃？', confirmLabel: '放弃修改' })
      if (!accepted || locked.value || JSON.stringify(draft) !== before || JSON.stringify([props.worker.id, props.workDate]) !== target)
        return
    }
    finally {
      confirming.value = false
    }
  }
  emit('update:open', value)
}
function save() {
  if (valid.value && !locked.value && !props.readonlyReasons.length)
    emit('save', { workerId: props.worker.id, crewId: props.worker.crewId, workDate: props.workDate, hours: draft.hours!, overtimeHours: draft.overtimeHours!, workContent: draft.workContent, note: draft.note })
}
</script>

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="w-[min(600px,calc(100dvw-24px))] p-0" @escape-key-down="locked && $event.preventDefault()" @interact-outside="locked && $event.preventDefault()">
      <div class="border-b border-line p-5">
        <DialogTitle>{{ worker.name || '姓名未记录' }} · {{ workDate }}</DialogTitle><DialogDescription class="mt-2 text-12px">
          按这一天实际情况登记。新格默认 8 小时尚未保存；零工时请明确填 0。
        </DialogDescription>
      </div>
      <form class="grid max-h-[65dvh] gap-4 overflow-y-auto p-5" @submit.prevent="save">
        <p v-for="reason in readonlyReasons" :key="reason" class="text-12px leading-5 text-warn">
          {{ reason }}
        </p>
        <fieldset class="grid gap-4 sm:grid-cols-2" :disabled="locked || !!readonlyReasons.length">
          <label class="grid min-w-0 gap-1 text-12px">正常工时<input :value="draft.hours ?? ''" class="field-input min-w-0" aria-label="正常工时" type="number" min="0" max="24" step="any" @input="draft.hours = c1InputNumber(($event.target as HTMLInputElement).value)"></label>
          <label class="grid min-w-0 gap-1 text-12px">加班工时<input :value="draft.overtimeHours ?? ''" class="field-input min-w-0" aria-label="加班工时" type="number" min="0" max="24" step="any" @input="draft.overtimeHours = c1InputNumber(($event.target as HTMLInputElement).value)"></label>
          <label class="grid min-w-0 gap-1 text-12px sm:col-span-2">施工内容<textarea v-model="draft.workContent" class="field-input w-full min-w-0" rows="3" aria-label="施工内容" /></label>
          <label class="grid min-w-0 gap-1 text-12px sm:col-span-2">备注<textarea v-model="draft.note" class="field-input w-full min-w-0" rows="2" aria-label="考勤备注" /></label>
        </fieldset>
        <p v-if="!valid && !readonlyReasons.length" class="text-12px text-danger" role="alert">
          请填写非负工时，正常与加班合计不能超过 24 小时。
        </p>
        <p v-if="error" class="text-12px leading-5 text-danger" role="alert">
          {{ error }}；本格输入已保留。
        </p>
        <p v-if="pending" class="text-12px text-warn">
          {{ awaitingRead ? '提交已保存，等待读取原结果，请核对原提交。' : '提交结果尚未确认，请核对原提交。' }}
        </p>
      </form>
      <DialogFooter class="flex flex-wrap gap-2 border-t border-line p-4">
        <KitButton variant="secondary" :disabled="locked" @click="close(false)">
          关闭
        </KitButton><KitButton v-if="pending" :disabled="busy" @click="emit('recover')">
          核对原提交
        </KitButton><KitButton v-else-if="!readonlyReasons.length" variant="primary" :disabled="locked || !valid" @click="save">
          {{ busy ? '正在保存…' : '保存考勤' }}
        </KitButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
