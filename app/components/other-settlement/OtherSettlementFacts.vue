<script setup lang="ts">
import type { OtherSettlementFact } from '~/lib/other-settlement/contract'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { isEffectiveSettlementFact } from '~/lib/other-settlement/facts'

const props = defineProps<{
  facts: OtherSettlementFact[] | null
  kind: OtherSettlementFact['kind']
  selectedId?: string
}>()
const emit = defineEmits<{
  select: [
        id: string,
  ]
  close: [
  ]
}>()
const rows = computed(() => props.facts?.filter(f => f.kind === props.kind) ?? [])
const selected = computed(() => rows.value.find(f => f.id === props.selectedId))
const label = computed(() => ({ penalty: '奖罚抵扣', application: '付款申请', payment: '支付事实' })[props.kind])
</script>

<template>
  <section class="panel min-w-0 p-4">
    <SectionHeader :title="label" />
    <StatePanel v-if="facts === null" kind="empty" title="关联事实不可用" description="未记录完整事实或稳定关系已失效，无法判定为零。" compact />
    <template v-else>
      <div role="region" :aria-label="`${label}表`" tabindex="0" class="mt-3 min-w-0 overflow-x-auto">
        <table class="w-full min-w-180 border-collapse text-left text-13px">
          <thead class="bg-surface-2 text-ink-soft">
            <tr>
              <th class="p-2">
                编号
              </th><th>名称</th><th>日期</th><th>关联金额</th><th>状态</th><th>计入口径</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" class="border-b border-line">
              <td class="p-2">
                {{ row.no || '未记录' }}
              </td><td>{{ row.name || '未记录' }}</td><td>{{ row.date || '未记录' }}</td><td class="font-mono">
                {{ auxiliaryMoney(row.attribution === 'exact' ? row.amount : null) }}
              </td><td>{{ row.status }}</td><td>{{ isEffectiveSettlementFact(row) ? row.attribution === 'exact' ? '按真实关联' : '缺少结算级分摊' : '无效事实不计入' }}</td><td>
                <button :id="`fact-${row.id}`" type="button" class="cursor-pointer border-0 bg-transparent text-brand underline" @click="emit('select', row.id)">
                  查看关联事实
                </button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="7" class="p-8 text-center text-ink-faint">
                暂无{{ label }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="selected" class="mt-4 rounded border border-line bg-surface-2 p-4 text-13px" aria-label="关联事实详情">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-14px">
            {{ selected.name || label }}
          </h3><KitButton @click="emit('close')">
            返回关联列表
          </KitButton>
        </div>
        <dl class="grid gap-3 break-all md:grid-cols-2">
          <div>源单稳定 ID：{{ selected.sourceId }}</div><div>关联事实 ID：{{ selected.id }}</div><div>日期：{{ selected.date || '未记录' }}</div><div>状态：{{ selected.status }}</div><div>本结算关联金额：{{ auxiliaryMoney(selected.attribution === 'exact' ? selected.amount : null) }}</div><div v-if="selected.parentId">
            来源申请 ID：{{ selected.parentId }}
          </div>
        </dl>
        <p class="text-ink-soft">
          {{ selected.attribution === 'unknown' ? '此支付涉及多个结算，缺少结算级分摊，不能按金额或比例猜接。' : '以上为该结算的真实关联事实。' }} 源业务页尚未接入同一中央身份时，完整源单详情不可用。
        </p>
      </section>
      <StatePanel v-else-if="selectedId" kind="empty" title="关联事实未找到" description="当前结算不包含该稳定关系，不能跳转到其他单据。" compact />
    </template>
  </section>
</template>
