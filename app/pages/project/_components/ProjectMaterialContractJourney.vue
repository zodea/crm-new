<script setup lang="ts">
import type { MetricDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  count: MetricDTO
  navigation: NavigationIntentDTO
  returnTo: string
}>()
const emit = defineEmits<{ retry: [], navigate: [] }>()

const resolution = computed(() => resolveNavigationTarget(props.navigation, {
  label: '材料采购合同',
  returnTo: props.returnTo,
}))
const countLabel = computed(() => typeof props.count.value === 'number' ? String(props.count.value) : '—')
const unavailableLabel = computed(() => resolution.value.state === 'forbidden'
  ? '无材料采购合同查看权限'
  : resolution.value.state === 'missing'
    ? '未记录材料采购合同关系'
    : resolution.value.state === 'error' ? '材料采购合同读取失败' : '材料采购合同数量暂不可用')
</script>

<template>
  <section class="panel min-w-0 p-3" aria-labelledby="project-material-contract-heading">
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <div class="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-btn)] bg-brand-soft text-brand">
        <span class="i-lucide-shopping-cart h-4 w-4" aria-hidden="true" />
      </div>
      <div class="min-w-0 flex-[1_1_18rem]">
        <h3 id="project-material-contract-heading" class="m-0 text-14px font-800 text-ink">
          材料采购合同
        </h3>
        <p class="m-0 mt-0.5 text-11px text-ink-soft">
          按当前项目稳定 ID 查看材采合同；真实零记录仍进入专属空列表。
        </p>
      </div>
      <NuxtLink
        v-if="resolution.state === 'resolved'"
        id="project-material-contract-link"
        :to="resolution.to"
        class="btn-secondary"
        :aria-label="`查看材料采购合同（${countLabel}）`"
        @click="emit('navigate')"
      >
        查看合同 <span class="ml-1 chip chip-brand">{{ countLabel }}</span>
      </NuxtLink>
      <span v-if="resolution.state !== 'resolved' && resolution.state !== 'error'" class="text-12px text-ink-faint">{{ unavailableLabel }}</span>
    </div>
    <StatePanel
      v-if="resolution.state === 'error'"
      class="mt-3"
      kind="error"
      title="材料采购合同读取失败"
      description="项目资料仍可查看；合同聚合暂时不可用。"
      action-label="重试"
      compact
      @action="emit('retry')"
    />
  </section>
</template>
