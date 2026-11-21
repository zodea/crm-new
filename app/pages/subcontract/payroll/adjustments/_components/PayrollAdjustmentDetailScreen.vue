<script setup lang="ts">
import { computed } from 'vue'
import PayrollAdjustmentApplications from '~/components/payroll/PayrollAdjustmentApplications.vue'
import PayrollAdjustmentBasisFields from '~/components/payroll/PayrollAdjustmentBasisFields.vue'
import PayrollConfirmationOutput from '~/components/payroll/PayrollConfirmationOutput.vue'
import PayrollOriginalWageSummary from '~/components/payroll/PayrollOriginalWageSummary.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAdjustmentLocation, payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollAdjustmentConfirmation } from '~/lib/payroll/adjustment-output'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const route = useRoute()
const store = usePayrollAdjustmentsStore()
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { current, loading, error, active, load } = usePayrollRead(() => JSON.stringify([id.value, route.query.origin]), async () => {
  if (!isStableRouteIdentity(id.value) || (route.query.origin != null && route.query.origin !== 'real'))
    throw new Error('请从正式工资打开有效更正记录。')
  const value = await store.loadAdjustmentDetail({ origin: 'real' }, id.value)
  if (value.adjustment.id !== id.value || value.context.origin !== 'real')
    throw new Error('更正身份与当前目标不一致。')
  return value
})
const back = computed(() => payrollAdjustmentReturn(route.query.returnTo, 'real') || '/subcontract/payroll?origin=real')
const writable = computed(() => !!current.value && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write'))
const document = computed(() => current.value ? payrollAdjustmentConfirmation(current.value) : null)
const payment = computed(() => ({ path: '/subcontract/payroll/payments/new', query: { origin: 'real', adjustmentId: id.value, returnTo: route.fullPath } }))
useTabTitle('工资更正详情')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <h1 class="text-20px font-800">
        工资更正详情
      </h1><div class="flex flex-wrap gap-2">
        <NuxtLink :to="back" class="btn-secondary">
          返回来源
        </NuxtLink><KitButton :disabled="loading" @click="load">
          刷新
        </KitButton>
      </div>
    </header>
    <p v-if="loading" role="status" class="text-12px">
      正在读取更正确认与当前处理…
    </p>
    <p v-if="error" role="alert" class="panel p-4 text-danger">
      {{ error }}
    </p>
    <template v-if="current && !error">
      <PayrollOriginalWageSummary section-id="section-original" :original="current.original" :return-to="route.fullPath" />
      <section v-if="current.adjustment.snapshot" class="panel grid min-w-0 gap-3 p-4" aria-label="本次更正确认">
        <SectionHeader title="本次已确认核算更正" />
        <p class="break-words text-13px">
          {{ current.adjustment.snapshot.reason }}
        </p>
        <p class="whitespace-pre-wrap break-words text-12px text-ink-soft">
          {{ current.adjustment.snapshot.evidenceNote }}
        </p>
        <dl class="grid grid-cols-1 gap-3 text-12px sm:grid-cols-2">
          <div>
            <dt>本次更正前核算</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(current.adjustment.snapshot.preview.beforeAmount.value) }}
            </dd>
          </div>
          <div>
            <dt>本次更正后核算</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(current.adjustment.snapshot.preview.afterAmount.value) }}
            </dd>
          </div>
          <div>
            <dt>本次确认差额</dt><dd class="mt-1 font-mono font-700">
              {{ payrollAmount(current.adjustment.snapshot.preview.delta.value) }}
            </dd>
          </div>
          <div>
            <dt>原确认人</dt><dd class="mt-1 break-words">
              {{ current.adjustment.snapshot.confirmedBy }}
            </dd>
          </div>
          <div>
            <dt>原确认时间</dt><dd class="mt-1">
              {{ current.adjustment.snapshot.confirmedAt }}
            </dd>
          </div>
        </dl>
        <NuxtLink v-if="current.adjustment.snapshot.correctsAdjustmentId" :to="payrollAdjustmentLocation(current.adjustment.snapshot.correctsAdjustmentId, 'real', route.fullPath)" class="link-brand w-fit text-12px">
          查看本次纠正的前序更正
        </NuxtLink>
        <details class="min-w-0">
          <summary class="cursor-pointer text-12px text-brand">
            查看本次更正前依据
          </summary><PayrollAdjustmentBasisFields :basis="current.adjustment.snapshot.preview.before" :original="current.adjustment.snapshot.original" disabled />
        </details>
        <details class="min-w-0">
          <summary class="cursor-pointer text-12px text-brand">
            查看本次采用依据
          </summary><PayrollAdjustmentBasisFields :basis="current.adjustment.snapshot.preview.after" :original="current.adjustment.snapshot.original" disabled />
        </details>
      </section>
      <section v-else class="panel grid gap-3 p-4" aria-label="独立更正草稿">
        <SectionHeader title="独立更正草稿" /><p class="break-words text-13px">
          {{ current.adjustment.draft.reason || '原因尚未填写' }}
        </p><p class="whitespace-pre-wrap break-words text-12px text-ink-soft">
          {{ current.adjustment.draft.evidenceNote || '依据尚未填写' }}
        </p>
      </section>
      <section class="panel grid gap-3 p-4" aria-label="原更正链当前余额">
        <SectionHeader title="原更正链当前余额" />
        <p class="text-12px text-ink-soft">
          包含原更正及后来追加的确认与处理；本次确认事实保留在上方。
        </p>
        <dl class="grid grid-cols-1 gap-3 text-12px sm:grid-cols-3">
          <div>
            <dt>当前已确认差额</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(current.balance.confirmedDelta.value) }}
            </dd>
          </div>
          <div>
            <dt>已处理差额</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(current.balance.appliedDelta.value) }}
            </dd>
          </div>
          <div>
            <dt>待处理差额</dt><dd class="mt-1 font-mono font-700">
              {{ payrollAmount(current.balance.remainingDelta.value) }}
            </dd>
          </div>
        </dl>
        <div v-if="writable" class="flex flex-wrap gap-2">
          <NuxtLink v-if="current.adjustment.status === 'draft'" :to="payrollAdjustmentLocation(id, 'real', route.fullPath, true)" class="btn-primary">
            编辑并确认更正
          </NuxtLink>
          <template v-else>
            <NuxtLink v-if="current.balance.remainingDelta.value" :to="payment" class="btn-primary">
              登记实际补发或退款
            </NuxtLink>
            <NuxtLink :to="{ path: '/subcontract/payroll/adjustments/new', query: { origin: 'real', statementId: current.original.statementId, correctsAdjustmentId: id, returnTo: route.fullPath } }" class="btn-secondary">
              追加有依据的纠错
            </NuxtLink>
            <NuxtLink :to="{ path: '/subcontract/payroll', query: { origin: 'real', project: current.original.projectId, crew: current.original.crewId || '', returnTo: route.fullPath } }" class="btn-secondary">
              到后续工资关联处理
            </NuxtLink>
          </template>
        </div>
        <p class="text-12px text-ink-soft">
          尚待处理时，原实际收付不变。后续工资只在真实发放成功后处理原余额。
        </p>
      </section>
      <PayrollAdjustmentApplications :rows="current.applications" origin="real" :return-to="route.fullPath" />
      <PayrollConfirmationOutput :document="document" :active="active" />
    </template>
  </main>
</template>
