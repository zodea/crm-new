<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed } from 'vue'
import SegTab from '../ui/SegTab.vue'

type PaneKey = 'queue' | 'source' | 'review'

const props = withDefaults(defineProps<{
  labels: Readonly<Record<PaneKey, string>>
  wideColumns?: string
}>(), {
  wideColumns: 'minmax(12rem, 18rem) minmax(18rem, 0.95fr) minmax(20rem, 1.05fr)',
})

const activePane = defineModel<PaneKey>({ required: true })

const tabs = computed(() => (['queue', 'source', 'review'] as const).map(key => ({
  key,
  label: props.labels[key],
})))

const workbenchStyle = computed<CSSProperties>(() => ({
  '--workbench-columns': props.wideColumns,
}))
</script>

<template>
  <div
    class="adaptive-workbench min-w-0"
    :data-active-pane="activePane"
    :style="workbenchStyle"
  >
    <div class="adaptive-workbench__tabs panel mb-3 overflow-hidden px-3" data-workbench-tabs>
      <SegTab v-model="activePane" :tabs="tabs" />
    </div>

    <div class="adaptive-workbench__panes">
      <section
        v-for="pane in tabs"
        :key="pane.key"
        class="adaptive-workbench__pane"
        :data-pane="pane.key"
        :aria-label="pane.label"
      >
        <slot :name="pane.key" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.adaptive-workbench {
  container-type: inline-size;
}

.adaptive-workbench__tabs {
  display: none;
}

.adaptive-workbench__panes {
  display: grid;
  min-width: 0;
  block-size: clamp(24rem, 72dvh, 52rem);
  grid-template-columns: var(--workbench-columns);
  gap: 0.75rem;
}

.adaptive-workbench__pane {
  min-width: 0;
  min-height: 0;
}

@container (max-width: 59.999rem) {
  .adaptive-workbench__tabs {
    display: block;
  }

  .adaptive-workbench__panes {
    display: block;
  }

  .adaptive-workbench__pane {
    display: none;
    width: 100%;
    height: 100%;
  }

  .adaptive-workbench[data-active-pane="queue"] .adaptive-workbench__pane[data-pane="queue"],
  .adaptive-workbench[data-active-pane="source"] .adaptive-workbench__pane[data-pane="source"],
  .adaptive-workbench[data-active-pane="review"] .adaptive-workbench__pane[data-pane="review"] {
    display: block;
  }
}
</style>
