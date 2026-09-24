<script setup lang="ts">
import type { PayrollHostSection } from '~/lib/crew-worker/payroll-read'
import type { PayrollSignedAmount } from '~/lib/payroll/central-actual-contract'
import { computed } from 'vue'
import { payrollActualLocation } from '~/lib/payroll/adjustment-navigation'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ section: PayrollHostSection, returnTo: string }>()
const emit = defineEmits<{ retry: [] }>()
const personal = computed(() => props.section.scope.kind === 'worker')
const unavailable = computed(() => props.section.status === 'forbidden' || props.section.status === 'unavailable')
const labels = { 'initial-release': '原工资实发', 'supplement': '实际补发', 'refund': '实际退款', 'recording-reversal': '错记冲销' }
function amount(value: PayrollSignedAmount) {
  return value.value !== null ? yuan(value.value) : value.knownValue !== null ? `待完整核对（已知 ${yuan(value.knownValue)}）` : '尚不能确认'
}
const rows = computed(() => props.section.rows.map(row => ({
  ...row,
  label: labels[row.fact.kind],
  to: payrollActualLocation(row.fact.ref, 'real', props.returnTo),
  amount: amount(row.scopedAmount),
  fullAmount: amount(row.fact.signedAmount),
  names: row.fact.historicalMembers.filter(member => !personal.value || member.workerId === props.section.scope.id).map(member => member.name ?? '原姓名未记录').join('、'),
})))
</script>

<template>
  <section id="payroll-actual-section" class="panel min-w-0 overflow-hidden" aria-label="工资实际收付" data-testid="payroll-host-section">
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-3 p-4">
      <div class="min-w-0 flex-1">
        <SectionHeader title="工资实际收付" subtitle="原工资、实际补发、实际退款与错记冲销分别留证；核算更正及后月处理关系不重复计现金" />
        <p class="mb-0 mt-2 text-12px leading-5 text-ink-soft">
          {{ personal ? '个人金额只取原实际分配；分配未记录时保持未知。' : '每个稳定工资收付来源只计一次；个人分配只解释同一金额。' }}
          原工资及其签名金额保持原样，后来转组或姓名变化不改写历史。
        </p>
      </div>
      <div v-if="!unavailable" class="max-w-full text-right">
        <span class="block text-11px text-ink-soft">{{ personal ? '个人实际净额' : '工资实际净额' }}</span>
        <strong class="mt-1 block break-words text-18px text-brand-deep" data-testid="payroll-host-net">{{ amount(section.netAmount) }}</strong>
      </div>
    </div>
    <div v-if="unavailable" role="status" class="border-t border-line p-4 text-13px text-ink-soft">
      <p class="m-0">
        {{ section.status === 'forbidden' ? '当前无权查看工资收付。' : '工资收付暂时不可用，金额保持未知。' }}
      </p>
      <button v-if="section.status === 'unavailable'" type="button" class="btn-secondary mt-3" @click="emit('retry')">
        重新读取
      </button>
    </div>
    <template v-else>
      <p v-if="section.reasons.length" role="status" class="m-0 border-t border-line bg-warn-soft px-4 py-3 text-12px leading-5 text-warn-ink">
        {{ section.reasons.join('；') }}
      </p>
      <div class="max-w-full overflow-x-auto" tabindex="0" role="region" aria-label="工资实际收付明细，可横向滚动">
        <table class="w-full min-w-860px text-left text-12px">
          <thead class="bg-surface-2 text-ink-soft">
            <tr>
              <th class="p-3">
                日期与类型
              </th><th class="p-3">
                原项目 / 原工资
              </th><th class="p-3">
                {{ personal ? '原成员' : '原成员与分配' }}
              </th><th class="p-3">
                {{ personal ? '个人实际额' : '本次实际额' }}
              </th><th class="p-3">
                {{ personal ? '整笔实际额（参考）' : '分配完整度' }}
              </th><th class="p-3">
                来源
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.fact.identity" class="border-t border-line">
              <td class="p-3">
                <span class="block">{{ row.fact.occurredOn ?? '原日期未记录' }}</span><span class="mt-1 block text-ink-soft">{{ row.label }}</span>
              </td>
              <td class="max-w-64 break-words p-3">
                <span class="block">{{ row.fact.projectId }}</span><span class="mt-1 block text-11px text-ink-soft">{{ row.fact.originalStatementIds.join('、') }}</span>
              </td>
              <td class="max-w-64 break-words p-3">
                {{ row.names || '原成员未完整记录' }}
              </td>
              <td class="max-w-64 break-words p-3 font-mono font-700">
                {{ row.amount }}
              </td>
              <td class="max-w-64 break-words p-3">
                <span v-if="personal">{{ row.fullAmount }}</span><span v-else>{{ row.fact.allocationState === 'complete' ? '完整分配已记录' : row.fact.allocationState === 'partial' ? '仅部分个人分配可证' : '个人分配未完整记录' }}</span>
              </td>
              <td class="p-3">
                <NuxtLink :to="row.to" class="text-brand underline underline-offset-3">
                  {{ row.fact.kind === 'initial-release' ? '原工资与签名' : '本次收付依据' }}
                </NuxtLink>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="6" class="p-6 text-center text-ink-soft">
                尚无已登记的工资实际收付
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
