<script setup lang="ts">
import type {
  SignedDayworkInput,
  SignedDayworkRecord,
} from '~/lib/payroll/daywork'
import type { PayrollOption } from '~/lib/payroll/statements'
import { computed, reactive, watch } from 'vue'

const props = defineProps<{
  projectId: string
  crewId?: string
  month: string
  workers: PayrollOption[]
  record?: SignedDayworkRecord | null
}>()

const emit = defineEmits<{
  save: [input: SignedDayworkInput]
  cancel: []
}>()

function initialDate(): string {
  const today = new Date().toISOString().slice(0, 10)
  return today.startsWith(props.month) ? today : `${props.month}-01`
}

const draft = reactive({
  workerId: '',
  workDate: initialDate(),
  workContent: '',
  startTime: '08:00',
  endTime: '18:00',
  laborUnits: 1 as 0.5 | 1,
  witness: '',
  confirmedOn: initialDate(),
  status: 'confirmed' as 'draft' | 'confirmed',
  note: '',
})

const eligibleWorkers = computed(() =>
  props.workers.filter(worker => !props.crewId || worker.crewId === props.crewId),
)

watch(eligibleWorkers, (workers) => {
  if (!workers.some(worker => worker.id === draft.workerId))
    draft.workerId = workers[0]?.id ?? ''
}, { immediate: true })

watch(() => props.record, (record) => {
  if (record) {
    Object.assign(draft, {
      workerId: record.workerId,
      workDate: record.workDate,
      workContent: record.workContent,
      startTime: record.startTime,
      endTime: record.endTime,
      laborUnits: record.laborUnits === 0.5 ? 0.5 : 1,
      witness: record.witness,
      confirmedOn: record.confirmedOn ?? '',
      status: record.status,
      note: record.note,
    })
    return
  }
  draft.workerId = eligibleWorkers.value[0]?.id ?? ''
  draft.workDate = initialDate()
  draft.workContent = ''
  draft.startTime = '08:00'
  draft.endTime = '18:00'
  draft.laborUnits = 1
  draft.witness = ''
  draft.confirmedOn = draft.workDate
  draft.status = 'confirmed'
  draft.note = ''
}, { immediate: true })

watch(() => props.month, () => {
  draft.workDate = initialDate()
  draft.confirmedOn = draft.workDate
})

watch(() => draft.workDate, (date) => {
  if (draft.status === 'confirmed' && (!draft.confirmedOn || draft.confirmedOn < date))
    draft.confirmedOn = date
})

watch(() => draft.status, (status) => {
  if (status === 'draft')
    draft.confirmedOn = ''
  else if (!draft.confirmedOn)
    draft.confirmedOn = draft.workDate
})

function submit() {
  if (!props.projectId || !draft.workerId)
    return
  emit('save', {
    id: props.record?.id,
    projectId: props.projectId,
    crewId: props.crewId || null,
    workerId: draft.workerId,
    workDate: draft.workDate,
    workContent: draft.workContent,
    startTime: draft.startTime,
    endTime: draft.endTime,
    laborUnits: draft.laborUnits,
    witness: draft.witness,
    confirmedOn: draft.confirmedOn || null,
    status: draft.status,
    note: draft.note,
  })
  if (!props.record) {
    draft.workContent = ''
    draft.note = ''
  }
}
</script>

<template>
  <form
    class="panel grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-8"
    :aria-label="record ? '编辑签工记录' : '新增签工记录'"
    @submit.prevent="submit"
  >
    <div class="md:col-span-3 xl:col-span-8 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-14px font-800 text-ink">
          {{ record ? '编辑逐日签工' : '新增逐日签工' }}
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          整工录 1，半工录 0.5；证明人确认后才可进入 C2 工资。
        </p>
      </div>
      <span class="chip-brand">C2 真实来源</span>
    </div>

    <label class="field">
      <span>用工人</span>
      <select v-model="draft.workerId" required>
        <option v-for="worker in eligibleWorkers" :key="worker.id" :value="worker.id">
          {{ worker.name }}
        </option>
      </select>
    </label>
    <label class="field">
      <span>日期</span>
      <input v-model="draft.workDate" type="date" required>
    </label>
    <label class="field">
      <span>开始</span>
      <input v-model="draft.startTime" type="time" required>
    </label>
    <label class="field">
      <span>结束</span>
      <input v-model="draft.endTime" type="time" required>
    </label>
    <label class="field">
      <span>用工数</span>
      <select v-model.number="draft.laborUnits">
        <option :value="1">整工 · 1</option>
        <option :value="0.5">半工 · 0.5</option>
      </select>
    </label>
    <label class="field">
      <span>状态</span>
      <select v-model="draft.status">
        <option value="confirmed">已确认</option>
        <option value="draft">待确认</option>
      </select>
    </label>
    <label class="field">
      <span>证明人</span>
      <input v-model="draft.witness" type="text" :required="draft.status === 'confirmed'" placeholder="如：王工">
    </label>
    <label class="field">
      <span>确认日期</span>
      <input v-model="draft.confirmedOn" type="date" :required="draft.status === 'confirmed'" :disabled="draft.status === 'draft'">
    </label>
    <label class="field md:col-span-2 xl:col-span-6">
      <span>施工内容</span>
      <input v-model="draft.workContent" type="text" required placeholder="如：地下室积水清理、材料转运">
    </label>
    <label class="field md:col-span-1 xl:col-span-2">
      <span>备注</span>
      <input v-model="draft.note" type="text" placeholder="可选">
    </label>
    <div class="md:col-span-3 xl:col-span-8 flex justify-end gap-2">
      <button v-if="record" type="button" class="btn-secondary" @click="emit('cancel')">
        取消编辑
      </button>
      <button type="submit" class="btn-accent" :disabled="!eligibleWorkers.length">
        {{ record ? '保存修改' : '保存签工' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.field {
  display: grid;
  min-width: 0;
  gap: .375rem;
  color: var(--ink-soft);
  font-size: .75rem;
  font-weight: 700;
}
.field select,
.field input {
  height: 2.25rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: .375rem;
  background: white;
  padding: 0 .625rem;
  color: var(--ink);
}
.field input:disabled {
  background: var(--surface-2);
  color: var(--ink-faint);
}
</style>
