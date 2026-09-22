<script setup lang="ts">
import type { PayrollAConfigRead, PayrollAPriceDraft } from '~/lib/payroll/central-a-contract'
import { computed } from 'vue'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'

const props = defineProps<{ draft: PayrollAPriceDraft, read: PayrollAConfigRead, disabled: boolean, identityLocked?: boolean }>()
const emit = defineEmits<{ patch: [value: Partial<PayrollAPriceDraft>], remove: [] }>()
const selection = computed(() => props.read.priceOptions.findIndex(item => item.itemId === props.draft.itemId && item.unit === props.draft.unit))
const scopes = computed(() => props.read.priceOptions[selection.value]?.scopes ?? [])
const scopeIndex = computed(() => scopes.value.findIndex(scope => JSON.stringify(scope) === JSON.stringify(props.draft.scope)))
function item(value: string) {
  const option = props.read.priceOptions[Number(value)]
  if (value === '' || !option)
    return
  emit('patch', { itemId: option.itemId, unit: option.unit, scope: option.scopes.find(scope => scope.kind === 'project') ?? { kind: 'cells', cells: [] } })
}
</script>

<template>
  <div class="grid min-w-0 grid-cols-1 gap-3 rounded border border-line p-3" aria-label="待保存工资单价">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-12px font-700">
        {{ draft.priceId ? '修订单价' : '新增工资单价' }}
      </p><KitButton type="button" variant="ghost" :disabled="disabled" @click="emit('remove')">
        移除未保存项
      </KitButton>
    </div>
    <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="grid min-w-0 gap-1 text-12px">分项及单位<select :value="selection === -1 ? '' : String(selection)" class="field-input min-w-0 w-full" aria-label="单价分项及单位" :disabled="disabled || identityLocked || !!draft.priceId" @change="item(($event.target as HTMLSelectElement).value)"><option value="">请选择稳定分项</option><option v-for="(option, index) in read.priceOptions" :key="`${option.itemId}-${option.unit}`" :value="String(index)">{{ option.itemName || '名称未记录' }} · {{ option.unit || '单位未记录' }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">调整方式<select :value="draft.mode" class="field-input min-w-0 w-full" aria-label="单价调整方式" :disabled="disabled || !!draft.priceId" @change="emit('patch', { mode: ($event.target as HTMLSelectElement).value === 'worker-exception' ? 'worker-exception' : 'baseline', workerId: null })"><option value="baseline">统一改 · 当前负责人基准价</option><option value="worker-exception">单独改 · 个人例外</option></select></label>
      <label v-if="draft.mode === 'worker-exception'" class="grid min-w-0 gap-1 text-12px">适用工人<select :value="draft.workerId || ''" class="field-input min-w-0 w-full" aria-label="单独调价工人" :disabled="disabled || identityLocked || !!draft.priceId" @change="emit('patch', { workerId: ($event.target as HTMLSelectElement).value || null })"><option value="">请选择工人</option><option v-for="worker in read.options.workers" :key="worker.id" :value="worker.id" :disabled="!worker.eligible">{{ worker.name || '姓名未记录' }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">生效月份<input :value="draft.effectiveMonth" type="month" class="field-input min-w-0 w-full" aria-label="单价生效月份" :disabled="disabled" @input="emit('patch', { effectiveMonth: ($event.target as HTMLInputElement).value })"></label>
      <label class="grid min-w-0 gap-1 text-12px">工资单价<input :value="draft.unitPrice ?? ''" type="number" step="0.01" min="0" class="field-input min-w-0 w-full" aria-label="工资单价金额" :disabled="disabled" @input="emit('patch', { unitPrice: payrollInputNumber(($event.target as HTMLInputElement).value) })"></label>
      <label class="grid min-w-0 gap-1 text-12px">适用工作范围<select :value="scopeIndex === -1 ? '' : String(scopeIndex)" class="field-input min-w-0 w-full" aria-label="工资单价范围" :disabled="disabled || identityLocked || !!draft.priceId" @change="scopes[Number(($event.target as HTMLSelectElement).value)] && emit('patch', { scope: scopes[Number(($event.target as HTMLSelectElement).value)]! })"><option value="" disabled>请选择明确范围</option><option v-for="(scope, index) in scopes" :key="index" :value="String(index)">{{ scope.kind === 'project' ? '当前项目内该负责人适用分项' : `指定 ${scope.cells.length} 个户内位置` }}</option></select></label>
    </div>
    <p class="text-11px leading-5 text-ink-faint">
      空白表示尚未配置；明确填写 0 会保留零单价。修改从所选月份影响未发工资，已发快照保持原记录。
    </p>
  </div>
</template>
