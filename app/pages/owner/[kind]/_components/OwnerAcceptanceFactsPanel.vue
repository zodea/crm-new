<script setup lang="ts">
import type { OwnerAcceptanceViewDTO } from '~/lib/owner-document/central-repository'

defineProps<{
  view: OwnerAcceptanceViewDTO
}>()
</script>

<template>
  <section class="panel p-4" :aria-labelledby="`${view.variant}-facts-title`">
    <SectionHeader
      :id="`${view.variant}-facts-title`"
      :title="view.variant === 'acceptance' ? '竣工验收' : '保修到期确认'"
      :subtitle="view.variant === 'acceptance' ? '验收单位、人员、日期和结论' : '保修责任、期限与到期确认事实'"
    />
    <div v-if="view.variant === 'acceptance'" class="detail-grid mt-3" data-testid="acceptance-variant-facts">
      <div class="detail-row">
        <span>验收单位</span><strong>{{ view.organization || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>验收人</span><strong>{{ view.person || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>验收日期</span><strong class="font-mono">{{ view.date || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>验收结论</span><strong>{{ view.conclusion || '未记录' }}</strong>
      </div>
    </div>
    <div v-else class="detail-grid mt-3" data-testid="warranty-variant-facts">
      <div class="detail-row">
        <span>保修责任单位</span><strong>{{ view.owner || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>保修开始</span><strong class="font-mono">{{ view.startDate || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>保修结束</span><strong class="font-mono">{{ view.endDate || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>到期验收单位</span><strong>{{ view.confirmationOrganization || '未记录' }}</strong>
      </div>
      <div class="detail-row">
        <span>到期确认日期</span><strong class="font-mono">{{ view.confirmationDate || '未记录' }}</strong>
      </div>
      <div class="detail-row full">
        <span>到期确认结论</span><strong>{{ view.confirmationNote || '未记录' }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 112px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
</style>
