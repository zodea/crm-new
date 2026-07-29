<script setup lang="ts">
import type { CrewDetailMaster } from '~/stores/crew-detail'

defineProps<{
  crew: CrewDetailMaster
}>()

function priceLabel(enabled: boolean, value: number | null): string {
  if (!enabled)
    return '未启用'
  return value == null ? '已启用 · 未设单价' : `已启用 · ${value.toFixed(2)} 元`
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="crew-capability-title">
    <SectionHeader
      id="crew-capability-title"
      title="工种与责任范围"
      subtitle="责任配置来源于班组档案，工程量指派只列出兼容范围"
      :mb="0"
    />

    <div class="grid min-w-0 gap-[1px] bg-line md:grid-cols-2">
      <div class="min-w-0 bg-panel p-4">
        <h4 class="m-0 text-12px font-700 text-ink-soft">
          可承接工种
        </h4>
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="trade in crew.tradeCapabilities"
            :key="trade"
            class="chip-brand"
          >
            {{ trade }}
          </span>
          <span v-if="!crew.tradeCapabilities.length" class="text-12px text-ink-faint">
            尚未配置工种能力
          </span>
        </div>
      </div>

      <div class="min-w-0 bg-panel p-4">
        <h4 class="m-0 text-12px font-700 text-ink-soft">
          可承接活项
        </h4>
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="item in crew.itemCapabilities"
            :key="item"
            class="chip"
          >
            {{ item }}
          </span>
          <span v-if="!crew.itemCapabilities.length" class="text-12px text-ink-faint">
            未限制活项范围
          </span>
        </div>
      </div>
    </div>

    <dl class="info-row border-x-0 border-b-0">
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          指派粒度
        </dt>
        <dd class="m-0 mt-1 text-13px font-700 text-ink">
          {{ crew.assignmentLevel === 'worker' ? '可下钻到组内工人' : '班组责任止于整户工种' }}
        </dd>
      </div>
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          默认发放比例
        </dt>
        <dd class="m-0 mt-1 font-mono text-13px font-700 text-ink">
          {{ (crew.defaultPayRatio * 100).toFixed(0) }}%
        </dd>
      </div>
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          房租补贴
        </dt>
        <dd class="m-0 mt-1 text-13px font-700 text-ink">
          {{ priceLabel(crew.rentSubsidyEnabled, crew.rentSubsidyPrice) }}
        </dd>
      </div>
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          管理提成
        </dt>
        <dd class="m-0 mt-1 text-13px font-700 text-ink">
          {{ priceLabel(crew.mgmtFeeEnabled, crew.mgmtFeePrice) }}
        </dd>
      </div>
    </dl>

    <div v-if="crew.note" class="border-t border-line px-4 py-3">
      <span class="text-11px text-ink-faint">备注</span>
      <p class="m-0 mt-1 break-words text-13px leading-6 text-ink-soft">
        {{ crew.note }}
      </p>
    </div>
  </section>
</template>
