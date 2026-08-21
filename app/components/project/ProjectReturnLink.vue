<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

const props = defineProps<{
  to: string
  expiresAt?: number
}>()

const currentTime = shallowRef(Date.now())
let expiryTimer: ReturnType<typeof setTimeout> | undefined

const target = computed(() => props.expiresAt != null && currentTime.value >= props.expiresAt
  ? '/project'
  : props.to)

function scheduleExpiry() {
  if (expiryTimer)
    clearTimeout(expiryTimer)
  currentTime.value = Date.now()
  if (props.expiresAt == null || props.expiresAt <= currentTime.value)
    return
  expiryTimer = setTimeout(() => {
    currentTime.value = Date.now()
  }, props.expiresAt - currentTime.value + 1)
}

onMounted(scheduleExpiry)
watch(() => props.expiresAt, scheduleExpiry)
onBeforeUnmount(() => {
  if (expiryTimer)
    clearTimeout(expiryTimer)
})
</script>

<template>
  <NuxtLink :to="target" class="btn-secondary flex-none">
    <span class="i-lucide-arrow-left mr-1" aria-hidden="true" />
    返回项目列表
  </NuxtLink>
</template>
