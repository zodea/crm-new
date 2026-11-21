<script setup lang="ts">
import QuantityStageFormPage from '~/components/quantity/QuantityStageFormPage.vue'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const origin = computed(() => route.query.origin === undefined ? 'real' : isDataOriginDTO(route.query.origin) ? route.query.origin : null)
</script>

<template>
  <QuantityStageFormPage :project-id="projectId" :origin="origin" />
</template>
