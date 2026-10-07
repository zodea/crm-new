<script setup lang="ts">
import type { ConstructionScopeSpendingRead } from '~/lib/construction-scope/contract'
import type { KitTableColumn } from '~/lib/kit/table'
import { onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import KitTable from '~/components/ui/KitTable.vue'
import StatCard from '~/components/ui/StatCard.vue'
import { decodeConstructionScopeSpending } from '~/lib/construction-scope/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ projectId: string, mainId?: string | null }>()
const read = shallowRef<ConstructionScopeSpendingRead | null>(null)
const busy = shallowRef(false)
const error = shallowRef('')
let generation = 0
let active = true
const columns: KitTableColumn[] = [{ field: 'name', title: '真实来源', minWidth: 220 }, { field: 'metric', title: '金额性质', width: 110, slot: 'metric' }, { field: 'amount', title: '原来源金额', width: 140, align: 'right', slot: 'amount' }, { field: 'mainId', title: '施工主合同归属', minWidth: 160, slot: 'main' }, { field: 'reason', title: '待核依据', minWidth: 240 }]
const labels = { committed: '材料合同承诺', incurred: '原费用已发生', paid: '实际已支付' }
function invalidate(message = '') {
  generation++
  read.value = null
  busy.value = false
  error.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
onDeactivated(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load() {
  const token = ++generation
  busy.value = true
  error.value = ''
  try {
    const value = decodeConstructionScopeSpending(await $fetch<unknown, string>('/api/read/construction-scope/spending', { query: { projectId: props.projectId, ...(props.mainId ? { mainId: props.mainId } : {}) }, retry: 0 }))
    if (!active || token !== generation)
      return
    if (value.dataOrigin !== 'real' || value.projectId !== props.projectId || value.mainId !== (props.mainId ?? null) || !Array.isArray(value.rows) || !Array.isArray(value.sources))
      throw new Error('施工开支读取范围不一致，请重新读取。')
    read.value = value
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
watch(() => `${props.projectId}:${props.mainId ?? ''}`, () => {
  invalidate()
  void load()
}, { immediate: true })
</script>

<template>
  <section class="min-w-0 space-y-4" aria-label="施工合同开支来源">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="font-medium">
          施工合同开支来源
        </h3><p class="text-sm text-[var(--ink-soft)]">
          合同承诺、已发生费用和实际支付分别读取，不相加为同一笔成本。
        </p>
      </div>
      <KitButton variant="ghost" size="sm" :disabled="busy" @click="load">
        重新读取
      </KitButton>
    </div>
    <p v-if="error" role="alert" class="text-sm text-[var(--danger)]">
      {{ error }}
    </p>
    <template v-if="read">
      <div class="grid gap-3 sm:grid-cols-3">
        <StatCard v-for="(metric, kind) in read.metrics" :key="kind" :label="`${labels[kind]}（已接来源）`" :value="metric.amount ?? '待核'" money currency :status="metric.complete ? '已核对原来源' : `已知部分 ¥${metric.knownAmount.toFixed(2)}`" />
      </div>
      <div class="min-w-0 overflow-x-auto">
        <KitTable :data="read.rows" :columns="columns" row-key="identity" empty="当前已接来源没有记录">
          <template #metric="{ row }">
            {{ labels[row.metric as keyof typeof labels] }}
          </template>
          <template #amount="{ row }">
            {{ row.amount === null ? '未知' : `¥${Number(row.amount).toFixed(2)}` }}
          </template>
          <template #main="{ row }">
            <NuxtLink v-if="row.mainLabel && row.mainId" :to="`/contract/${encodeURIComponent(row.mainId)}?origin=real&amp;contractKind=construction`" class="text-brand hover:underline">
              {{ row.mainLabel }}
            </NuxtLink>
            <span v-else>{{ row.mainId ? '原施工归属，名称暂不可读取' : '施工归属待核' }}</span>
          </template>
        </KitTable>
      </div>
      <p v-if="read.unassigned.length" class="text-sm text-[var(--ink-soft)]">
        项目另有 {{ read.unassigned.length }} 条施工归属待核来源；这些金额不会重复算入每份施工主合同。
      </p>
      <p class="text-sm text-[var(--ink-soft)]">
        项目工资按原项目工资簿与真实支付来源独立核对；{{ read.projectPayroll.knownPaidAmount === null ? '金额来源待核' : `已知实际净发放 ¥${read.projectPayroll.knownPaidAmount.toFixed(2)}` }}。不按施工主合同推定分摊。
      </p>
      <ul class="space-y-1 text-sm text-[var(--ink-soft)]">
        <li v-for="source in read.sources.filter(row => row.state !== 'readable')" :key="source.key">
          {{ source.reason }}
        </li>
      </ul>
    </template>
  </section>
</template>
