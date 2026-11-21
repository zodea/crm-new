<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue'
import PayrollASourceReturn from '~/components/payroll/PayrollASourceReturn.vue'
import QuantityHollowCommandRecovery from '~/components/quantity/QuantityHollowCommandRecovery.vue'
import KitButton from '~/components/ui/KitButton.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { useQuantityHollowRead } from '~/composables/useQuantityHollowRead'
import { quantityHollowPath, quantityHollowQuery, quantityHollowSourceQuery } from '~/lib/quantity/hollow-navigation'
import { isQuantitySourceIdentity } from '~/lib/quantity/migration-identity'
import QuantityHollowHistory from './QuantityHollowHistory.vue'
import QuantityHollowRecordSummary from './QuantityHollowRecordSummary.vue'
import QuantityHollowRectification from './QuantityHollowRectification.vue'

const props = defineProps<{ projectId: string, unitId: string, recordId: string }>()
const route = useRoute()
const section = shallowRef<HTMLElement | null>(null)
const query = computed(() => isQuantitySourceIdentity(props.recordId, 'quantity_hollow_records') ? quantityHollowQuery(props.projectId, props.unitId, route.query.origin ?? 'real') : null)
const ui = useQuantityHollowRead(() => query.value, () => props.recordId)
const { current, loading, error } = ui
const record = computed(() => current.value?.data.records.find(record => record.recordId === props.recordId) ?? null)
const revisionId = computed(() => route.query.revisionId === undefined ? null : isQuantitySourceIdentity(route.query.revisionId, 'quantity_hollow_revisions') ? route.query.revisionId : '')
const revisionUnavailable = computed(() => revisionId.value !== null && (!revisionId.value || !record.value?.revisions.some(revision => revision.revisionId === revisionId.value)))
const historical = computed(() => revisionId.value !== null && revisionId.value !== record.value?.inspection.revisionId)
const back = computed(() => query.value ? { path: quantityHollowPath(query.value, 'unit'), query: quantityHollowSourceQuery(query.value, route.query) } : '/subcontract/quantity')
const edit = computed(() => query.value && record.value?.eligibility.revise.allowed && !revisionUnavailable.value ? { path: quantityHollowPath(query.value, 'form', props.recordId), query: quantityHollowSourceQuery(query.value, route.query) } : null)
watch([record, revisionId], async () => {
  const value = record.value
  const id = revisionId.value
  await nextTick()
  if (!ui.active.value || value !== record.value || id !== revisionId.value || !id)
    return
  const element = [...section.value?.querySelectorAll<HTMLElement>('[data-hollow-revision]') ?? []].find(element => element.dataset.hollowRevision === id)
  element?.scrollIntoView({ block: 'center' })
  element?.focus({ preventScroll: true })
}, { flush: 'post' })
useTabTitle(() => record.value ? `${record.value.location.unitName} 空鼓记录` : '空鼓检查记录')
</script>

<template>
  <QuantityHollowCommandRecovery :project-id="projectId" :unit-id="unitId" @recovered="ui.load" />
  <div ref="section" class="grid min-w-0 gap-4">
    <header class="panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
      <div class="grid min-w-0 gap-2">
        <NuxtLink :to="back" class="cell--link justify-self-start">
          返回原户施工详情
        </NuxtLink><h1 class="text-18px font-800">
          空鼓检查与整改
        </h1>
      </div><NuxtLink v-if="edit" :to="edit" class="btn-secondary">
        修订检查记录
      </NuxtLink>
    </header>
    <PayrollASourceReturn v-if="query" kind="quantity-unit" :source-id="unitId" :project-id="projectId" :origin="query.origin" />
    <StatePanel v-if="loading" kind="loading" title="正在核对原户空鼓记录" />
    <section v-else-if="error || !record || revisionUnavailable" class="panel grid min-w-0 gap-3 p-4" role="alert">
      <p>{{ error || (revisionUnavailable ? '指定的原检查修订尚未获证明，不能以当前版本代替。' : '这份原户空鼓记录尚未获证明，请保留原引用重新核对。') }}</p><p v-for="(diagnostic, index) in current?.data.unavailable ?? []" :key="index">
        {{ diagnostic.message }}
      </p><KitButton class="justify-self-start" variant="secondary" @click="ui.load">
        重新读取原户
      </KitButton>
    </section>
    <template v-else>
      <p v-if="revisionId" class="panel p-3 text-12px leading-5">
        此页定位原检查版本。下方当前余量单独反映后来记录，不回填原工资冻结依据。
      </p>
      <QuantityHollowRecordSummary :record="record" />
      <QuantityHollowHistory :record="record" :revision-id="revisionId" />
      <QuantityHollowRectification v-if="query && record.eligibility.rectify.allowed && !historical" :query="query" :record-id="recordId" @saved="ui.load" />
      <p v-for="reason in record.eligibility.rectify.reasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
    </template>
  </div>
</template>
