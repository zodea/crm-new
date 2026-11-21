<script setup lang="ts">
import type { OtherSettlementFact } from '~/lib/other-settlement/contract'
import { auxiliaryProblem } from '~/lib/auxiliary-contract/contract'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { financeStatusLabel } from '~/lib/finance/status'

const props = defineProps<{
  fact: OtherSettlementFact
  facts: OtherSettlementFact[]
}>()
const emit = defineEmits<{
  close: [
  ]
  select: [
        fact: OtherSettlementFact,
  ]
}>()
const repository = useNuxtApp().$repositories.otherSettlements
const route = useRoute()
const { data: document, problem, shellState, load } = useAuxiliaryContractRead(async () => {
  const source = await repository.source(props.fact.settlementId, props.fact.id)
  if (source.id !== props.fact.sourceId || source.kind !== props.fact.kind)
    throw auxiliaryProblem('relationship-mismatch', '返回源单与选择的稳定身份不一致')
  return source
})
const parent = computed(() => props.facts.find(f => f.kind === 'application' && f.sourceId === props.fact.parentId))
const payments = computed(() => props.facts.filter(f => f.kind === 'payment' && f.parentId === props.fact.sourceId))
const title = computed(() => ({ penalty: '项目罚扣', application: '付款申请', payment: '支付记录' })[props.fact.kind])
watch(() => `${props.fact.settlementId}:${props.fact.id}`, load, { immediate: true })
</script>

<template>
  <section class="mt-4 min-w-0 rounded border border-line bg-surface-2 p-4 text-13px" aria-label="源单只读详情">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-14px">
        {{ title }} · {{ document?.name || '读取中' }}
      </h3>
      <KitButton @click="emit('close')">
        {{ route.query.sourceTrail ? '返回来源单据' : '返回关联列表' }}
      </KitButton>
    </div>
    <StatePanel v-if="shellState !== 'ready'" :kind="shellState === 'loading' ? 'loading' : 'error'" :title="problem?.message || '正在读取源单'" :action-label="problem?.retryable ? '重新加载源单' : ''" compact @action="load" />
    <template v-else-if="document">
      <dl class="grid min-w-0 gap-3 break-words md:grid-cols-2">
        <div>单号：{{ document.no || '未记录' }}</div><div>状态：{{ ({ pending: '待处理', repairing: '整改中', repaired_self: '自行整改完成', repaired_other: '委托整改完成', deducted: '已抵扣', paying: '支付中' } as Record<string, string>)[document.status] || financeStatusLabel(document.status) }}</div>
        <div>源单总金额：{{ auxiliaryMoney(document.amount) }}</div><div>业务日期：{{ document.date || '未记录' }}</div>
        <div v-for="field in document.fields" :key="field.label">
          {{ field.label }}：{{ field.value || '未记录' }}
        </div>
      </dl>
      <div class="my-3 flex flex-wrap gap-3">
        <KitButton v-if="parent" @click="emit('select', parent)">
          查看来源付款申请
        </KitButton>
        <span v-else-if="fact.parentId" class="text-ink-soft">来源申请不在当前结算的有效关系中，无法进入。</span>
        <KitButton v-for="payment in payments" :key="payment.id" @click="emit('select', payment)">
          查看支付：{{ payment.no || payment.name }}
        </KitButton>
      </div>
      <p class="text-ink-soft">
        本结算关联金额：{{ auxiliaryMoney(fact.attribution === 'exact' ? fact.amount : null) }}。{{ fact.attribution === 'unknown' ? '支付关联多个结算且缺少结算级分摊，不能按比例猜接。' : '按真实分配记录关联。' }}
      </p>
      <div v-if="document.allocations.length" role="region" aria-label="源单分配记录" tabindex="0" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-100 text-left">
          <thead><tr><th>分配对象</th><th>金额</th><th>有效状态</th></tr></thead>
          <tbody>
            <tr v-for="allocation in document.allocations" :key="allocation.id">
              <td>{{ allocation.targetId === fact.settlementId ? '当前结算' : allocation.targetId === fact.parentId ? '来源付款申请' : allocation.unavailableReason || '其他已记录关系' }}</td><td>{{ auxiliaryMoney(allocation.amount) }}</td><td>{{ allocation.effective ? '有效' : '已撤销' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4>源单附件</h4>
      <ul v-if="document.files.length">
        <li v-for="file in document.files" :key="file.id">
          {{ file.fileName }} · {{ file.fileSize }} 字节 · {{ file.uploader || '上传人未记录' }} · {{ file.uploadedAt || '时间未记录' }}
        </li>
      </ul>
      <p v-else class="text-ink-soft">
        暂无源单附件
      </p>
    </template>
  </section>
</template>
