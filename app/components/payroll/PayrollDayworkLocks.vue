<script setup lang="ts">
import type { PayrollSourceExclusion } from '~/lib/payroll/central-attendance-contract'
import type { PayrollParticipantOption } from '~/lib/payroll/central-contract'

defineProps<{ locks: PayrollSourceExclusion[], workers: PayrollParticipantOption[] }>()
</script>

<template>
  <section v-if="locks.length" class="panel grid gap-3 p-4" aria-label="签工与工资月份占用">
    <SectionHeader title="人员与月份占用" />
    <p class="text-12px leading-5 text-ink-soft">
      真实已发工资按原全部成员保留整月占用，零收款或无签工成员也包含在内。旧来源证据缺项不解除已经确认的占用。
    </p>
    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="(lock, index) in locks" :key="index" class="rounded border border-line p-3 text-12px">
        <p class="font-700">
          {{ workers.find(worker => worker.id === lock.workerId)?.name || '原工人姓名未记录' }} · {{ lock.month }}
        </p><p class="mt-1">
          {{ lock.formatFamily }} · {{ lock.kind === 'released-month' ? '已发工资整月锁定' : lock.kind === 'format-exclusion' ? '原工资格式占用' : '原签工占用' }}
        </p><details class="mt-2">
          <summary>原记录身份</summary><p class="mt-1 break-all">
            工人：{{ lock.workerId }}<br>工资：{{ lock.statementId || '未记录' }}<br>来源：{{ lock.dayworkRecordId || lock.attendanceRecordId || lock.evidenceId || '按月份保存' }}
          </p>
        </details>
      </li>
    </ul>
  </section>
</template>
