<script setup lang="ts">
import type { DataOriginDTO, NavigationIntentDTO } from '~/types/read-model'
import { useProjectPenaltyDetail } from '~/composables/useProjectPenaltyDetail'
import { yuan } from '~/lib/util/money'
import ProjectPenaltyActionDialog from '~/pages/project/penalty/_components/ProjectPenaltyActionDialog.vue'
import ProjectPenaltyHistory from '~/pages/project/penalty/_components/ProjectPenaltyHistory.vue'

const props = defineProps<{ documentId: string, origin: DataOriginDTO }>()
const { route, detail, loading, problem, shellState, stateTitle, returnContext, backLabel, canEdit, amounts, load, edit } = useProjectPenaltyDetail(props)
const mode = ref<'deduct' | 'rectify' | null>(null)
const canWrite = computed(() => detail.value?.dataOrigin === 'real' && detail.value.capabilities.includes('subcontract-document:write') && !loading.value && !problem.value)
const relations = computed(() => detail.value
  ? [
      { label: '所属项目', type: 'project' as const, intent: detail.value.projectNavigation },
      { label: '分供方', type: 'supplier' as const, intent: detail.value.supplierNavigation },
      { label: '来源合同', type: 'contract' as const, intent: detail.value.contractNavigation },
      { label: '责任班组', type: 'crew' as const, intent: detail.value.crewNavigation ?? { kind: 'unavailable' as const, reason: 'missing-id' as const } },
    ]
  : [])
function label(intent: NavigationIntentDTO) {
  return 'subject' in intent && intent.subject.state === 'resolved' ? intent.subject.label : '未关联'
}
</script>

<template>
  <div class="penalty-detail min-w-0" data-testid="project-penalty-detail">
    <EntityDetailShell :title="detail?.document.name || '项目罚扣详情'" :subtitle="detail?.document.no || '编号未填写'" :back-to="returnContext.to" :back-label="backLabel" :state="shellState" :state-title="stateTitle" :state-description="problem?.message ?? ''" :state-action-label="problem?.retryable ? '重新加载' : ''" @state-action="load">
      <template #status>
        <span v-if="detail" class="chip chip-brand">{{ detail.document.approval.label }}</span>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" @click="edit">
          编辑罚扣
        </button>
        <button v-if="canWrite" type="button" class="btn-secondary" @click="mode = 'rectify'">
          记录整改
        </button>
        <button v-if="canWrite && detail && ['pending', 'repairing', 'repaired_self', 'repaired_other'].includes(detail.document.status) && Number(amounts?.remaining) > 0" type="button" class="btn-primary" @click="mode = 'deduct'">
          结算抵扣
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="amounts" :cols="3" class="penalty-metrics">
          <Metric label="罚扣金额" :value="yuan(Number(amounts.amount))" big tone="brand" /><Metric label="累计已抵扣" :value="yuan(Number(amounts.deducted))" /><Metric label="剩余可抵扣" :value="yuan(Number(amounts.remaining))" />
        </MetricGrid>
      </template>
      <div v-if="detail" class="grid min-w-0 gap-4">
        <StatePanel v-if="problem" kind="error" title="刷新项目罚扣失败" :description="problem.message" action-label="重新加载" compact @action="load" />
        <section class="panel p-4">
          <h3 class="border-b border-line pb-3 text-14px font-700">
            罚扣资料
          </h3>
          <div class="facts-grid">
            <div v-for="relation in relations" :key="relation.label" class="fact">
              <span>{{ relation.label }}</span><EntityLink :type="relation.type" :intent="relation.intent" :label="label(relation.intent)" :return-to="route.fullPath" />
            </div>
            <div class="fact">
              <span>罚扣日期</span><strong>{{ detail.document.applicationDate || '未记录' }}</strong>
            </div>
            <div class="fact">
              <span>抵扣方式</span><strong>{{ detail.penaltyFacts?.deductionMethod || '未记录' }}</strong>
            </div>
            <div class="fact">
              <span>整改期限</span><strong>{{ detail.penaltyFacts?.deadline || '未记录' }}</strong>
            </div>
            <div class="fact full">
              <span>整改说明</span><strong>{{ detail.penaltyFacts?.rectificationNote || '未记录' }}</strong>
            </div>
            <div class="fact full">
              <span>备注</span><strong>{{ detail.document.note || '未记录' }}</strong>
            </div>
          </div>
        </section>
        <ProjectPenaltyHistory :detail="detail" :return-to="route.fullPath" />
        <section class="panel p-4">
          <h3 class="text-14px font-700">
            罚款照片与附件
          </h3><ul class="mt-3 space-y-2">
            <li v-for="file in detail.files" :key="file.id" class="break-all border-b border-line py-2 text-13px">
              {{ file.fileName }} <span class="text-ink-soft">· {{ file.category || '未分类' }}</span>
            </li>
          </ul><p v-if="!detail.files.length" class="mt-3 text-13px text-ink-soft">
            暂无附件
          </p>
        </section>
      </div>
    </EntityDetailShell>
    <ProjectPenaltyActionDialog v-if="detail" :detail="detail" :mode="mode" :refreshing="loading" @close="mode = null" @saved="load" @refresh="load" />
  </div>
</template>

<style scoped>
.penalty-detail { container-type: inline-size; }
.facts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 24px; }
.fact { display: flex; flex-direction: column; min-width: 0; gap: 7px; padding: 12px 0; font-size: 13px; overflow-wrap: anywhere; }
.fact > span { color: var(--ink-soft); font-size: 12px; }
.fact strong { font-weight: 400; white-space: pre-wrap; }
.full { grid-column: 1 / -1; }
@container (max-width: 700px) { .facts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 440px) { .penalty-metrics { grid-template-columns: minmax(0, 1fr) !important; } .facts-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
