<script setup lang="ts">
import type { PayrollADraft, PayrollAOptions, PayrollARatioDefault } from '~/lib/payroll/central-a-contract'
import { computed } from 'vue'
import { payrollInputNumber, payrollRatioLabel } from '~/lib/payroll/a-presentation'

const props = defineProps<{ draft: PayrollADraft, options: PayrollAOptions, ratioDefault: PayrollARatioDefault, disabled: boolean, fieldErrors: Record<string, string> }>()
const emit = defineEmits<{ patch: [value: Partial<PayrollADraft>] }>()
const workers = computed(() => props.options.workers.filter(worker => !props.draft.crewId || worker.crewId === props.draft.crewId))
function leader(value: string) {
  emit('patch', { leaderWorkerId: value, memberWorkerIds: value ? [...new Set([value, ...props.draft.memberWorkerIds])] : props.draft.memberWorkerIds })
}
function member(id: string, checked: boolean) {
  emit('patch', { memberWorkerIds: checked ? [...new Set([...props.draft.memberWorkerIds, id])] : props.draft.memberWorkerIds.filter(value => value !== id) })
}
</script>

<template>
  <section id="section-basic" class="panel min-w-0 scroll-mt-4 p-4" aria-label="A工资基本资料">
    <SectionHeader title="请款范围" />
    <div class="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<select :value="draft.projectId" class="field-input min-w-0 w-full" aria-label="工资项目" data-field="projectId" :disabled="disabled" @change="emit('patch', { projectId: ($event.target as HTMLSelectElement).value, crewId: null, leaderWorkerId: '', memberWorkerIds: [] })"><option value="">请选择项目</option><option v-for="project in options.projects" :key="project.id" :value="project.id">{{ project.name || '项目名称未记录' }}</option></select><span v-if="fieldErrors.projectId" class="text-danger">{{ fieldErrors.projectId }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">工资月份<input :value="draft.month" type="month" class="field-input min-w-0 w-full" aria-label="工资月份" data-field="month" :disabled="disabled" @input="emit('patch', { month: ($event.target as HTMLInputElement).value })"><span v-if="fieldErrors.month" class="text-danger">{{ fieldErrors.month }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">工资档位<select :value="draft.periodKind" class="field-input min-w-0 w-full" aria-label="工资档位" :disabled="disabled" @change="emit('patch', { periodKind: ($event.target as HTMLSelectElement).value as PayrollADraft['periodKind'], ...(String(($event.target as HTMLSelectElement).value) === 'retention' ? { payRatio: 1 } : {}) })"><option value="monthly">月度请款</option><option value="settlement">工程结算</option><option value="retention">尾款</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">班组<select :value="draft.crewId || ''" class="field-input min-w-0 w-full" aria-label="请款班组" data-field="crewId" :disabled="disabled" @change="emit('patch', { crewId: ($event.target as HTMLSelectElement).value || null, leaderWorkerId: '', memberWorkerIds: [] })"><option value="">未关联班组</option><option v-for="crew in options.crews" :key="crew.id" :value="crew.id" :disabled="!crew.eligible">{{ crew.name || '班组名称未记录' }}{{ crew.eligible ? '' : ` · ${crew.reasons.join('；')}` }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">请款负责人<select :value="draft.leaderWorkerId" class="field-input min-w-0 w-full" aria-label="请款负责人" data-field="leaderWorkerId" :disabled="disabled" @change="leader(($event.target as HTMLSelectElement).value)"><option value="">请选择负责人</option><option v-for="worker in workers" :key="worker.id" :value="worker.id" :disabled="!worker.eligible">{{ worker.name || '姓名未记录' }}{{ worker.eligible ? '' : ` · ${worker.reasons.join('；')}` }}</option></select><span v-if="fieldErrors.leaderWorkerId" class="text-danger">{{ fieldErrors.leaderWorkerId }}</span></label>
      <div class="grid min-w-0 gap-1 text-12px">
        <label class="grid gap-1">费用默认比例（%）<input :value="draft.payRatio === null ? '' : draft.payRatio * 100" class="field-input min-w-0 w-full" type="number" min="0" max="100" step="0.01" data-field="payRatio" aria-label="本次支付比例" :disabled="disabled || draft.periodKind === 'retention'" @input="emit('patch', { payRatio: payrollInputNumber(($event.target as HTMLInputElement).value) === null ? null : Number(($event.target as HTMLInputElement).value) / 100 })"></label>
        <p class="text-ink-faint">
          {{ payrollRatioLabel(ratioDefault) }}
        </p>
        <button v-if="ratioDefault.value !== null && draft.payRatio !== ratioDefault.value && draft.periodKind !== 'retention'" type="button" class="cell--link justify-self-start" :disabled="disabled" @click="emit('patch', { payRatio: ratioDefault.value })">
          采用建议比例 {{ ratioDefault.value * 100 }}%
        </button>
        <span v-if="fieldErrors.payRatio" class="text-danger">{{ fieldErrors.payRatio }}</span>
      </div>
    </div>
    <fieldset class="mt-4 grid gap-2" :disabled="disabled">
      <legend class="mb-2 text-12px font-700">
        本次请款成员（包括负责人）
      </legend>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label v-for="worker in workers" :key="worker.id" class="flex min-w-0 items-start gap-2 text-12px"><input type="checkbox" :checked="draft.memberWorkerIds.includes(worker.id)" :disabled="!worker.eligible || worker.id === draft.leaderWorkerId" class="mt-0.5" @change="member(worker.id, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ worker.name || '姓名未记录' }}{{ worker.id === draft.leaderWorkerId ? '（负责人）' : '' }}</span></label>
      </div>
      <p v-if="!workers.length" class="text-12px text-ink-faint">
        当前范围没有可选工人。核对项目与班组后读取候选，不自动代选负责人。
      </p>
      <p v-if="fieldErrors.memberWorkerIds" class="text-12px text-danger">
        {{ fieldErrors.memberWorkerIds }}
      </p>
    </fieldset>
  </section>
</template>
