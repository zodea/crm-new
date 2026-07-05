<script setup lang="ts">
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: any }>()
</script>

<template>
  <div :class="cn('flex justify-end gap-2 mt-5', props.class)">
    <slot />
  </div>
</template>
