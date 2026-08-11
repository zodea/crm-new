<script setup lang="ts">
import type { PaymentApplicationDetail } from '~/lib/finance/payment-detail'
import { yuan } from '~/lib/util/money'

defineProps<{
  detail: PaymentApplicationDetail
  statusText: string
  statusClass: string
}>()
</script>

<template>
  <section class="panel overflow-hidden" aria-label="智能业务洞察" data-testid="payment-application-insight">
    <header class="border-b border-line bg-brand-soft px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-14px font-800 text-ink">
          智能业务洞察
        </h3>
        <span class="i-lucide-sparkles text-16px text-brand" aria-hidden="true" />
      </div>
      <p class="mt-1 text-11px" :class="statusClass">
        {{ statusText }}
      </p>
    </header>

    <div class="flex min-w-0 flex-col gap-3 p-3">
      <details v-for="check in detail.insight.checks" :key="check.key" open class="insight-card" :class="`insight-card--${check.level}`">
        <summary class="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5">
          <span
            class="mt-0.5 shrink-0" :class="{
              'i-lucide-circle-check': check.level === 'ok',
              'i-lucide-info': check.level === 'info',
              'i-lucide-triangle-alert': check.level === 'warn',
              'i-lucide-circle-x': check.level === 'danger',
            }" aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-12px font-700 text-ink">{{ check.title }}</span>
            <span
              class="mt-0.5 block break-words text-11px font-600" :class="{
                'text-ok-ink': check.level === 'ok',
                'text-brand-deep': check.level === 'info',
                'text-warn-ink': check.level === 'warn',
                'text-danger-ink': check.level === 'danger',
              }"
            >{{ check.summary }}</span>
          </span>
          <span class="i-lucide-chevron-down mt-0.5 shrink-0 text-13px text-ink-faint" aria-hidden="true" />
        </summary>
        <p class="border-t border-current/10 px-3 py-2.5 text-11px leading-5 text-ink-soft">
          {{ check.detail }}
        </p>
      </details>

      <section v-if="detail.supplierId" class="border-t border-line pt-3" aria-labelledby="cross-project-payment-title">
        <div class="mb-2 flex items-center gap-2">
          <span class="h-3.5 w-[3px] rounded-[1px] bg-brand" aria-hidden="true" />
          <h4 id="cross-project-payment-title" class="text-12px font-800 text-ink">
            跨项目/分供方付款
          </h4>
        </div>
        <p v-if="detail.supplierOtherProjectCount" class="text-11px leading-5 text-ink-soft">
          该分供方在其他 {{ detail.supplierOtherProjectCount }} 个项目存在付款申请，已确认支付 {{ yuan(detail.supplierOtherProjectPaidAmount) }}。
        </p>
        <p v-else class="text-11px leading-5 text-ink-faint">
          当前未发现该分供方在其他项目的已确认支付。
        </p>
        <NuxtLink :to="`/base/supplier/${detail.supplierId}`" class="mt-2 inline-flex items-center text-11px text-brand hover:underline">
          查看分供方跨项目汇总
          <span class="i-lucide-arrow-up-right ml-1" aria-hidden="true" />
        </NuxtLink>
      </section>

      <p class="border-t border-line pt-3 text-10px leading-4 text-ink-faint">
        洞察只读取当前申请及其真实关联源单，金额和状态均为实时派生；审批人、评论和审批时间未接入时不会由前端补造。
      </p>
    </div>
  </section>
</template>

<style scoped>
.insight-card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
}

.insight-card--ok {
  border-color: color-mix(in srgb, var(--ok) 35%, var(--line));
}

.insight-card--info {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
}

.insight-card--warn {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  background: var(--warn-soft);
}

.insight-card--danger {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
  background: var(--danger-soft);
}

.insight-card summary::-webkit-details-marker {
  display: none;
}
</style>
