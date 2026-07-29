<script setup lang="ts">
const route = useRoute()
const crewId = computed(() => String(route.params.id ?? ''))
</script>

<template>
  <CrewDetailScreen :crew-id="crewId" />
</template>
