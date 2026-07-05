<script setup lang="ts">
import { DialogDescription, type DialogDescriptionProps, useForwardProps } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<DialogDescriptionProps & { class?: any }>()
const delegated = computed(() => {
  const { class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <DialogDescription v-bind="forwarded" :class="cn('text-13px text-ink-soft', props.class)">
    <slot />
  </DialogDescription>
</template>
