<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceImportSource, CentralInvoiceItem } from '~/lib/invoice/central-contract'
import { nextTick, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { parseInvoiceSession } from '~/lib/invoice/central-bootstrap'
import { CentralInvoiceProblem } from '~/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createInvoiceImportCatalogReader } from '~/lib/invoice/central-import-preview'
import { bindReadAuthority } from '~/lib/read-model/authority'
import CentralInvoiceImportPreview from './CentralInvoiceImportPreview.vue'

type Context = ReturnType<typeof parseInvoiceSession>
interface PreviewInput { fields: CentralInvoiceFields, items: CentralInvoiceItem[], source: CentralInvoiceImportSource }
const services = shallowRef<{
  identity: Context
  loadCatalog: ReturnType<typeof createInvoiceImportCatalogReader>
  preview: (input: PreviewInput) => ReturnType<ReturnType<typeof createCentralInvoiceHttp>['previewImport']>
} | null>(null)
const screen = shallowRef<InstanceType<typeof CentralInvoiceImportPreview> | null>(null)
const authorized = shallowRef(false)
const retryButton = shallowRef<HTMLButtonElement | null>(null)
const busy = shallowRef(false)
const error = shallowRef('')
let generation = 0
let active = true
let previousFocus: HTMLElement | null = null

function invalidateAuthority(message: string) {
  generation++
  const focused = typeof document === 'undefined' ? null : document.activeElement
  if (typeof HTMLElement !== 'undefined' && focused instanceof HTMLElement && screen.value?.$el instanceof HTMLElement && screen.value.$el.contains(focused))
    previousFocus = focused
  screen.value?.invalidateAuthority()
  authorized.value = false
  busy.value = false
  error.value = `${message} 本地文件和映射保留，请恢复身份后重新读取。`
  void nextTick(() => {
    if (active && !authorized.value)
      retryButton.value?.focus()
  })
}
bindReadAuthority(problem => invalidateAuthority(problem.message))
onBeforeUnmount(() => {
  active = false
  generation++
})
const fingerprint = (value: Context) => JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])

async function load() {
  if (busy.value)
    return
  busy.value = true
  const epoch = generation
  try {
    const fetcher = (url: string, options?: { method?: 'GET' | 'POST', query?: Record<string, unknown>, body?: unknown }) => {
      const body = options?.body
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body)))
        throw new Error('发票预览请求格式无效。')
      return $fetch<unknown, string>(url, { ...options, body, retry: 0 })
    }
    const context = async () => parseInvoiceSession(await fetcher('/api/read/business-session'))
    const identity = await context()
    const expected = fingerprint(identity)
    const client = createCentralInvoiceHttp(fetcher, identity)
    const reader = createInvoiceImportCatalogReader({ identity, context, fetcher })
    async function guard<T>(operation: () => Promise<T>): Promise<T> {
      if (!active || generation !== epoch || fingerprint(await context()) !== expected || generation !== epoch)
        throw new CentralInvoiceProblem('forbidden', '发票预览身份或权限已变化。')
      const result = await operation()
      if (!active || generation !== epoch || fingerprint(await context()) !== expected || generation !== epoch)
        throw new CentralInvoiceProblem('forbidden', '发票预览身份或权限已变化。')
      return result
    }
    const loadCatalog = () => guard(reader)
    const preview = (input: PreviewInput) => guard(async () => {
      const result = await client.previewImport(input)
      if (JSON.stringify([...result.meta.capabilities].sort()) !== JSON.stringify([...identity.capabilities].sort()))
        throw new CentralInvoiceProblem('forbidden', '发票预览身份或权限已变化。')
      return result
    })
    if (!active || epoch !== generation)
      return
    const previous = services.value?.identity
    if (previous && (previous.workspaceId !== identity.workspaceId || previous.actorId !== identity.actorId)) {
      services.value = null
      previousFocus = null
      await nextTick()
    }
    if (!active || epoch !== generation)
      return
    const retryWasFocused = typeof document !== 'undefined' && document.activeElement === retryButton.value
    services.value = { identity, loadCatalog, preview }
    authorized.value = true
    error.value = ''
    await nextTick()
    if (active && epoch === generation) {
      if (previousFocus?.isConnected && typeof HTMLElement !== 'undefined' && screen.value?.$el instanceof HTMLElement && screen.value.$el.contains(previousFocus))
        previousFocus.focus({ preventScroll: true })
      else if (retryWasFocused && typeof HTMLElement !== 'undefined' && screen.value?.$el instanceof HTMLElement)
        screen.value.$el.focus({ preventScroll: true })
      previousFocus = null
    }
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '发票预览来源暂不可用。'
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <div>
    <p v-if="error" role="alert" class="p-3 text-danger">
      {{ error }} <button ref="retryButton" type="button" :aria-disabled="busy" class="underline" @click="load">
        重新读取
      </button>
    </p>
    <p v-if="busy" role="status" class="p-4">
      正在读取发票预览来源…
    </p>
    <CentralInvoiceImportPreview v-if="services" v-show="authorized" ref="screen" tabindex="-1" :aria-hidden="!authorized" :inert="!authorized" :load-catalog="services.loadCatalog" :preview="services.preview" @authority-lost="invalidateAuthority" />
  </div>
</template>
