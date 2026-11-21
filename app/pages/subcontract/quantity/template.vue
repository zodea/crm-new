<script setup lang="ts">
import QuantityTemplateFormPage from '~/components/quantity/QuantityTemplateFormPage.vue'
import { readQuantityOrigin } from '~/lib/quantity/navigation'

const route = useRoute()

const projectId = computed(() => String(route.query.project ?? ''))
const initialBoqLineId = computed(() => String(route.query.boqLine ?? ''))
const origin = computed(() => readQuantityOrigin(route.query.origin === 'schedule' && route.query.return === 'region' ? { ...route.query, origin: 'real' } : route.query))
</script>

<template>
  <QuantityTemplateFormPage
    :project-id="projectId"
    :initial-boq-line-id="initialBoqLineId"
    :origin="origin"
  />
</template>
