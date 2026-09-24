<script setup lang="ts">
import { useId } from 'vue'

export interface ReadOnlyField {
  label: string
  value: string | number | null | undefined
  wide?: boolean
  numeric?: boolean
}

defineProps<{
  title: string
  fields: ReadOnlyField[]
}>()

const headingId = useId()
</script>

<template>
  <section class="readonly-section min-w-0 bg-panel" :aria-labelledby="headingId">
    <h3 :id="headingId" class="readonly-section__heading">
      {{ title }}
    </h3>
    <dl class="readonly-section__fields">
      <div
        v-for="field in fields"
        :key="field.label"
        class="readonly-section__field"
        :class="{ 'readonly-section__field--wide': field.wide }"
      >
        <dt class="readonly-section__label">
          {{ field.label }}
        </dt>
        <dd class="readonly-section__value" :class="{ 'tabular-nums': field.numeric }">
          {{ field.value === null || field.value === undefined || field.value === '' ? '—' : field.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.readonly-section {
  container: readonly-section / inline-size;
}

.readonly-section__heading {
  margin: 0;
  border-bottom: 1px solid var(--line);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
  color: var(--ink);
}

.readonly-section__fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px 28px;
  margin: 0;
  padding: 18px 16px 22px;
}

.readonly-section__field {
  min-width: 0;
}

.readonly-section__field--wide {
  grid-column: 1 / -1;
}

.readonly-section__label {
  margin-bottom: 5px;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 18px;
}

.readonly-section__value {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 21px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@container readonly-section (min-width: 28rem) {
  .readonly-section__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container readonly-section (min-width: 48rem) {
  .readonly-section__fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
