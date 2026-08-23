<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { computed } from 'vue'
import StatePanel from '~/components/ui/StatePanel.vue'

type EntityDetailState = 'ready' | 'loading' | 'empty' | 'error' | 'forbidden' | 'not-found'
type StatePanelKind = 'loading' | 'empty' | 'error' | 'forbidden'

const {
  title,
  subtitle = '',
  backTo,
  backLabel = '返回列表',
  asideLabel = '详情辅助信息',
  state = 'ready',
  stateTitle = '',
  stateDescription = '',
  stateActionLabel = '',
} = defineProps<{
  title: string
  subtitle?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  asideLabel?: string
  state?: EntityDetailState
  stateTitle?: string
  stateDescription?: string
  stateActionLabel?: string
}>()

defineEmits<{
  stateAction: []
}>()

const statePresentation = computed(() => {
  const defaults: Record<Exclude<EntityDetailState, 'ready'>, {
    kind: StatePanelKind
    title: string
    description: string
  }> = {
    'loading': {
      kind: 'loading',
      title: '正在加载详情',
      description: '',
    },
    'empty': {
      kind: 'empty',
      title: '暂无详情数据',
      description: '当前实体还没有可展示的业务数据。',
    },
    'error': {
      kind: 'error',
      title: '详情加载失败',
      description: '暂时无法读取详情，请稍后重试。',
    },
    'forbidden': {
      kind: 'forbidden',
      title: '无权查看该详情',
      description: '请联系管理员申请对应业务范围。',
    },
    'not-found': {
      kind: 'empty',
      title: '详情不存在或已删除',
      description: '该记录可能已被删除，可返回列表查看。',
    },
  }
  if (state === 'ready')
    return null

  const fallback = defaults[state]
  return {
    ...fallback,
    title: stateTitle || fallback.title,
    description: stateDescription || fallback.description,
  }
})
</script>

<template>
  <div
    v-if="state === 'ready'"
    data-ui="entity-detail-shell"
    class="entity-detail-shell flex min-w-0 flex-col gap-4"
  >
    <header class="panel min-w-0 overflow-hidden">
      <div class="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
        <slot name="back">
          <NuxtLink
            v-if="backTo"
            :to="backTo"
            class="icon-btn shrink-0"
            :title="backLabel"
            :aria-label="backLabel"
          >
            <span class="i-lucide-arrow-left text-14px" aria-hidden="true" />
          </NuxtLink>
        </slot>

        <div v-if="$slots.mark" data-ui="entity-detail-mark" class="shrink-0" aria-hidden="true">
          <slot name="mark" />
        </div>

        <div class="min-w-48 flex-[1_1_24rem]">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h2 data-entity-detail-title tabindex="-1" class="m-0 min-w-0 break-words text-18px leading-6 font-800 text-ink outline-none">
              {{ title }}
            </h2>
            <slot name="status" />
          </div>
          <p v-if="subtitle" class="m-0 mt-1 break-words text-11px leading-5 text-ink-soft">
            {{ subtitle }}
          </p>
          <slot name="metadata" />
        </div>

        <div
          v-if="$slots.actions"
          role="group"
          aria-label="详情操作"
          class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
        >
          <slot name="actions" />
        </div>
      </div>

      <div v-if="$slots.summary" data-ui="entity-detail-summary" class="border-t border-line p-3">
        <slot name="summary" />
      </div>
    </header>

    <div
      data-ui="entity-detail-body"
      :data-has-aside="Boolean($slots.aside)"
      class="entity-detail-shell__body grid min-w-0 items-start gap-4"
    >
      <div class="min-w-0">
        <slot />
      </div>
      <aside
        v-if="$slots.aside"
        :aria-label="asideLabel"
        class="min-w-0"
      >
        <slot name="aside" />
      </aside>
    </div>
  </div>

  <div v-else-if="statePresentation" class="flex min-w-0 flex-col gap-4">
    <div v-if="$slots.back || backTo" class="flex min-w-0">
      <slot name="back">
        <NuxtLink
          v-if="backTo"
          :to="backTo"
          class="btn-secondary w-fit"
          :aria-label="backLabel"
        >
          <span class="i-lucide-arrow-left mr-1 text-14px" aria-hidden="true" />
          {{ backLabel }}
        </NuxtLink>
      </slot>
    </div>
    <StatePanel
      :kind="statePresentation.kind"
      :title="statePresentation.title"
      :description="statePresentation.description"
      :action-label="stateActionLabel"
      @action="$emit('stateAction')"
    />
  </div>
</template>

<style scoped>
.entity-detail-shell {
  container: entity-detail-shell / inline-size;
}

.entity-detail-shell__body {
  grid-template-columns: minmax(0, 1fr);
}

@container entity-detail-shell (min-width: 68rem) {
  .entity-detail-shell__body[data-has-aside="true"] {
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 18rem);
  }
}
</style>
