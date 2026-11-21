<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'

defineProps<{
  detail: OwnerCommercialDocumentDetailReadDTO
  returnTo: string
}>()
</script>

<template>
  <section class="panel p-4" aria-labelledby="final-settlement-facts-title">
    <SectionHeader
      id="final-settlement-facts-title"
      title="结算事实与关系"
      subtitle="项目、甲方、施工合同、依据与差异均来自中央正式源"
    />
    <div class="detail-grid mt-3">
      <div class="detail-row">
        <span>所属项目</span>
        <EntityLink type="project" :intent="detail.projectNavigation" label="查看项目" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>甲方客户</span>
        <EntityLink type="customer" :intent="detail.customerNavigation" label="查看甲方" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>施工合同</span>
        <EntityLink type="contract" :intent="detail.contractNavigation" label="查看合同" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>来源事实</span>
        <EntityLink type="contract" :intent="detail.sourceNavigation" label="查看合同结算行" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>报审日期</span>
        <strong class="font-mono">{{ detail.document.applicationDate || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>审定日期</span>
        <strong class="font-mono">{{ detail.document.approvalDate || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>结算依据</span>
        <strong>{{ detail.finalSettlementEvidence?.basis || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>差异说明</span>
        <strong>{{ detail.finalSettlementEvidence?.differenceNote || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>备注</span>
        <strong>{{ detail.document.note || '未记录' }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 96px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
</style>
