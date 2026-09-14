<script setup lang="ts">
import type { PayrollC2Draft } from '~/lib/payroll/central-c2-contract'
import type { PayrollParticipantOptions } from '~/lib/payroll/central-contract'
import { computed } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'

const props = defineProps<{
  draft: PayrollC2Draft
  options: PayrollParticipantOptions
  disabled: boolean
  fieldErrors: Record<string, string>
}>()
const emit = defineEmits<{
  patch: [
        patch: Partial<PayrollC2Draft>,
  ]
}>()
const workers = computed(() => props.options.workers.filter(worker => (!props.draft.crewId && !props.draft.leaderWorkerId) || worker.crewId === props.draft.crewId || props.draft.memberWorkerIds.includes(worker.id)))
function lookup(rows: { id: string, name: string | null }[]) {
  return async (keyword: string) => rows.filter(row => `${row.name || ''} ${row.id}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(row => ({ id: row.id, label: row.name || '名称未记录' }))
}
const projects = computed(() => lookup(props.options.projects))
const crews = computed(() => lookup(props.options.crews.filter(row => row.eligible)))
const leaders = computed(() => lookup(workers.value.filter(row => row.eligible)))
function leader(id: string) {
  const selected = props.options.workers.find(worker => worker.id === id)
  const crewId = selected?.crewId ?? null
  const kept = props.draft.memberWorkerIds.filter(memberId => props.options.workers.some(worker => worker.id === memberId && worker.crewId === crewId))
  emit('patch', { leaderWorkerId: id, crewId, memberWorkerIds: [...new Set([...kept, ...id ? [id] : []])] })
}
function member(id: string, selected: boolean) {
  emit('patch', { memberWorkerIds: selected ? [...new Set([...props.draft.memberWorkerIds, id])] : props.draft.memberWorkerIds.filter(value => value !== id) })
}
</script>

<template>
  <section id="section-basic" class="panel grid min-w-0 gap-4 p-4" aria-label="C2工资基本资料">
    <SectionHeader title="请款范围" /><p class="text-12px leading-5 text-ink-soft">
      C2 按本月已确认签工与本请款主体单价核算，固定月度 100%；不扣前月工资。
    </p>
    <div class="grid min-w-0 gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<LookupSelect :model-value="draft.projectId || null" :fetch="projects" placeholder="工资项目" field="projectId" :invalid="!!fieldErrors.projectId" :disabled-reason="disabled ? '当前工资范围仅供核对' : undefined" @update:model-value="emit('patch', { projectId: $event || '', crewId: null, leaderWorkerId: '', memberWorkerIds: [] })" /><span v-if="disabled" class="text-ink-soft">{{ options.projects.find(row => row.id === draft.projectId)?.name || '未选择项目' }}</span><span class="text-danger">{{ fieldErrors.projectId }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">工资月份<input :value="draft.month" type="month" class="field-input min-w-0" aria-label="工资月份" data-field="month" :disabled="disabled" @input="emit('patch', { month: ($event.target as HTMLInputElement).value })"><span class="text-danger">{{ fieldErrors.month }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">所属班组<LookupSelect :model-value="draft.crewId" :fetch="crews" placeholder="请款班组" field="crewId" :disabled-reason="disabled ? '当前工资范围仅供核对' : undefined" @update:model-value="emit('patch', { crewId: $event, leaderWorkerId: '', memberWorkerIds: [] })" /><span class="text-ink-soft">{{ draft.crewId ? options.crews.find(row => row.id === draft.crewId)?.name : draft.leaderWorkerId ? '负责人实际无班组' : '选择负责人后确定班组' }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">负责人<LookupSelect :model-value="draft.leaderWorkerId || null" :fetch="leaders" placeholder="请款负责人" field="leaderWorkerId" :invalid="!!fieldErrors.leaderWorkerId" :disabled-reason="disabled ? '当前工资范围仅供核对' : undefined" @update:model-value="leader($event || '')" /><span v-if="disabled" class="text-ink-soft">{{ options.workers.find(row => row.id === draft.leaderWorkerId)?.name || '未选择负责人' }}</span><span class="text-danger">{{ fieldErrors.leaderWorkerId }}</span></label>
    </div>
    <fieldset :disabled="disabled">
      <legend class="mb-3 text-12px font-700">
        全部请款成员（包含无签工与零收款成员）
      </legend><div class="grid gap-3 sm:grid-cols-2">
        <label v-for="worker in workers" :key="worker.id" class="flex min-w-0 items-start gap-2 text-12px"><input type="checkbox" :checked="draft.memberWorkerIds.includes(worker.id)" :disabled="!worker.eligible || worker.id === draft.leaderWorkerId" @change="member(worker.id, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ worker.name || '姓名未记录' }}{{ worker.id === draft.leaderWorkerId ? '（负责人）' : '' }}<span v-if="!worker.eligible" class="block text-warn">{{ worker.reasons.join('；') }}</span></span></label>
      </div><p v-if="!workers.length" class="text-12px text-ink-faint">
        请选择项目、月份与班组后核对合法人员；不自动代选。
      </p><p class="mt-2 text-12px text-danger">
        {{ fieldErrors.memberWorkerIds }}
      </p>
    </fieldset>
  </section>
</template>
