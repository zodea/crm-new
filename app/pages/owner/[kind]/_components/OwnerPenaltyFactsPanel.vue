<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'

defineProps<{
  detail: OwnerCommercialDocumentDetailReadDTO
  returnTo: string
}>()
</script>

<template>
  <section class="panel p-4" aria-labelledby="owner-penalty-facts-title">
    <SectionHeader
      id="owner-penalty-facts-title"
      title="罚扣事实与关系"
      subtitle="联系单、事由、申诉与施工合同均来自甲方罚扣正式源"
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
        <EntityLink type="contract" :intent="detail.contractNavigation" label="查看施工合同" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>来源事实</span>
        <EntityLink type="contract" :intent="detail.sourceNavigation" label="返回合同罚扣行" :return-to="returnTo" />
      </div>
      <div class="detail-row">
        <span>联系单号</span>
        <strong class="font-mono">{{ detail.ownerPenaltyFacts?.noticeNo || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>罚扣日期</span>
        <strong class="font-mono">{{ detail.ownerPenaltyFacts?.penaltyDate || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>罚扣事由</span>
        <strong>{{ detail.ownerPenaltyFacts?.reason || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>申诉说明</span>
        <strong>{{ detail.ownerPenaltyFacts?.appealNote || '未记录' }}</strong>
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
