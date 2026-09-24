<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAdjustmentLocation } from '~/lib/payroll/adjustment-navigation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ statementId: string, origin: 'real' | 'demo', returnTo: string }>()
const store = usePayrollAdjustmentsStore()
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([props.statementId, props.origin]), () => store.loadAdjustmentHistory({ origin: props.origin }, props.statementId))
const selected = shallowRef<string[]>([])
watch(() => props.statementId, () => selected.value = [])
const writable = computed(() => !!current.value && props.origin === 'real' && !current.value.context.readonly && current.value.context.capabilities.includes('payroll:write'))
function toggle(id: string, checked: boolean) {
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(value => value !== id)
}
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="原工资独立更正集合">
    <div class="flex flex-wrap justify-between gap-2">
      <SectionHeader title="更正与逐次处理" /><KitButton :disabled="loading" @click="load">
        刷新更正
      </KitButton>
    </div><p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p><template v-if="current && !error">
      <div v-if="writable" class="flex flex-wrap gap-2">
        <NuxtLink :to="{ path: '/subcontract/payroll/adjustments/new', query: { origin, statementId, returnTo } }" class="btn-secondary">
          发起独立核算更正
        </NuxtLink><NuxtLink v-if="selected.length" :to="{ path: '/subcontract/payroll/payments/new', query: { origin, adjustmentId: selected, returnTo } }" class="btn-primary">
          登记所选更正的实际补退
        </NuxtLink>
      </div><p v-if="!current.adjustments.length" class="text-12px text-ink-faint">
        原工资尚未登记独立更正。
      </p><div v-else tabindex="0" aria-label="原工资更正明细表" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-680px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                选择
              </th><th class="p-2">
                原因 / 详情
              </th><th class="p-2">
                状态
              </th><th class="p-2">
                本次差额
              </th><th class="p-2">
                当前待处理
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="row in current.adjustments" :key="row.adjustment.id" class="border-b border-line">
              <td class="p-2">
                <input v-if="writable && row.adjustment.status === 'confirmed' && row.balance.remainingDelta.value" type="checkbox" :checked="selected.includes(row.adjustment.id)" :aria-label="`选择更正${row.adjustment.draft.reason}`" @change="toggle(row.adjustment.id, ($event.target as HTMLInputElement).checked)">
              </td><td class="max-w-72 break-words p-2">
                <NuxtLink :to="payrollAdjustmentLocation(row.adjustment.id, origin, returnTo)" class="link-brand">
                  {{ row.adjustment.draft.reason || '未填写原因' }}
                </NuxtLink>
              </td><td class="p-2">
                {{ row.adjustment.status === 'confirmed' ? '已确认' : '草稿' }}
              </td><td class="p-2 font-mono">
                {{ payrollAmount(row.adjustment.delta) }}
              </td><td class="p-2 font-mono">
                {{ payrollAmount(row.balance.remainingDelta.value) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div><PayrollAdjustmentApplications :rows="current.applications" :origin="origin" :return-to="returnTo" />
    </template>
  </section>
</template>
