<script setup lang="ts">
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { contractStatusTone } from '~/lib/contract/status'

defineProps<{ status: string | null }>()
</script>

<template>
  <KitStatusTag :tone="contractStatusTone(status)">
    {{ status }}
  </KitStatusTag>
</template>
