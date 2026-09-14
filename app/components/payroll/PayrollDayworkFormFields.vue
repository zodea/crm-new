<script setup lang="ts">
import type { PayrollParticipantOptions } from '~/lib/payroll/central-contract'
import type { PayrollDayworkRecordDraft } from '~/lib/payroll/central-daywork-contract'
import { computed } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { c2InputNumber, payrollC2Lookup } from '~/lib/payroll/c2-presentation'

const props = defineProps<{ draft: PayrollDayworkRecordDraft, options: PayrollParticipantOptions, disabled: boolean, errors: Record<string, string> }>()
const emit = defineEmits<{ patch: [value: Partial<PayrollDayworkRecordDraft>] }>()
const projects = computed(() => payrollC2Lookup(props.options.projects))
const workers = computed(() => payrollC2Lookup(props.options.workers.filter(row => row.eligible)))
function worker(id: string) {
  emit('patch', { workerId: id, crewId: props.options.workers.find(row => row.id === id)?.crewId ?? null })
}
</script>

<template>
  <section id="section-record" class="panel grid min-w-0 gap-4 p-4" aria-label="签工登记资料">
    <SectionHeader title="原用工事实" />
    <div class="grid min-w-0 gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<LookupSelect :model-value="draft.projectId || null" :fetch="projects" placeholder="签工项目" field="projectId" :invalid="!!errors.projectId" :disabled-reason="disabled ? '当前记录只读' : undefined" @update:model-value="emit('patch', { projectId: $event || '', workerId: '', crewId: null })" /><span v-if="disabled">{{ options.projects.find(row => row.id === draft.projectId)?.name || '项目名称未记录' }}</span><span class="text-danger">{{ errors.projectId }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">用工人<LookupSelect :model-value="draft.workerId || null" :fetch="workers" placeholder="签工用工人" field="workerId" :invalid="!!errors.workerId" :disabled-reason="disabled ? '当前记录只读' : undefined" @update:model-value="worker($event || '')" /><span v-if="disabled">{{ options.workers.find(row => row.id === draft.workerId)?.name || '姓名未记录' }}</span><span class="text-danger">{{ errors.workerId }}</span></label>
      <p class="text-12px leading-5">
        所属班组：{{ draft.crewId ? options.crews.find(row => row.id === draft.crewId)?.name || '原班组名称未记录' : draft.workerId ? '用工人实际无班组' : '选择用工人后确定' }}
      </p>
      <label class="grid min-w-0 gap-1 text-12px">用工日期<input :value="draft.workDate" type="date" class="field-input min-w-0" aria-label="用工日期" data-field="workDate" :disabled="disabled" @input="emit('patch', { workDate: ($event.target as HTMLInputElement).value })"><span class="text-danger">{{ errors.workDate }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">开始时间<input :value="draft.startTime" type="time" class="field-input min-w-0" aria-label="开始时间" data-field="startTime" :disabled="disabled" @input="emit('patch', { startTime: ($event.target as HTMLInputElement).value })"><span class="text-danger">{{ errors.startTime }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">结束时间<input :value="draft.endTime" type="time" class="field-input min-w-0" aria-label="结束时间" data-field="endTime" :disabled="disabled" @input="emit('patch', { endTime: ($event.target as HTMLInputElement).value })"><span class="text-danger">{{ errors.endTime }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">用工数<select :value="draft.laborUnits ?? ''" class="field-input min-w-0" aria-label="用工数" data-field="laborUnits" :disabled="disabled" @change="emit('patch', { laborUnits: c2InputNumber(($event.target as HTMLSelectElement).value) })"><option value="">请选择整工或半工</option><option value="1">整工 · 1 工</option><option value="0.5">半工 · 0.5 工</option></select><span class="text-danger">{{ errors.laborUnits }}</span></label>
    </div>
    <label class="grid min-w-0 gap-1 text-12px">施工内容<textarea :value="draft.workContent" rows="4" class="field-input min-w-0" aria-label="施工内容" data-field="workContent" :disabled="disabled" @input="emit('patch', { workContent: ($event.target as HTMLTextAreaElement).value })" /><span class="text-danger">{{ errors.workContent }}</span></label>
    <p class="text-12px leading-5 text-ink-soft">
      整工与半工由经办人明确选择，不按时段自动折算。保存待确认记录不计薪；人工确认后方可核算。
    </p>
  </section>
  <section id="section-confirm" class="panel grid min-w-0 gap-4 p-4" aria-label="签工证明信息">
    <SectionHeader title="证明与确认" /><div class="grid min-w-0 gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">证明人<input :value="draft.witness" class="field-input min-w-0" aria-label="证明人" data-field="witness" :disabled="disabled" @input="emit('patch', { witness: ($event.target as HTMLInputElement).value })"><span class="text-danger">{{ errors.witness }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">确认日期<input :value="draft.confirmedOn ?? ''" type="date" class="field-input min-w-0" aria-label="确认日期" data-field="confirmedOn" :disabled="disabled" @input="emit('patch', { confirmedOn: ($event.target as HTMLInputElement).value || null })"><span class="text-danger">{{ errors.confirmedOn }}</span></label>
    </div><p class="text-12px leading-5 text-ink-soft">
      填写证明信息后选择“保存并确认”才表示本次人工确认；待确认可暂不填写。确认规则不自动扣款。
    </p>
    <label class="grid min-w-0 gap-1 text-12px">备注<textarea :value="draft.note" rows="3" class="field-input min-w-0" aria-label="签工备注" :disabled="disabled" @input="emit('patch', { note: ($event.target as HTMLTextAreaElement).value })" /></label>
  </section>
</template>
