<script setup lang="ts">
const route = useRoute()

const projectId = computed(() => String(route.query.project ?? ''))
const initialBoqLineId = computed(() => String(route.query.boqLine ?? ''))
</script>

<template>
  <QuantityTemplateFormPage
    :project-id="projectId"
    :initial-boq-line-id="initialBoqLineId"
  />
</template>
