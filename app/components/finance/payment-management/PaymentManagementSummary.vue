<script setup lang="ts">
import type { PaymentManagementSummary } from '~/stores/payment-management'

defineProps<{
  summary: PaymentManagementSummary
}>()
</script>

<template>
  <MetricGrid :cols="5" aria-label="付款管理汇总">
    <Metric
      label="已批复申请"
      :value="`${summary.applicationCount} 笔`"
      formula="当前筛选范围内的已批复付款申请数量"
    />
    <Metric
      label="批复金额"
      :value="summary.approvedAmount ?? '—'"
      :status="summary.approvedAmount === null ? '含未填写或待核验批复，合计不完整' : ''"
      money
      formula="Σ 付款申请.批复金额"
    />
    <Metric
      label="已支付"
      :value="summary.paidAmount ?? '—'"
      :status="summary.paidAmount === null ? '已支付金额尚未完整核实' : ''"
      money
      tone="ok"
      formula="Σ 已确认支付记录的申请分摊金额"
    />
    <Metric
      label="应付余额"
      :value="summary.dueAmount ?? '—'"
      :status="summary.dueAmount === null ? '含历史待核验批复，余额合计不完整' : ''"
      money
      tone="danger"
      formula="Σ max(批复金额（未填时取申请金额）− 已确认支付分摊, 0)；历史未知不计为零"
    />
    <Metric
      label="待支付笔数"
      :value="summary.dueCount === null ? '—' : `${summary.dueCount} 笔`"
      :status="summary.dueCount === null ? '含历史待核验批复，笔数不完整' : ''"
      tone="brand"
      formula="应付余额大于 0 的申请数量"
    />
  </MetricGrid>
</template>
