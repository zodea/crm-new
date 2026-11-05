<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { createInvoiceMigrationFromSession } from '~/lib/invoice/central-migration-bootstrap'
import { bindReadAuthority } from '~/lib/read-model/authority'
import InvoiceMigrationPanel from './InvoiceMigrationPanel.vue'

const services = shallowRef<Awaited<ReturnType<typeof createInvoiceMigrationFromSession>> | null>(null)
const busy = shallowRef(false)
const error = shallowRef('')
let generation = 0
let active = true
bindReadAuthority((problem) => {
  generation++
  services.value = null
  busy.value = false
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load() {
  if (busy.value)
    return
  const epoch = generation
  busy.value = true
  error.value = ''
  try {
    const next = await createInvoiceMigrationFromSession({ fetcher: (url, options) => {
      const body = options?.body
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body)))
        throw new Error('发票迁入请求格式无效。')
      return $fetch<unknown, string>(url, { ...options, body, retry: 0 })
    } })
    if (active && epoch === generation)
      services.value = next
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '发票迁入身份暂不可用。'
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <InvoiceMigrationPanel v-if="services" :session="services.session" :preview-client="services.previewClient" :catalog-client="services.catalogClient" :load-buyers="services.loadBuyers" />
  <section v-else class="grid gap-2 rounded border border-line bg-panel p-4" aria-label="旧发票迁入">
    <h2 class="m-0 text-base font-700">
      旧发票迁入
    </h2>
    <p v-if="error" role="alert" class="m-0 text-sm text-danger">
      {{ error }}
    </p>
    <p v-else role="status" class="m-0 text-sm">
      正在读取迁入身份…
    </p>
    <button v-if="error" type="button" :disabled="busy" class="w-fit rounded border border-line px-3 py-1" @click="load">
      重新读取
    </button>
  </section>
</template>
