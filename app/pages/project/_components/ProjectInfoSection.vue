<script setup lang="ts">
import { useId } from 'vue'

export interface ProjectInfoField {
  key: string
  label: string
  value: string
  span?: 2 | 3 | 'full'
}

defineProps<{
  title: string
  fields: readonly ProjectInfoField[]
}>()

const headingId = `project-info-${useId()}`
</script>

<template>
  <section
    role="group"
    :aria-labelledby="headingId"
    data-ui="project-info-section"
    class="project-info-section"
  >
    <header class="project-info-section__header">
      <h4 :id="headingId" class="m-0 text-13px font-700 text-ink">
        {{ title }}
      </h4>
    </header>

    <dl class="project-info-section__grid m-0">
      <div
        v-for="field in fields"
        :key="field.key"
        class="project-info-section__item"
        :data-info-span="field.span"
      >
        <dt class="text-10px leading-4 text-ink-faint">
          {{ field.label }}
        </dt>
        <dd class="m-0 break-words text-12px leading-5 text-ink">
          {{ field.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.project-info-section {
  min-width: 0;
  container-type: inline-size;
}

.project-info-section__header {
  display: flex;
  min-height: 2rem;
  align-items: center;
  border-bottom: 1px solid var(--line);
  background: transparent;
}

.project-info-section__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12.5rem), 1fr));
  gap: 1rem 2rem;
  padding: 0.75rem 0 1.25rem;
  background: transparent;
}

.project-info-section__item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  background: transparent;
}

.project-info-section__item[data-info-span="2"] {
  grid-column: span 2;
}

.project-info-section__item[data-info-span="3"] {
  grid-column: span 3;
}

.project-info-section__item[data-info-span="full"] {
  grid-column: 1 / -1;
}

@container (max-width: 42rem) {
  .project-info-section__item[data-info-span="3"] {
    grid-column: 1 / -1;
  }
}

@container (max-width: 27rem) {
  .project-info-section__item[data-info-span] {
    grid-column: 1 / -1;
  }
}
</style>
