<script setup lang="ts">
import type { ConstructionContractAmountsDTO } from '~/lib/construction-contract/read-contract'
import type { DataOriginDTO } from '~/types/read-model'
import { onActivated, onDeactivated, shallowRef, watch } from 'vue'
import { parseConstructionContractDetailQuery } from '~/lib/construction-contract/read-page'
import { constructionContractProblemFromUnknown } from '~/lib/construction-contract/repository'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ contractId: string | null, origin?: DataOriginDTO, includeDemo?: boolean }>()
const repository = useNuxtApp().$repositories.constructionContractRead
const amounts = shallowRef<ConstructionContractAmountsDTO | null>(null)
const problem = shallowRef('')
const loading = shallowRef(false)
let generation = 0
let activated = false
async function load() {
  const current = ++generation
  amounts.value = null
  problem.value = ''
  if (!props.contractId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const detail = await repository.get(parseConstructionContractDetailQuery(props.contractId, { origin: props.origin ?? 'real', includeDemo: props.includeDemo ?? false }))
    if (current !== generation)
      return
    amounts.value = detail.contract.amounts
    problem.value = detail.receiptsProblem?.message ?? ''
  }
  catch (cause) {
    if (current === generation)
      problem.value = constructionContractProblemFromUnknown(cause).problem.message
  }
  finally {
    if (current === generation)
      loading.value = false
  }
}
watch(() => [props.contractId, props.origin, props.includeDemo], () => void load(), { immediate: true })
onDeactivated(() => {
  generation++
})
onActivated(() => {
  if (activated)
    void load()
  activated = true
})
</script>

<template>
  <section id="section-contract" class="panel scroll-mt-4 p-4" aria-label="合同情况">
    <SectionHeader title="合同情况" />
    <p v-if="!contractId" class="mb-0 text-12px text-ink-faint">
      未关联施工合同，合同指标不适用。
    </p>
    <template v-else>
      <StatePanel v-if="problem" kind="error" title="合同指标暂不可完整读取" :description="problem" action-label="重新读取" compact @action="load" />
      <MetricGrid :cols="4" class="mt-3" :aria-busy="loading">
        <Metric label="变更后合同金额" :value="yuan(amounts?.changed ?? null)" />
        <Metric label="合同累计收款" :value="yuan(amounts?.received ?? null)" />
        <Metric label="收款 / 合同占比" :value="amounts && Number(amounts.changed) > 0 && amounts.received !== null ? `${(Number(amounts.received) / Number(amounts.changed) * 100).toFixed(2)}%` : '—'" />
        <Metric label="开票未收款" :value="yuan(amounts?.invoicedUnreceived ?? null)" />
      </MetricGrid>
    </template>
  </section>
</template>
