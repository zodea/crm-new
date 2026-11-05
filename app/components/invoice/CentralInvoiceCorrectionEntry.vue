<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { InvoiceCatalogKey, InvoiceMigrationCatalog } from '~/lib/invoice/central-migration-catalog'
import { nextTick, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { parseInvoiceSession } from '~/lib/invoice/central-bootstrap'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createInvoiceWorkspaceCatalogClient } from '~/lib/invoice/central-migration-catalog'
import { createInvoiceCorrectionHttp } from '~/lib/invoice/correction-http'
import { createInvoiceCorrectionSession } from '~/lib/invoice/correction-session'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import CentralInvoiceCorrectionScreen from './CentralInvoiceCorrectionScreen.vue'

const props = defineProps<{ invoiceId: string }>()
const services = shallowRef<{ identity: ReturnType<typeof parseInvoiceSession>, client: ReturnType<typeof createInvoiceCorrectionHttp>, session: ReturnType<typeof createInvoiceCorrectionSession>, getInvoice: () => Promise<CentralInvoiceRecord> } | null>(null)
const screen = shallowRef<InstanceType<typeof CentralInvoiceCorrectionScreen> | null>(null)
const authorized = shallowRef(false)
const retryButton = shallowRef<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
const catalog = shallowRef<InvoiceMigrationCatalog>({ projects: [], suppliers: [], contracts: [] })
const signatories = shallowRef<Array<{ id: string, label: string, version: string }>>([])
const missing = shallowRef<string[]>([])
const busy = shallowRef(false)
const error = shallowRef('')
const keys: InvoiceCatalogKey[] = ['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company']
let generation = 0
let active = true
function invalidateAuthority(message: string) {
  generation++
  const focused = typeof document === 'undefined' ? null : document.activeElement
  if (typeof HTMLElement !== 'undefined' && focused instanceof HTMLElement && screen.value?.$el instanceof HTMLElement && screen.value.$el.contains(focused))
    previousFocus = focused
  authorized.value = false
  catalog.value = { projects: [], suppliers: [], contracts: [] }
  signatories.value = []
  missing.value = [...keys, 'signatories']
  busy.value = false
  error.value = `${message} 当前输入保留，请恢复身份后重新读取资料。`
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
        throw new Error('更正请求格式无效。')
      return $fetch<unknown, string>(url, { ...options, body, retry: 0 })
    }
    const context = async () => parseInvoiceSession(await fetcher('/api/read/business-session'))
    const identity = await context()
    const fingerprint = (value: typeof identity) => JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])
    const invoiceClient = createCentralInvoiceHttp(fetcher, identity)
    const client = createInvoiceCorrectionHttp({ identity, context, fetcher })
    const getInvoice = async () => (await invoiceClient.get(props.invoiceId, true)).record
    const session = createInvoiceCorrectionSession({ identity, invoiceId: props.invoiceId, repository: client, invoiceVersion: async () => (await getInvoice()).version, context })
    const catalogClient = createInvoiceWorkspaceCatalogClient({ identity, context, fetcher })
    const [reads, signatoryRead] = await Promise.all([
      Promise.allSettled(keys.map(key => catalogClient.load([key]))),
      createOurSignatoryRepository(fetcher).list().then(value => ({ value })).catch(() => null),
    ])
    if (fingerprint(await context()) !== fingerprint(identity))
      throw new Error('读取更正资料期间身份或权限已变化。')
    if (!active || epoch !== generation)
      return
    const previous = services.value?.identity
    if (previous && (previous.workspaceId !== identity.workspaceId || previous.actorId !== identity.actorId)) {
      services.value = null
      await nextTick()
    }
    else if (previous && !authorized.value) {
      if (!screen.value)
        throw new Error('更正页面尚未就绪，请重新读取。')
      await screen.value.revalidate(getInvoice, client)
      if (fingerprint(await context()) !== fingerprint(identity))
        throw new Error('核对更正资料期间身份或权限已变化。')
      if (!active || epoch !== generation)
        return
    }
    if (!active || epoch !== generation)
      return
    const next: InvoiceMigrationCatalog = { projects: [], suppliers: [], contracts: [] }
    const gaps: string[] = []
    reads.forEach((read, index) => {
      if (read.status === 'rejected') {
        gaps.push(keys[index]!)
        return
      }
      next.projects.push(...read.value.projects)
      next.suppliers.push(...read.value.suppliers)
      next.contracts.push(...read.value.contracts)
    })
    const meta = signatoryRead?.value.meta
    if (!signatoryRead || !meta || meta.workspaceId !== identity.workspaceId || meta.actorId !== identity.actorId || meta.authorizedScope.coverage !== 'complete'
      || !meta.capabilities.includes('our-signatory:read') || JSON.stringify([...meta.capabilities].sort()) !== JSON.stringify([...identity.capabilities].sort())
      || meta.sources.length !== 1 || meta.sources[0]?.key !== 'our-signatories' || meta.sources[0]?.state !== 'readable' || !meta.sources[0]?.sourceVersion) {
      gaps.push('signatories')
      signatories.value = []
    }
    else {
      signatories.value = signatoryRead.value.records.filter(record => record.draft.status === 'active').map(record => ({ id: record.id, label: record.draft.name, version: record.version }))
    }
    catalog.value = next
    missing.value = gaps
    services.value = { identity, client, session, getInvoice }
    authorized.value = true
    await nextTick()
    if (active && epoch === generation) {
      if (previousFocus?.isConnected && typeof HTMLElement !== 'undefined' && screen.value?.$el instanceof HTMLElement && screen.value.$el.contains(previousFocus))
        previousFocus.focus({ preventScroll: true })
      previousFocus = null
    }
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '更正资料暂不可用。'
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
    <p v-if="error" role="alert" class="p-3 text-danger">
      {{ error }} <button ref="retryButton" type="button" :disabled="busy" class="underline" @click="load">
        重新读取
      </button>
    </p>
    <CentralInvoiceCorrectionScreen v-if="services" v-show="authorized" ref="screen" :aria-hidden="!authorized" :inert="!authorized" :invoice-id="invoiceId" :identity="services.identity" :client="services.client" :session="services.session" :get-invoice="services.getInvoice" :catalog="catalog" :signatories="signatories" :missing="missing" @authority-lost="invalidateAuthority" />
    <p v-else-if="!error" role="status" class="p-4">
      正在读取发票和更正资料…
    </p>
  </div>
</template>
