<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { TARGET_COST_LIST_PATH, targetCostReturnTo } from '~/lib/target-cost/navigation'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ projectId: string, origin: DataOriginDTO, returnTo: unknown }>()
const listStore = useTargetCostListStore()
const detailStore = useTargetCostDetailStore()
const candidate = computed(() => targetCostReturnTo(props.returnTo, props.origin))
const verified = shallowRef<string | null>(null)
const error = shallowRef('')
const label = computed(() => verified.value && new URL(verified.value, 'https://ruihang.invalid').pathname === TARGET_COST_LIST_PATH ? '返回目标成本列表' : '返回预算版本')
let sequence = 0
let active = true
async function verify() {
  const request = ++sequence
  const target = { projectId: props.projectId, origin: props.origin, to: candidate.value }
  verified.value = null
  error.value = ''
  if (!target.to || !active)
    return
  try {
    const url = new URL(target.to, 'https://ruihang.invalid')
    if (url.pathname === TARGET_COST_LIST_PATH) {
      const read = await listStore.load(target.origin)
      if (!active || sequence !== request)
        return
      if (read.context.origin !== target.origin || !read.context.capabilities.includes('target-cost:read') || !read.rows.some(row => row.projectId === target.projectId))
        throw new Error('当前无法核对原预算与此项目的关系')
    }
    else {
      const id = decodeURIComponent(url.pathname.slice(`${TARGET_COST_LIST_PATH}/`.length))
      const read = await detailStore.loadCentral(id, target.origin)
      if (!active || sequence !== request)
        return
      if (read.context.origin !== target.origin || !read.context.capabilities.includes('target-cost:read') || read.targetCostId !== id || read.view.header.projectId !== target.projectId)
        throw new Error('原预算版本与此项目关系已不一致')
    }
    verified.value = target.to
  }
  catch (cause) {
    if (active && sequence === request)
      error.value = toErrorMessage(cause)
  }
}
watch(() => [props.projectId, props.origin, candidate.value], verify, { immediate: true })
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
  <div v-if="candidate" class="panel mb-3 p-3 text-12px" aria-label="返回来源预算">
    <NuxtLink v-if="verified" :to="verified" class="text-brand hover:underline">
      {{ label }}
    </NuxtLink>
    <p v-else-if="error" role="status" class="text-danger">
      {{ error }}，请从目标成本列表重新核对。
    </p>
    <p v-else class="text-ink-faint">
      正在核对原预算与此项目的关系…
    </p>
  </div>
</template>
