<script setup lang="ts">
import type { ConstructionManagementFeeConfiguration } from '~/lib/construction-contract/management-fee'
import { yuan } from '~/lib/util/money'

defineProps<{ configuration: ConstructionManagementFeeConfiguration }>()
</script>

<template>
  <div class="min-w-0" data-testid="construction-management-fee-configuration">
    <dl class="grid min-w-0 gap-3 sm:grid-cols-2">
      <div class="min-w-0">
        <dt class="text-12px text-ink-muted">
          合同管理费配置额
        </dt>
        <dd class="mt-1 break-words font-mono text-18px font-semibold" data-testid="construction-management-fee-amount">
          {{ configuration.amount === null ? '未配置金额' : yuan(configuration.amount) }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-12px text-ink-muted">
          采用版本
        </dt>
        <dd class="mt-1 break-all text-12px">
          {{ configuration.version ?? '尚未配置' }}
        </dd>
      </div>
      <div class="min-w-0 sm:col-span-2">
        <dt class="text-12px text-ink-muted">
          合同依据
        </dt>
        <dd class="mt-1 whitespace-pre-wrap break-words text-13px">
          {{ configuration.basis || '未填写' }}
        </dd>
      </div>
    </dl>
    <p class="mt-3 text-12px leading-5 text-ink-muted">
      合同配置额单独记录；实际发生、已签收工资和实收付按对应单据核对。
    </p>
    <details v-if="configuration.history.length" class="mt-3 min-w-0">
      <summary class="cursor-pointer rounded py-1 text-13px text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        查看配置历史（{{ configuration.history.length }}）
      </summary>
      <ol class="mt-2 grid min-w-0 gap-2">
        <li v-for="snapshot in configuration.history" :key="snapshot.version" class="min-w-0 rounded border border-line p-3" data-testid="construction-management-fee-history">
          <p class="break-words text-13px font-semibold">
            {{ snapshot.amount === null ? '未配置金额' : yuan(snapshot.amount) }}
          </p>
          <p class="mt-1 whitespace-pre-wrap break-words text-12px">
            {{ snapshot.basis || '未填写依据' }}
          </p>
          <p class="mt-1 break-all text-11px text-ink-muted">
            {{ snapshot.adoptedAt }} · 合同版本 {{ snapshot.contractVersion }}
          </p>
          <p class="mt-1 break-all text-11px text-ink-muted">
            配置版本 {{ snapshot.version }}{{ snapshot.version === configuration.version ? ' · 当前采用' : '' }}
          </p>
        </li>
      </ol>
    </details>
  </div>
</template>
