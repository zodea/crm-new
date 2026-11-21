<script setup lang="ts">
import { computed } from 'vue'
import CentralC1DraftFormPage from '~/components/payroll/CentralC1DraftFormPage.vue'
import CentralC2DraftFormPage from '~/components/payroll/CentralC2DraftFormPage.vue'
import CentralPayrollDraftFormPage from '~/components/payroll/CentralPayrollDraftFormPage.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollViewScope } from '~/lib/payroll/central-navigation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const route = useRoute()
const store = usePayrollStatementDetailStore()
const scope = computed(() => payrollViewScope(route.query))
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
const { current, error, loading } = usePayrollRead(() => JSON.stringify([id.value, scope.value.origin]), async () => {
  if (!scope.value.origin || scope.value.error)
    throw new Error(scope.value.error || '工资来源无效')
  if (!id.value)
    return { context: { workspaceId: '', actorId: '', origin: scope.value.origin }, format: null }
  if (!isStableRouteIdentity(id.value))
    throw new Error('工资身份无效')
  const detail = await store.loadRead({ origin: scope.value.origin }, id.value)
  if (detail.statement.id !== id.value || detail.context.origin !== scope.value.origin)
    throw new Error('工资身份与来源不一致')
  return { context: detail.context, format: detail.statement.formatFamily }
})
const format = computed(() => id.value ? current.value?.format : route.query.format ?? 'A')
</script>

<template>
  <p v-if="loading && id" role="status">
    正在核对工资格式…
  </p><section v-else-if="error" class="panel p-4 text-danger" role="alert">
    {{ error }}
  </section><CentralC2DraftFormPage v-else-if="format === 'C2'" /><CentralC1DraftFormPage v-else-if="format === 'C1'" /><CentralPayrollDraftFormPage v-else-if="format === 'A'" /><section v-else class="panel p-4 text-warn" role="status">
    该工资格式目前只支持原资料查看，请从台账打开其历史详情。
  </section>
</template>
