<script setup lang="ts">
import type { InvoiceCatalogKey, InvoiceMigrationCatalog } from '~/lib/invoice/central-migration-catalog'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { createInvoiceWorkspaceFromSession, parseInvoiceSession } from '~/lib/invoice/central-bootstrap'
import { createInvoiceWorkspaceCatalogClient } from '~/lib/invoice/central-migration-catalog'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import CentralInvoiceLedgerScreen from './CentralInvoiceLedgerScreen.vue'
import CentralInvoiceWorkspaceScreen from './CentralInvoiceWorkspaceScreen.vue'

defineProps<{ mode: 'workspace' | 'ledger', initialSelectedId?: string | null }>()
const emit = defineEmits<{ open: [id: string] }>()
const config = useRuntimeConfig()
const workspace = shallowRef<Awaited<ReturnType<typeof createInvoiceWorkspaceFromSession>> | null>(null)
const catalog = shallowRef<InvoiceMigrationCatalog>({ projects: [], suppliers: [], contracts: [] })
const projectsReadable = shallowRef(false)
const projectsRetrying = shallowRef(false)
const projectsRetryError = shallowRef('')
const catalogClient = shallowRef<ReturnType<typeof createInvoiceWorkspaceCatalogClient> | null>(null)
const gaps = shallowRef<string[]>([])
const signatories = shallowRef<Array<{ id: string, label: string, version: string }>>([])
const busy = shallowRef(false)
const error = shallowRef('')
const keys: InvoiceCatalogKey[] = ['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company']
const labels: Record<InvoiceCatalogKey, string> = { projects: '项目', suppliers: '分供方', construction: '施工合同', subcontract: '分包合同', material: '采购合同', auxiliary: '其他支出合同', company: '公司支出合同' }
let active = true
let generation = 0
let projectReadGeneration = 0
bindReadAuthority((problem) => {
  generation++
  projectReadGeneration++
  workspace.value = null
  catalog.value = { projects: [], suppliers: [], contracts: [] }
  projectsReadable.value = false
  projectsRetrying.value = false
  projectsRetryError.value = ''
  catalogClient.value = null
  gaps.value = []
  signatories.value = []
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
    const context = async () => parseInvoiceSession(await fetcher('/api/read/business-session'))
    const initial = await context()
    const fingerprint = (value: typeof initial) => JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])
    const nextWorkspace = await createInvoiceWorkspaceFromSession({ fetcher, basePath: config.app.baseURL })
    const client = createInvoiceWorkspaceCatalogClient({ identity: initial, context, fetcher })
    const [reads, signatoryRead] = await Promise.all([
      Promise.allSettled(keys.map(key => client.load([key]))),
      createOurSignatoryRepository(fetcher).list().then(value => ({ value })).catch(() => null),
    ])
    if (fingerprint(await context()) !== fingerprint(initial))
      throw new Error('读取发票目录期间身份或权限已变化，请重新读取。')
    if (!active || epoch !== generation)
      return
    const next: InvoiceMigrationCatalog = { projects: [], suppliers: [], contracts: [] }
    const missing: string[] = []
    reads.forEach((read, index) => {
      if (read.status === 'rejected') {
        missing.push(labels[keys[index]!])
        return
      }
      next.projects.push(...read.value.projects)
      next.suppliers.push(...read.value.suppliers)
      next.contracts.push(...read.value.contracts)
    })
    const signatoryMeta = signatoryRead?.value.meta
    if (!signatoryRead || !signatoryMeta || signatoryMeta.workspaceId !== initial.workspaceId || signatoryMeta.actorId !== initial.actorId
      || signatoryMeta.authorizedScope.coverage !== 'complete' || !signatoryMeta.capabilities.includes('our-signatory:read')
      || JSON.stringify([...signatoryMeta.capabilities].sort()) !== JSON.stringify([...initial.capabilities].sort())
      || signatoryMeta.sources.length !== 1 || signatoryMeta.sources[0]?.key !== 'our-signatories' || signatoryMeta.sources[0]?.state !== 'readable'
      || !signatoryMeta.sources[0]?.sourceVersion) {
      missing.push('我方主体')
      signatories.value = []
    }
    else {
      signatories.value = signatoryRead.value.records.filter(record => record.draft.status === 'active').map(record => ({ id: record.id, label: record.draft.name, version: record.version }))
    }
    catalog.value = next
    projectsReadable.value = reads[0]?.status === 'fulfilled'
    catalogClient.value = client
    gaps.value = missing
    workspace.value = nextWorkspace
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = cause instanceof Error ? cause.message : '发票工作区暂时不可用。'
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
onMounted(load)
async function verifyProjects() {
  const client = catalogClient.value
  if (!client)
    throw new Error('项目目录尚不可用。')
  const epoch = generation
  const projectEpoch = ++projectReadGeneration
  try {
    const projects = (await client.load(['projects'])).projects
    if (!active || epoch !== generation || projectEpoch !== projectReadGeneration || catalogClient.value !== client)
      throw new Error('项目目录来源已变化，请重新读取。')
    catalog.value = { ...catalog.value, projects }
    projectsReadable.value = true
    gaps.value = gaps.value.filter(gap => gap !== '项目')
    return projects
  }
  catch (cause) {
    if (active && epoch === generation && projectEpoch === projectReadGeneration && catalogClient.value === client) {
      catalog.value = { ...catalog.value, projects: [] }
      projectsReadable.value = false
      if (!gaps.value.includes('项目'))
        gaps.value = [...gaps.value, '项目']
    }
    throw cause
  }
}
async function retryProjects() {
  if (projectsRetrying.value)
    return
  const epoch = generation
  projectsRetrying.value = true
  projectsRetryError.value = ''
  try {
    await verifyProjects()
  }
  catch (cause) {
    if (active && epoch === generation)
      projectsRetryError.value = cause instanceof Error ? cause.message : '项目目录暂不可用，请重试。'
  }
  finally {
    if (active && epoch === generation)
      projectsRetrying.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <p v-if="gaps.length" role="status" class="p-3 text-sm text-warn-ink">
      以下资料目录暂不可用或无读取权限：{{ gaps.join('、') }}。相关选择暂不可用，请核对权限或稍后重新读取。
    </p>
    <div v-if="workspace && mode === 'ledger' && !projectsReadable" class="flex flex-wrap items-center gap-2 px-3 text-sm">
      <button type="button" :disabled="projectsRetrying" class="rounded border border-line px-3 py-1" @click="retryProjects">
        {{ projectsRetrying ? '正在读取项目目录…' : '重新读取项目目录' }}
      </button>
      <p v-if="projectsRetryError" role="alert" class="text-danger">
        {{ projectsRetryError }}
      </p>
    </div>
    <CentralInvoiceWorkspaceScreen v-if="workspace && mode === 'workspace'" class="min-h-0 flex-1" :workspace="workspace" :projects="catalog.projects" :suppliers="catalog.suppliers" :signatories="signatories" :contracts="catalog.contracts" :initial-selected-id="initialSelectedId" />
    <CentralInvoiceLedgerScreen v-else-if="workspace" class="min-h-0 flex-1" :workspace="workspace" :projects="catalog.projects" :projects-readable="projectsReadable" :verify-projects="verifyProjects" @open="emit('open', $event)" />
    <section v-else class="grid gap-2 p-4" aria-label="发票工作区">
      <p v-if="error" role="alert">
        {{ error }}
      </p>
      <p v-else role="status">
        正在读取发票工作区…
      </p>
      <button v-if="error" type="button" :disabled="busy" class="w-fit rounded border border-line px-3 py-1" @click="load">
        重新读取
      </button>
    </section>
  </div>
</template>
