<script setup lang="ts">
import type { DataOriginDTO, NavigationIntentDTO } from '~/types/read-model'
import { useSubcontractSettlementDetail } from '~/composables/useSubcontractSettlementDetail'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ documentId: string, origin: DataOriginDTO }>()
const { route, store, detail, loading, problem, shellState, stateTitle, returnContext, backLabel, canEdit, amounts, load, edit } = useSubcontractSettlementDetail(props)

function relationLabel(intent: NavigationIntentDTO, fallback: string): string {
  return 'subject' in intent && intent.subject.state === 'resolved' ? intent.subject.label : fallback
}

function money(value: string | null | undefined): string {
  return value == null ? '未记录' : yuan(Number(value))
}

function fileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="subcontract-settlement-detail min-w-0" data-testid="subcontract-settlement-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? '分包结算详情'"
      :subtitle="detail?.document.no || '编号未填写'"
      :back-to="returnContext.to"
      :back-label="backLabel"
      :state="shellState"
      :state-title="stateTitle"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">
            {{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}
          </span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.document.approval.label }}</span>
        </template>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="subcontract-settlement-edit" @click="edit">
          编辑结算
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" class="settlement-summary" :cols="4">
          <Metric label="含税结算额" :value="money(amounts?.total)" big tone="brand" />
          <Metric label="累计已确认结算" :value="money(amounts?.cumulativeSettled)" />
          <Metric label="往期已确认结算" :value="money(amounts?.priorSettled)" />
          <Metric label="合同金额" :value="money(amounts?.contractAmount)" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel
          v-if="store.detailState.kind === 'error'"
          kind="error"
          title="刷新分包结算失败"
          :description="`${store.detailState.problem.message}；当前保留上一次成功读取的详情。`"
          :action-label="store.detailState.problem.retryable ? '重新加载' : ''"
          compact
          @action="load"
        />
        <StatePanel v-if="loading" kind="loading" title="正在刷新分包结算" description="当前保留上一次成功读取的详情。" compact />

        <div class="settlement-content">
          <section class="panel p-4" aria-labelledby="subcontract-settlement-basic-title">
            <h3 id="subcontract-settlement-basic-title" class="settlement-section-title">
              结算信息
            </h3>
            <div class="detail-grid mt-3">
              <div class="detail-row">
                <span>所属项目</span>
                <EntityLink type="project" :intent="detail.projectNavigation" :label="relationLabel(detail.projectNavigation, '项目不可用')" :return-to="route.fullPath" />
              </div>
              <div class="detail-row">
                <span>分供方</span>
                <EntityLink type="supplier" :intent="detail.supplierNavigation" :label="relationLabel(detail.supplierNavigation, '分供方不可用')" :return-to="route.fullPath" />
              </div>
              <div class="detail-row">
                <span>分包合同</span>
                <EntityLink type="contract" :intent="detail.contractNavigation" :label="relationLabel(detail.contractNavigation, '合同不可用')" :return-to="route.fullPath" />
              </div>
              <div class="detail-row">
                <span>结算类型</span><strong>{{ detail.document.documentType || '未记录' }}</strong>
              </div>
              <div class="detail-row">
                <span>结算日期</span><strong class="font-mono">{{ detail.document.applicationDate || '未记录' }}</strong>
              </div>
              <div class="detail-row">
                <span>审批摘要</span><strong>{{ detail.document.approval.summary }}</strong>
              </div>
              <div class="detail-row">
                <span>来源单据</span>
                <EntityLink type="contract" :intent="detail.sourceNavigation" :label="relationLabel(detail.sourceNavigation, '来源不可用')" :return-to="route.fullPath" />
              </div>
              <div class="detail-row full">
                <span>结算名称</span><strong>{{ detail.document.name || '未记录' }}</strong>
              </div>
              <div class="detail-row full">
                <span>扣款说明</span><strong>{{ detail.document.deductionNote || '未记录' }}</strong>
              </div>
              <div class="detail-row full">
                <span>备注</span><strong>{{ detail.document.note || '未记录' }}</strong>
              </div>
            </div>
          </section>

          <section class="panel p-4" aria-labelledby="subcontract-settlement-payment-title">
            <h3 id="subcontract-settlement-payment-title" class="settlement-section-title">
              付款与抵扣
            </h3>
            <dl class="settlement-balances">
              <div
                v-for="item in [
                  { label: '奖罚抵扣', value: amounts?.deductions },
                  { label: '本次结算净额', value: amounts?.netSettlement },
                  { label: '累计申请付款', value: amounts?.cumulativeApplied },
                  { label: '剩余可申请', value: amounts?.remainingApplicable },
                  { label: '累计已付', value: amounts?.cumulativePaid },
                  { label: '剩余未付', value: amounts?.remainingUnpaid },
                ]" :key="item.label" role="group" :aria-label="item.label"
              >
                <dt>{{ item.label }}</dt>
                <dd :class="item.value == null ? 'text-ink-faint' : 'font-mono font-600'">
                  {{ money(item.value) }}
                </dd>
              </div>
            </dl>
            <p class="settlement-note">
              付款或抵扣资料不完整时显示未记录。
            </p>
          </section>
        </div>
        <p class="px-1 text-12px leading-5 text-ink-soft">
          累计仅包含同一项目、分供方、合同的已确认结算。已确认结算可作为项目罚扣抵扣来源。
        </p>
        <section class="panel p-4" aria-labelledby="subcontract-settlement-files-title">
          <h3 id="subcontract-settlement-files-title" class="settlement-section-title">
            附件
          </h3>
          <ul v-if="detail.files.length" class="mt-3 grid gap-2" aria-label="分包结算附件列表">
            <li v-for="file in detail.files" :key="file.id" class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-line px-3 py-2 text-12px">
              <span class="min-w-0 break-all font-600">{{ file.fileName }}</span>
              <span class="text-ink-soft">{{ file.category || '未分类' }} · {{ fileSize(file.fileSize) }}</span>
            </li>
          </ul>
          <StatePanel v-else class="mt-3" kind="empty" title="暂无附件" description="该分包结算尚未关联附件。" compact />
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.subcontract-settlement-detail { container-type: inline-size; }
.settlement-summary { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
@container (max-width: 850px) { .settlement-summary { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
@container (max-width: 350px) { .settlement-summary { grid-template-columns: minmax(0, 1fr) !important; } }
.detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 24px; }
.detail-row { display: flex; flex-direction: column; min-width: 0; gap: 7px; padding: 12px 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.detail-row > span:first-child { color: var(--ink-soft); font-size: 12px; }
.settlement-content { display: grid; align-items: start; gap: 16px; }
.settlement-balances > div { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.settlement-balances dt { color: var(--ink-soft); }
.settlement-balances dd { text-align: right; font-variant-numeric: tabular-nums; }
.settlement-note { margin-top: 16px; padding: 12px; background: var(--surface-2); font-size: 12px; line-height: 1.7; color: var(--ink-soft); }
@container (min-width: 1000px) { .settlement-content { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); } }
.detail-row strong { font-weight: 400; }
.settlement-section-title { padding-bottom: 12px; font-size: 14px; font-weight: 700; border-bottom: 1px solid var(--line); }
.detail-row.full { grid-column: 1 / -1; }
@container (max-width: 700px) { .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 440px) { .detail-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
