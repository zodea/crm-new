<script setup lang="ts">
// 薄路由（#103 切片 6A）：参数身份已冻结为 pid=项目 id、uid=户 id（见 ADR 0010 / handoff 决策门）。
const route = useRoute()

const projectId = computed(() => String(route.params.pid ?? ''))
const unitId = computed(() => String(route.params.uid ?? ''))
</script>

<template>
  <QuantityUnitDetailScreen :project-id="projectId" :unit-id="unitId" />
</template>
