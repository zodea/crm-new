<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import StatePanel from '~/components/ui/StatePanel.vue'

type EntityFormState = 'ready' | 'loading' | 'error'

interface FormSection {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  backLabel?: string
  sections?: FormSection[]
  state?: EntityFormState
  stateTitle?: string
  stateDescription?: string
  stateActionLabel?: string
}>(), {
  subtitle: '',
  backLabel: '返回列表',
  sections: () => [],
  state: 'ready',
  stateTitle: '',
  stateDescription: '',
  stateActionLabel: '',
})

defineEmits<{
  back: []
  stateAction: []
}>()

const activeSection = shallowRef('')

watch(
  () => props.sections,
  sections => activeSection.value = sections[0]?.key ?? '',
  { immediate: true },
)

const statePresentation = computed(() => {
  if (props.state === 'ready')
    return null
  if (props.state === 'loading') {
    return {
      kind: 'loading' as const,
      title: props.stateTitle || '正在载入表单',
      description: props.stateDescription,
    }
  }
  return {
    kind: 'error' as const,
    title: props.stateTitle || '表单载入失败',
    description: props.stateDescription || '暂时无法载入表单，请稍后重试。',
  }
})

const showSectionNav = computed(() =>
  props.state === 'ready' && props.sections.length >= 3,
)

function navigateToSection(key: string) {
  activeSection.value = key
  document
    .getElementById(`section-${key}`)
    ?.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'auto' })
}
</script>

<template>
  <div
    data-ui="entity-form-shell"
    class="entity-form-shell mx-auto w-full max-w-1340px pb-6"
  >
    <div
      data-ui="entity-form-layout"
      :data-has-sections="showSectionNav"
      class="entity-form-shell__layout grid min-w-0 items-start gap-4"
    >
      <nav
        v-if="showSectionNav"
        data-ui="entity-form-sections"
        class="entity-form-shell__sections sticky top-4 hidden rounded-[var(--radius-card)] border border-line bg-panel p-2"
        aria-label="表单分区"
      >
        <a
          v-for="section in sections"
          :key="section.key"
          :href="`#section-${section.key}`"
          :aria-current="activeSection === section.key ? 'location' : undefined"
          class="flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-12px text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-deep"
          :class="activeSection === section.key ? 'bg-brand-soft font-700 text-brand-deep' : ''"
          @click.prevent="navigateToSection(section.key)"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong"
            :class="activeSection === section.key ? 'bg-brand!' : ''"
            aria-hidden="true"
          />
          {{ section.label }}
        </a>
      </nav>

      <div class="min-w-0">
        <header class="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div class="min-w-48 flex-[1_1_32rem]">
            <button
              type="button"
              class="mb-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep"
              :aria-label="backLabel"
              @click="$emit('back')"
            >
              <span class="i-lucide-arrow-left" aria-hidden="true" />
              {{ backLabel }}
            </button>
            <h1 class="m-0 break-words text-20px leading-7 font-800 text-ink">
              {{ title }}
            </h1>
            <p v-if="subtitle" class="m-0 mt-1 break-words text-12px leading-5 text-ink-faint">
              {{ subtitle }}
            </p>
          </div>

          <div
            v-if="$slots.status || $slots.actions"
            class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
          >
            <slot name="status" />
            <div
              v-if="$slots.actions"
              role="group"
              aria-label="表单页面操作"
              class="flex min-w-0 flex-wrap items-center justify-end gap-2"
            >
              <slot name="actions" />
            </div>
          </div>
        </header>

        <StatePanel
          v-if="statePresentation"
          :kind="statePresentation.kind"
          :title="statePresentation.title"
          :description="statePresentation.description"
          :action-label="stateActionLabel"
          @action="$emit('stateAction')"
        />

        <template v-else>
          <div data-ui="entity-form-content" class="min-w-0">
            <slot />
          </div>
          <slot name="footer" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entity-form-shell {
  container: entity-form-shell / inline-size;
}

.entity-form-shell__layout {
  grid-template-columns: minmax(0, 1fr);
}

@container entity-form-shell (min-width: 48rem) {
  .entity-form-shell__layout[data-has-sections="true"] {
    grid-template-columns: 9rem minmax(0, 1fr);
  }

  .entity-form-shell__sections {
    display: block;
  }
}
</style>
