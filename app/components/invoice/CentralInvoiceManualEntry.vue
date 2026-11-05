<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { createInvoiceWorkspaceFromSession, parseInvoiceSession } from '~/lib/invoice/central-bootstrap'
import { bindReadAuthority } from '~/lib/read-model/authority'
import CentralInvoiceManualCreate from './CentralInvoiceManualCreate.vue'

const emit = defineEmits<{ saved: [id: string] }>()
const config = useRuntimeConfig()
const workspace = shallowRef<Awaited<ReturnType<typeof createInvoiceWorkspaceFromSession>> | null>(null)
const identity = shallowRef('')
const authorized = shallowRef(false)
const busy = shallowRef(false)
const error = shallowRef('')
let generation = 0
let active = true
function invalidate(message: string) {
  generation++
  authorized.value = false
  busy.value = false
  error.value = `${message} 当前输入保留，请恢复身份后重新读取。`
}
bindReadAuthority(problem => invalidate(problem.message))
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load() {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  const epoch = generation
  try {
    const fetcher = (url: string, options?: { method?: 'GET' | 'POST', query?: Record<string, unknown>, body?: unknown }) => {
      const body = options?.body
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body)))
        throw new Error('发票请求格式无效。')
      return $fetch<unknown, string>(url, { ...options, body, retry: 0 })
    }
    const current = parseInvoiceSession(await fetcher('/api/read/business-session'))
    const key = JSON.stringify([current.workspaceId, current.actorId])
    const next = await createInvoiceWorkspaceFromSession({ fetcher, basePath: config.app.baseURL })
    await next.load()
    const again = parseInvoiceSession(await fetcher('/api/read/business-session'))
    if (JSON.stringify([again.workspaceId, again.actorId, [...again.capabilities].sort()]) !== JSON.stringify([current.workspaceId, current.actorId, [...current.capabilities].sort()]))
      throw new Error('读取发票期间身份或权限已变化。')
    if (!active || epoch !== generation)
      return
    identity.value = key
    workspace.value = next
    authorized.value = true
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '发票工作区暂不可用。'
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="h-full">
    <p v-if="error || (workspace && workspace.readState.value !== 'ready')" role="alert" class="p-3 text-danger">
      {{ error || '发票来源或权限已变化，当前输入保留，请重新读取。' }}
      <button type="button" :disabled="busy" class="underline" @click="load">
        重新读取
      </button>
    </p>
    <CentralInvoiceManualCreate v-if="workspace" v-show="authorized && workspace.readState.value === 'ready'" :key="identity" :workspace="workspace" :inert="!authorized || workspace.readState.value !== 'ready'" @saved="emit('saved', $event)" />
    <p v-else-if="!error" role="status" class="p-4">
      正在读取发票工作区…
    </p>
  </div>
</template>
