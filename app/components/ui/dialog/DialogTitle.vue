<script setup lang="ts">
import type { DialogTitleProps } from 'reka-ui'
import { DialogTitle, useForwardProps } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<DialogTitleProps & { class?: any }>()
const delegated = computed(() => {
  const { class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <DialogTitle v-bind="forwarded" :class="cn('text-14px font-800 text-ink', props.class)">
    <slot />
  </DialogTitle>
</template>
