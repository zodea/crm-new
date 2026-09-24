<script setup lang="ts">
import type { PayrollOriginalWageRef } from '~/lib/payroll/central-adjustment-contract'
import { payrollAmount } from '~/lib/payroll/read-presentation'

defineProps<{ original: PayrollOriginalWageRef, returnTo?: string, sectionId?: string }>()
</script>

<template>
  <section :id="sectionId" class="panel grid min-w-0 gap-3 p-4" aria-label="原签名工资事实">
    <SectionHeader title="原签名工资事实" />
    <dl class="grid grid-cols-1 gap-3 text-12px sm:grid-cols-2">
      <div>
        <dt class="text-ink-faint">
          项目 / 月份 / 格式
        </dt><dd class="mt-1 break-words">
          {{ original.projectName || '项目名称未记录' }} · {{ original.month }} · {{ original.formatFamily }}
        </dd>
      </div>
      <div>
        <dt class="text-ink-faint">
          原负责人
        </dt><dd class="mt-1 break-words">
          {{ original.members.find(member => member.workerId === original.leaderWorkerId)?.workerName || '姓名未记录' }}
        </dd>
      </div>
      <div>
        <dt class="text-ink-faint">
          原核算金额
        </dt><dd class="mt-1 font-mono">
          {{ payrollAmount(original.originalGrossAmount.value) }}
        </dd>
      </div>
      <div>
        <dt class="text-ink-faint">
          原签名实发金额
        </dt><dd class="mt-1 font-mono font-700">
          {{ payrollAmount(original.originalSignatureAmount.value) }}
        </dd>
      </div>
    </dl>
    <p class="text-12px text-ink-soft">
      原签名金额与原成员保留。核算更正、实际补退和错记冲销分别形成独立记录。
    </p>
    <NuxtLink :to="{ path: `/subcontract/payroll/${encodeURIComponent(original.statementId)}`, query: { origin: 'real', ...(returnTo ? { returnTo } : {}) } }" class="link-brand w-fit text-12px">
      查看原工资与冻结输出
    </NuxtLink>
  </section>
</template>
