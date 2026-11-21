<script setup lang="ts">
import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import { yuan } from '~/lib/util/money'

defineProps<{
  data: ProjectSupplierWorkbenchReadDTO
  refreshing: boolean
}>()

defineEmits<{ refresh: [] }>()

const STATUS_LABEL: Record<string, string> = {
  collecting: '资料收集中',
  contracted: '已签合同',
  claiming: '请款中',
  paid: '已付款',
  settled: '已结算',
}
</script>

<template>
  <header class="panel overflow-hidden" data-testid="project-supplier-header">
    <div class="flex flex-wrap items-start gap-4 border-b border-line bg-surface-2 px-4 py-4">
      <div class="min-w-0 flex-1">
        <p class="m-0 text-11px font-700 tracking-wide text-ink-faint">
          项目 × 分供方事实工作台
        </p>
        <h1 class="m-0 mt-1 truncate text-20px font-800 text-ink">
          {{ data.project.label }} × {{ data.supplier.label }}
        </h1>
        <p class="m-0 mt-1 text-11px text-ink-soft">
          关系 {{ data.relation.id }} · {{ STATUS_LABEL[data.relation.status] || data.relation.status || '未记录状态' }}
        </p>
      </div>
      <KitButton variant="secondary" :disabled="refreshing" @click="$emit('refresh')">
        <span class="i-lucide-refresh-cw mr-1" :class="refreshing ? 'animate-spin' : ''" aria-hidden="true" />
        刷新
      </KitButton>
    </div>
    <dl class="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-7">
      <div
        v-for="metric in [
          ['变更后合同额', data.summary.contractTotal],
          ['已审批请款', data.summary.claimedTotal],
          ['已归档收票', data.summary.invoiceTotal],
          ['收票税额', data.summary.taxTotal],
          ['已确认支付', data.summary.paidTotal],
          ['已确认结算', data.summary.settlementTotal],
          ['应付余额', data.summary.balance],
        ]" :key="metric[0]" class="bg-surface px-3 py-3"
      >
        <dt class="text-10px text-ink-faint">
          {{ metric[0] }}
        </dt>
        <dd class="m-0 mt-1 whitespace-nowrap font-mono text-13px font-700 tabular-nums text-ink">
          {{ yuan(metric[1]) }}
        </dd>
        <dd v-if="metric[1] === null" class="m-0 mt-1 text-10px text-ink-faint">
          含未填写或待核验批复，合计不完整
        </dd>
      </div>
    </dl>
  </header>
</template>
