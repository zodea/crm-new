<script setup lang="ts">
import PayrollActualFactsTable from '~/components/payroll/PayrollActualFactsTable.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const props = defineProps<{ projectId: string, originalStatementId?: string, origin?: 'real' | 'demo', returnTo: string }>()
const store = usePayrollAdjustmentsStore()
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([props.projectId, props.originalStatementId, props.origin]), async () => {
  if (props.origin === 'demo')
    throw new Error('当前来源不提供正式工资实际收付，请阅读原工资历史。')
  if (!isStableRouteIdentity(props.projectId))
    throw new Error('请选择明确项目后读取工资实际收付。')
  if (props.originalStatementId && !isStableRouteIdentity(props.originalStatementId))
    throw new Error('原工资身份无效。')
  const read = await store.loadActualLedger({ origin: 'real' }, { projectId: props.projectId, ...(props.originalStatementId ? { originalStatementIds: [props.originalStatementId] } : {}) })
  if (read.scope.projectId !== props.projectId || read.context.origin !== 'real')
    throw new Error('工资收付范围与当前项目不一致。')
  return read
})
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="工资实际收付">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <SectionHeader title="工资实际收付" /><KitButton :disabled="loading" @click="load">
        刷新工资收付
      </KitButton>
    </div><p class="text-12px text-ink-soft">
      工资原发放、真实补退及有效错记冲销同源读取。核算更正与后续处理关联不另计现金。
    </p><p v-if="loading" role="status" class="text-12px">
      正在核对工资实际收付…
    </p><p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p><template v-if="current && !error">
      <p class="text-13px">
        工资有效实际净额：<strong class="font-mono">{{ payrollAmount(current.netAmount.value) }}</strong><span v-if="current.status !== 'complete'" class="ml-2 text-warn">{{ current.status === 'partial' ? '资料部分完整' : current.status === 'forbidden' ? '无权读取' : '暂不可用' }}</span>
      </p><p v-for="reason in current.netAmount.reasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p><PayrollActualFactsTable :rows="current.rows" :origin="origin || 'real'" :return-to="returnTo" :writable="!current.context.readonly && current.context.capabilities.includes('payroll:write')" />
    </template>
  </section>
</template>
