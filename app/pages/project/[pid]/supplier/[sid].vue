<script setup lang="ts">
import ProjectSupplierWorkbench from '~/pages/project/[pid]/supplier/_components/ProjectSupplierWorkbench.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.pid ?? ''))
const supplierId = computed(() => String(route.params.sid ?? ''))
</script>

<template>
  <ProjectSupplierWorkbench :project-id="projectId" :supplier-id="supplierId" />
</template>
