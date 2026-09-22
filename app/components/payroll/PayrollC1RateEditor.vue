<script setup lang="ts">
import type { PayrollAttendanceWorker } from '~/lib/payroll/central-attendance-contract'
import type { PayrollC1Rate, PayrollC1RateDraft } from '~/lib/payroll/central-c1-contract'
import { c1InputNumber, c1Number } from '~/lib/payroll/c1-presentation'

const props = defineProps<{
  rates: PayrollC1Rate[]
  drafts: PayrollC1RateDraft[]
  workers: PayrollAttendanceWorker[]
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [
        rates: PayrollC1RateDraft[],
  ]
}>()
function change(workerId: string, field: 'dailyWage' | 'overtimeRate', value: string) {
  emit('change', props.drafts.map(row => row.workerId === workerId ? { ...row, [field]: c1InputNumber(value) } : row))
}
function locked(id: string) {
  return props.disabled || !props.workers.find(worker => worker.id === id)?.eligible
}
</script>

<template>
  <section class="grid min-w-0 gap-4" aria-label="个人工资标准">
    <article v-for="rate in rates" :key="rate.workerId" class="panel grid min-w-0 gap-3 p-4">
      <h2 class="font-700">
        {{ rate.workerName || '姓名未记录' }}
      </h2><p class="text-12px leading-5 text-ink-soft">
        档案日薪：{{ c1Number(rate.profileDailyWage) }} 元；当前有效日薪：{{ c1Number(rate.dailyWage) }} 元。档案有明确日薪时优先采用，下面的工资配置仅作缺档案时的兜底。
      </p>
      <div class="grid min-w-0 gap-4 sm:grid-cols-2">
        <label class="grid min-w-0 gap-1 text-12px">缺档案时个人日薪<input :value="drafts.find(row => row.workerId === rate.workerId)?.dailyWage ?? ''" class="field-input min-w-0" :aria-label="`${rate.workerName || '工人'}兜底日薪`" type="number" min="0" step="any" :disabled="locked(rate.workerId)" @input="change(rate.workerId, 'dailyWage', ($event.target as HTMLInputElement).value)"><span class="text-ink-faint">空白表示未配置，0 为明确零价。</span></label>
        <label class="grid min-w-0 gap-1 text-12px">个人独立加班价（元/小时）<input :value="drafts.find(row => row.workerId === rate.workerId)?.overtimeRate ?? ''" class="field-input min-w-0" :aria-label="`${rate.workerName || '工人'}加班价`" type="number" min="0" step="any" :disabled="locked(rate.workerId)" @input="change(rate.workerId, 'overtimeRate', ($event.target as HTMLInputElement).value)"><span class="text-ink-faint">空白沿用有效日薪 ÷ 8；当前 {{ c1Number(rate.overtimeRate) }} 元/小时，{{ rate.overtimeRateSource === 'payroll-config' ? '来自独立配置' : rate.overtimeRateSource === 'daily-divided-eight' ? '按日薪默认' : '尚未提供' }}。</span></label>
      </div><p v-for="reason in workers.find(worker => worker.id === rate.workerId)?.reasons || []" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
    </article>
    <p v-if="!rates.length" class="panel p-4 text-13px">
      当前范围没有可配置的工人；请核对项目、月份与班组。
    </p>
  </section>
</template>
