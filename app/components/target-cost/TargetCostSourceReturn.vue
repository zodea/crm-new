<script setup lang="ts">
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { targetCostSourceContext } from '~/lib/target-cost/navigation'
import { toErrorMessage } from '~/lib/util/error'

const route = useRoute()
const { $repositories } = useNuxtApp()
const context = computed(() => targetCostSourceContext(route.path, route.query))
const verified = shallowRef<{ returnTo: string, label: string } | null>(null)
const error = shallowRef('')
let active = true
let sequence = 0
async function verify() {
  const target = context.value
  const request = ++sequence
  verified.value = null
  error.value = ''
  if (!target || !active)
    return
  try {
    const read = await $repositories.targetCosts.detail({ origin: target.origin }, target.id)
    if (!active || request !== sequence)
      return
    if (read.targetCostId !== target.id || read.context.origin !== target.origin || read.view.header.projectId !== target.projectId)
      throw new Error('预算版本与原项目关系不一致，请从预算列表重新核对')
    if (!read.context.capabilities.includes('target-cost:read'))
      throw new Error('当前身份无权读取原预算版本')
    verified.value = { returnTo: target.returnTo, label: read.view.header.name || '未填写版本名' }
  }
  catch (cause) {
    if (active && request === sequence)
      error.value = toErrorMessage(cause)
  }
}
watch(context, verify, { immediate: true })
onDeactivated(() => {
  active = false
  sequence += 1
})
onActivated(() => {
  if (!active) {
    active = true
    void verify()
  }
})
onScopeDispose(() => {
  active = false
  sequence += 1
})
</script>

<template>
  <div v-if="context" class="my-3 min-w-0 text-12px" aria-label="返回来源预算">
    <NuxtLink v-if="verified" :to="verified.returnTo" class="inline-flex max-w-full break-words text-brand hover:underline">
      返回预算版本 · {{ verified.label }}
    </NuxtLink>
    <p v-else-if="error" role="status" class="text-danger">
      {{ error }}
    </p>
    <p v-else class="text-ink-faint">
      正在核对原预算版本…
    </p>
  </div>
</template>
