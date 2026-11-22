<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'

defineProps<{ origin: DataOriginDTO }>()
</script>

<template>
  <KitStatusTag :tone="origin === 'demo' ? 'warn' : 'brand'">
    {{ origin === 'demo' ? '演示' : '正式' }}
  </KitStatusTag>
</template>
