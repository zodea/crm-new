<script setup lang="ts">
import type { PayrollReleaseAdjustmentApplication } from '~/lib/payroll/central-release-adjustment-contract'
import { computed, watch } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAdjustmentLocation } from '~/lib/payroll/adjustment-navigation'
import { c2InputNumber } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ statementId: string, origin: 'real' | 'demo', sourceVersion: string, applications?: PayrollReleaseAdjustmentApplication[], disabled: boolean, returnTo: string }>()
const emit = defineEmits<{ change: [value: PayrollReleaseAdjustmentApplication[]], valid: [value: boolean] }>()
const store = usePayrollAdjustmentsStore()
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([props.statementId, props.origin, props.sourceVersion]), async () => {
  const read = await store.loadReleaseAdjustments({ origin: props.origin }, props.statementId)
  if (read.statementId !== props.statementId || read.context.origin !== props.origin)
    throw new Error('后续工资的更正处理来源不一致。')
  return read
})
const selected = computed(() => new Map((props.applications || []).map(row => [row.adjustmentId, row])))
const valid = computed(() => !!current.value && !loading.value && !error.value && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write') && (props.applications || []).every((row) => {
  const candidate = current.value!.candidates.find(item => item.adjustmentId === row.adjustmentId)
  return !!candidate?.eligible && candidate.balanceVersion === row.balanceVersion && candidate.coverageVersion === row.coverageVersion && candidate.remainingAmount !== null && row.amount * candidate.remainingAmount > 0 && Math.abs(row.amount) <= Math.abs(candidate.remainingAmount)
}))
watch(valid, value => emit('valid', value), { immediate: true })
function amount(id: string, raw: string) {
  if (props.disabled || !current.value)
    return
  const candidate = current.value.candidates.find(row => row.adjustmentId === id)
  if (!candidate?.eligible)
    return
  const next = (props.applications || []).filter(row => row.adjustmentId !== id)
  const value = c2InputNumber(raw)
  if (raw.trim() && value !== null)
    next.push({ adjustmentId: id, amount: value, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion })
  emit('change', next)
}
function adopt() {
  if (props.disabled || !current.value)
    return
  emit('change', (props.applications || []).map((row) => {
    const candidate = current.value!.candidates.find(item => item.adjustmentId === row.adjustmentId)
    return candidate ? { ...row, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion } : row
  }))
}
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="后续工资关联原更正">
    <div class="flex flex-wrap justify-between gap-2">
      <SectionHeader title="本次关联原更正" /><KitButton :disabled="disabled || loading" @click="load">
        重读待处理更正
      </KitButton>
    </div><p class="text-12px text-ink-soft">
      先在本页选择处理额，再确认真实发放。核减处理填负数、核增处理填正数；留空表示不关联。此关联仅在工资真实发放成功后生效。
    </p><p v-if="loading" role="status" class="text-12px">
      正在核对剩余与核算包含范围…
    </p><p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p><template v-if="current">
      <p v-if="!current.candidates.length" class="text-12px text-ink-faint">
        当前没有可关联的原更正。
      </p><div v-else tabindex="0" aria-label="后续工资更正处理选择表" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-850px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                原更正 / 月份
              </th><th class="p-2">
                待处理
              </th><th class="p-2">
                已包含在本次核算
              </th><th class="p-2">
                全部处理时额外少发
              </th><th class="p-2">
                本次处理差额
              </th><th class="p-2">
                资格
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="row in current.candidates" :key="row.adjustmentId" class="border-b border-line">
              <td class="p-2">
                <NuxtLink :to="payrollAdjustmentLocation(row.adjustmentId, origin, returnTo)" class="link-brand">
                  {{ row.originalMonth }} 更正
                </NuxtLink>
              </td><td class="p-2 font-mono">
                {{ payrollAmount(row.remainingAmount) }}
              </td><td class="p-2 font-mono">
                {{ payrollAmount(row.embeddedInCalculation) }}
              </td><td class="p-2 font-mono">
                {{ payrollAmount(row.additionalWithholding) }}
              </td><td class="p-2">
                <input :value="selected.get(row.adjustmentId)?.amount ?? ''" :aria-label="`${row.originalMonth}更正本次处理差额`" type="number" step="0.01" class="field-input w-36" :disabled="disabled || !row.eligible || loading" @input="amount(row.adjustmentId, ($event.target as HTMLInputElement).value)">
              </td><td class="max-w-56 break-words p-2">
                {{ row.reasons.join('；') || '可以关联' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div><p v-for="reason in current.reasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p><template v-if="applications?.length && !valid">
        <p role="alert" class="text-12px text-warn">
          当前读取与已选处理依据不一致，请核对余额后明确重新采用。原金额不会自动改写。
        </p><KitButton class="w-fit" :disabled="disabled || loading" @click="adopt">
          保留金额并采用当前处理依据
        </KitButton>
      </template>
    </template>
  </section>
</template>
