<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollActualLocation, payrollActualRefQuery, payrollAdjustmentLocation, payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollActualConfirmation } from '~/lib/payroll/adjustment-output'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const route = useRoute()
const store = usePayrollAdjustmentsStore()
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { current, loading, error, active, load } = usePayrollRead(() => JSON.stringify([id.value, route.query.origin]), async () => {
  if (!isStableRouteIdentity(id.value) || (route.query.origin != null && route.query.origin !== 'real'))
    throw new Error('请从正式工资收付记录打开有效来源。')
  const read = await store.loadActualPaymentDetail({ origin: 'real' }, id.value)
  if (read.fact.ref.kind !== 'actual-event' || read.fact.ref.eventId !== id.value || read.context.origin !== 'real')
    throw new Error('原收付记录身份不一致。')
  return read
})
const back = computed(() => payrollAdjustmentReturn(route.query.returnTo, 'real') || '/subcontract/payroll/payments?origin=real')
const document = computed(() => current.value ? payrollActualConfirmation(current.value) : null)
const title = computed(() => current.value?.fact.kind === 'recording-reversal' ? '工资错记冲销详情' : current.value?.fact.kind === 'refund' ? '工资实际退款详情' : '工资实际补发详情')
useTabTitle(title)
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap justify-between gap-3">
      <h1 class="text-20px font-800">
        {{ title }}
      </h1><div class="flex gap-2">
        <NuxtLink :to="back" class="btn-secondary">
          返回来源
        </NuxtLink><KitButton :disabled="loading" @click="load">
          刷新
        </KitButton>
      </div>
    </header><p v-if="loading" role="status" class="text-12px">
      正在读取原确认事实…
    </p><p v-if="error" role="alert" class="panel p-4 text-danger">
      {{ error }}
    </p><template v-if="current && !error">
      <PayrollOriginalWageSummary v-for="(original, originalIndex) in current.snapshot.originals" :key="original.statementId" :section-id="originalIndex === 0 ? 'section-original' : undefined" :original="original" :return-to="route.fullPath" /><section class="panel grid min-w-0 gap-3 p-4">
        <SectionHeader title="本次已确认事实" /><PayrollActualFactsTable :rows="[current.fact]" origin="real" :return-to="route.fullPath" /><p class="whitespace-pre-wrap break-words text-12px">
          核对依据：{{ current.snapshot.draft.evidenceNote }}
        </p><p class="text-12px">
          确认人：{{ current.snapshot.confirmedBy }} · {{ current.snapshot.confirmedAt }}
        </p><div class="flex flex-wrap gap-2">
          <NuxtLink v-if="'originalFact' in current.snapshot" :to="payrollActualLocation(current.snapshot.originalFact.ref, 'real', route.fullPath)" class="btn-secondary">
            查看本次冲销引用的原记录
          </NuxtLink><NuxtLink v-for="adjustmentId in current.fact.adjustmentIds" :key="adjustmentId" :to="payrollAdjustmentLocation(adjustmentId, 'real', route.fullPath)" class="btn-secondary">
            查看关联更正
          </NuxtLink><NuxtLink v-if="current.fact.qualification === 'proven' && !current.context.readonly && current.context.capabilities.includes('payroll:write')" :to="{ path: '/subcontract/payroll/payments/reversal/new', query: { origin: 'real', ...payrollActualRefQuery(current.fact.ref), returnTo: route.fullPath } }" class="btn-secondary">
            {{ current.fact.kind === 'recording-reversal' ? '纠正这次错记冲销' : '核实错记冲销' }}
          </NuxtLink>
        </div>
      </section><PayrollConfirmationOutput :document="document" :active="active" />
    </template>
  </main>
</template>
