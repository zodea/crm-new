<script setup lang="ts">
import type { createInvoiceMigrationSession, InvoiceMigrationMappings } from '~/lib/invoice/central-migration'
import type { createInvoiceMigrationCatalogClient, InvoiceCatalogKey, InvoiceMigrationCatalog } from '~/lib/invoice/central-migration-catalog'
import type { createInvoiceMigrationPreview, InvoiceMappingPreview, InvoiceSourcePreview } from '~/lib/invoice/central-migration-preview'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useKitUI } from '~/composables/useKitUI'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { problemFromHttpFailure } from '~/lib/read-model/problem'

const props = defineProps<{ session: ReturnType<typeof createInvoiceMigrationSession>, previewClient: ReturnType<typeof createInvoiceMigrationPreview>, catalogClient: ReturnType<typeof createInvoiceMigrationCatalogClient>, loadBuyers?: () => Promise<Array<{ id: string, label: string, version: string }>> }>()
const { confirm } = useKitUI()
const source = shallowRef<{ sha256: string, payloadBase64: string } | null>(null)
const preview = shallowRef<InvoiceSourcePreview | null>(null)
const checked = shallowRef<InvoiceMappingPreview | null>(null)
const catalog = shallowRef<InvoiceMigrationCatalog | null>(null)
const buyers = shallowRef<Array<{ id: string, label: string, version: string }>>([])
const choices = ref<Record<string, string>>({})
const batches = shallowRef<Awaited<ReturnType<typeof props.session.state>>>([])
const pending = shallowRef<Array<{ targetId: string | null, commandId: string }>>([])
const ready = shallowRef(false)
const busy = shallowRef(false)
const error = shallowRef('')
const result = shallowRef('')
let generation = 0
let active = true
function invalidate(message: string) {
  generation++
  ready.value = false
  source.value = null
  preview.value = null
  checked.value = null
  catalog.value = null
  buyers.value = []
  choices.value = {}
  batches.value = []
  pending.value = []
  result.value = ''
  busy.value = false
  error.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
onBeforeUnmount(() => {
  active = false
  generation++
})
watch(() => [props.session, props.previewClient, props.catalogClient, props.loadBuyers], () => invalidate('来源或可用目录已变化，请重新读取并核对。'), { flush: 'sync' })
function assertCurrent(epoch: number) {
  if (!active || epoch !== generation)
    throw new Error('访问状态已变化，原提交编号仍保留。')
}
function invalidateForAuthority(cause: unknown, epoch: number) {
  const problem = problemFromHttpFailure(cause)
  if (active && epoch === generation && (['unauthenticated', 'forbidden'].includes(problem?.code ?? '')
    || (typeof props.session.identityVerified === 'function' && !props.session.identityVerified()))) {
    invalidate(problem?.message ?? '身份或权限无法核对，请恢复原会话。')
    return true
  }
  return false
}
const mappings = computed<InvoiceMigrationMappings>(() => {
  const result: InvoiceMigrationMappings = { projects: [], suppliers: [], contracts: [] }
  for (const row of preview.value?.references ?? []) {
    const chosen = choices.value[`${row.table}:${row.legacyId}`]
    if (row.table === 'contracts') {
      const option = catalog.value?.contracts.find(item => `${item.domain}:${item.id}` === chosen)
      if (option)
        result.contracts.push({ legacyId: row.legacyId, target: { domain: option.domain, id: option.id, version: option.version } })
    }
    else if (row.table === 'projects' || row.table === 'suppliers') {
      const option = catalog.value?.[row.table].find(item => item.id === chosen)
      if (option)
        result[row.table].push({ legacyId: row.legacyId, targetId: option.id, version: option.version, sourceVersion: option.sourceVersion })
    }
  }
  const companyInvoices = (preview.value?.invoices ?? []).filter(invoice => invoice.companyContractId)
  if (companyInvoices.length) {
    result.companyInvoices = []
    for (const invoice of companyInvoices) {
      const contract = catalog.value?.contracts.find(item => item.domain === 'company' && `${item.domain}:${item.id}` === choices.value[`company_expense_contracts:${invoice.companyContractId}`])
      const supplier = catalog.value?.suppliers.find(item => item.id === choices.value[`company-supplier:${invoice.legacyId}`])
      const buyer = buyers.value.find(item => item.id === choices.value[`company-buyer:${invoice.legacyId}`])
      if (contract && supplier && buyer && invoice.companyContractId && contract.supplierId === supplier.id)
        result.companyInvoices.push({ invoiceId: invoice.legacyId, legacyContractId: invoice.companyContractId, target: { domain: 'company', id: contract.id, version: contract.version }, supplierId: supplier.id, supplierVersion: supplier.version, supplierSourceVersion: supplier.sourceVersion, buyerId: buyer.id, buyerVersion: buyer.version })
    }
  }
  return result
})
const mappedCount = computed(() => mappings.value.projects.length + mappings.value.suppliers.length + mappings.value.contracts.length + (preview.value?.references.filter(row => row.table === 'company_expense_contracts' && catalog.value?.contracts.some(item => item.domain === 'company' && `${item.domain}:${item.id}` === choices.value[`company_expense_contracts:${row.legacyId}`])).length ?? 0) + (mappings.value.companyInvoices?.length ?? 0))
const requiredCount = computed(() => (preview.value?.references.length ?? 0) + (preview.value?.invoices.filter(invoice => invoice.companyContractId).length ?? 0))
watch(mappings, () => {
  checked.value = null
}, { flush: 'sync' })
const canCheck = computed(() => ready.value && !!source.value && !!preview.value && !!catalog.value && mappedCount.value === requiredCount.value && !pending.value.length && !busy.value)
const canPublish = computed(() => canCheck.value && !!checked.value && checked.value.invoiceCount > 0 && !checked.value.missingAllocationIds.length && checked.value.invoiceCount === preview.value?.invoices.length)
function message(cause: unknown) {
  if (cause && typeof cause === 'object' && 'data' in cause && cause.data && typeof cause.data === 'object' && 'data' in cause.data) {
    const problem = cause.data.data
    if (problem && typeof problem === 'object' && 'code' in problem && 'message' in problem
      && typeof problem.code === 'string' && ['validation-failed', 'conflict', 'unavailable', 'forbidden'].includes(problem.code)
      && typeof problem.message === 'string' && problem.message.trim() && problem.message.length <= 2000) {
      return problem.message
    }
  }
  return cause instanceof Error ? cause.message : '操作未完成，请保留原库和原提交编号。'
}
function originalState(state: string) {
  return ({ 'recorded': '已有原件记录', 'legacy-path-unverified': '旧路径未核验', 'session-original-unavailable': '原件缺失', 'no-original-recorded': '没有原件记录', 'embedded': '正文已保存', 'metadata-only': '仅有元数据', 'external-required': '需核对外部文件' } as Record<string, string>)[state] ?? '原件状态未知'
}
function fieldName(field: string) {
  return ({ amount: '不含税金额', tax_amount: '税额', total_amount: '价税合计' } as Record<string, string>)[field] ?? '未知字段'
}
async function load(epoch: number) {
  if (typeof props.session.pendingAll === 'function') {
    const found = props.session.pendingAll()
    assertCurrent(epoch)
    pending.value = found.map(command => ({ targetId: command.targetId, commandId: command.commandId }))
  }
  let next: Awaited<ReturnType<typeof props.session.state>>
  try {
    next = await props.session.state()
  }
  catch (cause) {
    invalidateForAuthority(cause, epoch)
    throw cause
  }
  await nextTick()
  assertCurrent(epoch)
  if (typeof props.session.pendingAll !== 'function') {
    const targets = [null, ...next.map(batch => batch.batchId)]
    pending.value = targets.flatMap((targetId) => {
      const command = props.session.pending(targetId)
      return command ? [{ targetId, commandId: command.commandId }] : []
    })
  }
  batches.value = next
  ready.value = true
}
async function run(work: (epoch: number) => Promise<void>) {
  if (busy.value)
    return
  const epoch = generation
  busy.value = true
  error.value = ''
  try {
    await work(epoch)
  }
  catch (cause) {
    if (active && epoch === generation && !invalidateForAuthority(cause, epoch))
      error.value = message(cause)
  }
  finally {
    await nextTick()
    if (active && epoch === generation) {
      try {
        await load(epoch)
      }
      catch (cause) {
        if (active && epoch === generation && !invalidateForAuthority(cause, epoch)) {
          ready.value = false
          error.value = message(cause)
        }
      }
      if (active && epoch === generation)
        busy.value = false
    }
  }
}
onMounted(() => run(load))
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || pending.value.length)
    return
  await run(async (epoch) => {
    const origin = { session: props.session, previewClient: props.previewClient, catalogClient: props.catalogClient, loadBuyers: props.loadBuyers }
    function assertFileCurrent() {
      assertCurrent(epoch)
      if (props.session !== origin.session || props.previewClient !== origin.previewClient || props.catalogClient !== origin.catalogClient || props.loadBuyers !== origin.loadBuyers)
        throw new Error('来源或可用目录已变化，请重新读取并核对。')
    }
    source.value = null
    preview.value = null
    checked.value = null
    catalog.value = null
    result.value = ''
    choices.value = {}
    const bytes = new Uint8Array(await file.arrayBuffer())
    await nextTick()
    assertFileCurrent()
    const { inspectNativeMigrationSnapshot } = await import('~/lib/db/native-snapshot')
    await nextTick()
    assertFileCurrent()
    const inspected = await inspectNativeMigrationSnapshot(bytes)
    await nextTick()
    assertFileCurrent()
    const payloadBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('无法读取所选快照。'))
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.readAsDataURL(file)
    })
    await nextTick()
    assertFileCurrent()
    const selected = { sha256: inspected.sha256, payloadBase64 }
    const sourcePreview = await props.previewClient.source(selected)
    await nextTick()
    assertFileCurrent()
    if (sourcePreview.schemaVersion !== inspected.schemaVersion)
      throw new Error('来源版本与预检不一致。')
    source.value = selected
    preview.value = sourcePreview
    await loadCatalog(epoch)
  })
}
async function loadCatalog(epoch: number) {
  if (!preview.value)
    return
  checked.value = null
  catalog.value = null
  buyers.value = []
  choices.value = {}
  const domains: Record<string, InvoiceCatalogKey> = { 施工: 'construction', 分包: 'subcontract', 材采: 'material', 其他支出: 'auxiliary' }
  const needed: InvoiceCatalogKey[] = []
  for (const reference of preview.value.references) {
    const key = reference.table === 'contracts' ? domains[reference.kind ?? ''] : reference.table === 'company_expense_contracts' ? 'company' : reference.table
    if (!key)
      throw new Error('旧合同类别无法映射到正式来源，不能迁入。')
    if (!needed.includes(key))
      needed.push(key)
  }
  if (preview.value.invoices.some(invoice => invoice.companyContractId) && !needed.includes('suppliers'))
    needed.push('suppliers')
  const value = await props.catalogClient.load(needed)
  await nextTick()
  assertCurrent(epoch)
  if (preview.value.invoices.some(invoice => invoice.companyContractId)) {
    if (!props.loadBuyers)
      throw new Error('我方主体目录尚不可用，不能核对公司票。')
    const nextBuyers = await props.loadBuyers()
    await nextTick()
    assertCurrent(epoch)
    buyers.value = nextBuyers
  }
  catalog.value = value
}
async function check(epoch: number) {
  if (!source.value || !preview.value || !catalog.value || mappedCount.value !== requiredCount.value || pending.value.length)
    return
  checked.value = null
  const value = await props.previewClient.mappings(source.value, mappings.value)
  assertCurrent(epoch)
  if (value.invoiceCount !== preview.value.invoices.length || value.orphanLogCount !== preview.value.orphanLogCount)
    throw new Error('映射预检与来源预检不一致，请重新选择快照。')
  checked.value = value
}
async function publish(epoch: number) {
  if (!source.value || !preview.value || !checked.value || pending.value.length)
    return
  await check(epoch)
  if (!checked.value || checked.value.invoiceCount === 0 || checked.value.missingAllocationIds.length)
    return
  if (!await confirm({ variant: 'simple', title: '确认迁入旧发票', message: `将迁入 ${checked.value.invoiceCount} 条旧发票。请确认已核对关联、缺件及历史付款，并保留完整原库。`, confirmLabel: '确认迁入' }))
    return
  assertCurrent(epoch)
  const saved = await props.session.publish(source.value, mappings.value)
  assertCurrent(epoch)
  result.value = `已核对迁入批次 ${saved.batchId}，共 ${saved.invoiceIds.length} 条发票。`
  source.value = null
  preview.value = null
  checked.value = null
}
async function recover(targetId: string | null, epoch: number) {
  const resolution = await props.session.recover(targetId)
  assertCurrent(epoch)
  result.value = resolution.outcome === 'applied' ? `原提交已核对，批次 ${resolution.result.batchId}。` : '已核对原提交未生效，可以重新预检。'
}
async function retire(batchId: string, epoch: number) {
  if (!await confirm({ variant: 'simple', title: '确认撤回迁入批次', message: '仅在该批次没有后续修改或关联时才能整批撤回；历史证据仍保留。', confirmLabel: '确认撤回' }))
    return
  assertCurrent(epoch)
  const saved = await props.session.retire(batchId)
  assertCurrent(epoch)
  result.value = `已核对撤回批次 ${saved.batchId}。`
}
</script>

<template>
  <section class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded border border-line bg-panel p-4" aria-label="旧发票迁入">
    <h2 class="m-0 text-base font-700">
      旧发票迁入
    </h2>
    <p class="m-0 text-sm text-ink-soft">
      先保留完整原库与备份。逐项核对原件缺口和关联；历史付款依据不会被推测补齐。
    </p>
    <p v-if="error" role="alert" class="m-0 text-sm text-danger">
      {{ error }}
    </p>
    <p v-if="result" role="status" class="m-0 text-sm">
      {{ result }}
    </p>
    <button type="button" :disabled="busy" class="w-fit rounded border border-line px-3 py-1" @click="run(load)">
      重新读取批次
    </button>
    <div v-for="item in pending" :key="item.commandId" class="flex flex-wrap items-center gap-2" role="status">
      <span class="min-w-0 break-all">原提交 {{ item.commandId }} 尚未核对。</span>
      <button type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="run(epoch => recover(item.targetId, epoch))">
        核对原提交
      </button>
    </div>
    <label class="min-w-0">选择完整 SQLite 快照 <input type="file" accept=".sqlite,.sqlite3,.db" class="block max-w-full" :disabled="busy || !ready || !!pending.length" @change="choose"></label>
    <template v-if="preview">
      <p class="m-0 min-w-0 break-all text-sm">
        来源 {{ preview.sourceSha256 }} · {{ preview.invoices.length }} 条发票 · {{ preview.orphanLogCount }} 条未关联历史日志
      </p>
      <ul class="m-0 grid gap-1 pl-5 text-sm">
        <li v-for="invoice in preview.invoices" :key="invoice.legacyId" class="break-all">
          {{ invoice.invoiceNumber || invoice.legacyId }}：{{ originalState(invoice.sourceState) }}；原件 {{ invoice.originalCount }}（{{ invoice.originalBodyStates.map(originalState).join('、') || '无' }}）；历史付款分摊 {{ invoice.historicalAllocationCount }}；未知零值 {{ invoice.ambiguousZeroFields.map(fieldName).join('、') || '无' }}{{ invoice.deleted ? '；原记录已删除' : '' }}
        </li>
      </ul>
      <button v-if="!catalog" type="button" :disabled="busy || !ready || !!pending.length" class="w-fit rounded border border-line px-3 py-1" @click="run(loadCatalog)">
        重新读取目标目录
      </button>
      <div v-for="reference in preview.references" :key="`${reference.table}:${reference.legacyId}`" class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 text-sm">
        <label :for="`invoice-mapping-${reference.table}-${reference.legacyId}`" class="break-all">{{ reference.table === 'projects' ? '项目' : reference.table === 'suppliers' ? '分供方' : reference.table === 'company_expense_contracts' ? '公司支出合同' : '合同' }}：{{ reference.label || reference.legacyId }}（{{ reference.legacyId }}）{{ reference.deleted ? '，旧记录已删除' : '' }}{{ reference.table === 'contracts' ? `；类别 ${reference.kind || '未知'}；旧项目 ${reference.projectId || '无'}；旧分供方 ${reference.supplierId || '无'}` : '' }}</label>
        <select :id="`invoice-mapping-${reference.table}-${reference.legacyId}`" v-model="choices[`${reference.table}:${reference.legacyId}`]" :disabled="busy || !catalog || !!pending.length" class="min-w-0 max-w-full rounded border border-line p-2" @change="checked = null">
          <option value="">
            请选择并核对
          </option>
          <template v-if="reference.table === 'contracts' || reference.table === 'company_expense_contracts'">
            <option v-for="option in (catalog?.contracts ?? []).filter(item => reference.table === 'company_expense_contracts' ? item.domain === 'company' : item.domain !== 'company')" :key="`${option.domain}:${option.id}`" :value="`${option.domain}:${option.id}`">
              {{ option.label }}（{{ option.domain }} / {{ option.id }}；项目 {{ option.projectId || '无' }}；分供方 {{ option.supplierId || '无' }}）
            </option>
          </template>
          <template v-else>
            <option v-for="option in (reference.table === 'projects' ? catalog?.projects : catalog?.suppliers) ?? []" :key="option.id" :value="option.id">
              {{ option.label }}（{{ option.id }}）
            </option>
          </template>
        </select>
      </div>
      <fieldset v-for="invoice in preview.invoices.filter(item => item.companyContractId)" :key="invoice.legacyId" class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded border border-line p-3 text-sm">
        <legend class="break-all">
          公司票 {{ invoice.invoiceNumber || invoice.legacyId }}（{{ invoice.legacyId }}）
        </legend>
        <label class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">选择已有分供方
          <select v-model="choices[`company-supplier:${invoice.legacyId}`]" :disabled="busy || !catalog || !!pending.length" class="min-w-0 max-w-full rounded border border-line p-2">
            <option value="">请选择</option>
            <option v-for="supplier in catalog?.suppliers ?? []" :key="supplier.id" :value="supplier.id">{{ supplier.label }}（{{ supplier.id }}）</option>
          </select>
        </label>
        <label class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">选择已有我方主体
          <select v-model="choices[`company-buyer:${invoice.legacyId}`]" :disabled="busy || !catalog || !!pending.length" class="min-w-0 max-w-full rounded border border-line p-2">
            <option value="">请选择</option>
            <option v-for="buyer in buyers" :key="buyer.id" :value="buyer.id">{{ buyer.label }}（{{ buyer.id }}）</option>
          </select>
        </label>
      </fieldset>
      <button type="button" :disabled="!canCheck" class="w-fit rounded border border-line px-3 py-1" @click="run(check)">
        核对映射与历史付款
      </button>
      <p v-if="checked" class="m-0 break-all text-sm">
        {{ checked.missingAllocationIds.length ? `缺少历史分摊：${checked.missingAllocationIds.join('、')}，暂不能迁入。` : '映射预检通过；提交时会再次核对。' }}
      </p>
      <button type="button" :disabled="!canPublish" class="w-fit rounded border border-line px-3 py-1" @click="run(publish)">
        确认迁入
      </button>
    </template>
    <ul class="m-0 grid gap-2 pl-5 text-sm">
      <li v-for="batch in batches" :key="batch.batchId" class="break-all">
        批次 {{ batch.batchId }} · {{ batch.invoiceIds.length }} 条 · {{ batch.retiredAt ? '已撤回' : '已迁入' }} <button v-if="!batch.retiredAt" type="button" :disabled="busy || !ready || !!pending.length" class="rounded border border-line px-2 py-1" @click="run(epoch => retire(batch.batchId, epoch))">
          撤回批次
        </button>
      </li>
    </ul>
  </section>
</template>
