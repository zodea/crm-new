<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { QuotationGraph, QuotationImportResult } from '~/lib/material-quotation/graph'
import type { QuotationMigrationSource } from '~/lib/material-quotation/import-evidence'
import { onBeforeRouteLeave } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { quotationFingerprint } from '~/lib/material-quotation/contract'
import { decodeQuotationGraph, exportQuotationGraph, quotationGraphHash } from '~/lib/material-quotation/graph'
import { quotationUnknownProblem } from '~/lib/material-quotation/http-repository'
import { quotationSourceReferences } from '~/lib/material-quotation/import-evidence'
import { createQuotationImportRepository } from '~/lib/material-quotation/import-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'

const router = useRouter()
const kit = useKitUI()
const repository = createQuotationImportRepository((url, options) => $fetch<unknown>(url, { ...options, retry: 0 }))
const recovery = createCommandRecoveryStorage()
const context = shallowRef<Awaited<ReturnType<typeof repository.context>> | null>(null)
const graph = shallowRef<QuotationGraph | null>(null)
const source = shallowRef<QuotationMigrationSource | null>(null)
const selectedTargets = ref<Record<string, string>>({})
const confirmed = ref(false)
const requiredReferences = computed(() => graph.value ? quotationSourceReferences(graph.value) : [])
const bindings = computed(() => context.value
  ? requiredReferences.value.flatMap((row) => {
      const target = context.value!.references.find(target => target.entityType === row.entityType && target.serverId === selectedTargets.value[`${row.entityType}:${row.legacyId}`])
      return target ? [{ ...target, legacyId: row.legacyId, confirmedBy: context.value!.actorId }] : []
    })
  : [])
const ready = computed(() => Boolean(source.value) && bindings.value.length === requiredReferences.value.length && (!requiredReferences.value.length || confirmed.value))
watch(selectedTargets, () => {
  confirmed.value = false
}, { deep: true })
const graphHash = ref('')
const busy = ref(false)
const error = ref('')
const done = shallowRef<QuotationImportResult | null>(null)
const pending = shallowRef<{
  descriptor: CommandRecoveryDescriptor
  key: string
  result: QuotationImportResult | null
} | null>(null)
const appliedProofs = new Map<string, { commandId: string, result: QuotationImportResult }>()
function knownApplied(item: NonNullable<typeof pending.value>) {
  const proof = appliedProofs.get(item.key)
  return proof?.commandId === item.descriptor.commandId ? proof.result : null
}
let generation = 0
let active = true
function fence(current: number) {
  if (!active || generation !== current)
    throw new Error('原来源读取已因身份变化或页面离开失效；来源与原编号保留')
}
function retainApplied(item: NonNullable<typeof pending.value>, result: QuotationImportResult, current: number) {
  fence(current)
  if (pending.value?.key !== item.key || pending.value.descriptor.commandId !== item.descriptor.commandId || context.value?.workspaceId !== item.descriptor.workspaceId || context.value.actorId !== item.descriptor.actorId || result.commandId !== item.descriptor.commandId)
    throw new Error('迁入保存证明不属于当前原编号和原身份；原编号保留')
  const prior = knownApplied(item)
  if (prior && quotationFingerprint(prior) !== quotationFingerprint(result))
    throw new Error('原迁入保存证明出现冲突；请保留原编号')
  appliedProofs.set(item.key, { commandId: item.descriptor.commandId, result: structuredClone(result) })
}
let graphAuthority: {
  workspaceId: string
  actorId: string
} | null = null
function invalidate() {
  generation++
  context.value = null
  if (pending.value)
    pending.value = { ...pending.value, result: null }
  confirmed.value = false
  busy.value = false
  done.value = null
  error.value = '身份或来源变化，请恢复原会话后核对原迁入编号'
}
function handleFailure(cause: unknown, current: number) {
  if (!active || current !== generation)
    return
  const problem = quotationUnknownProblem(cause).problem
  if (problem.code === 'unauthenticated' || problem.code === 'forbidden')
    invalidate()
  error.value = problem.message
}
bindReadAuthority(invalidate)
function adoptContext(actor: NonNullable<typeof context.value>) {
  if (context.value && requiredReferences.value.some((row) => {
    const id = selectedTargets.value[`${row.entityType}:${row.legacyId}`]
    const before = context.value!.references.find(target => target.entityType === row.entityType && target.serverId === id)
    const after = actor.references.find(target => target.entityType === row.entityType && target.serverId === id)
    return quotationFingerprint(before) !== quotationFingerprint(after)
  })) {
    confirmed.value = false
  }
  context.value = actor
}
async function authorize(original: {
  workspaceId: string
  actorId: string
}, current: number) {
  fence(current)
  const actor = await repository.context()
  fence(current)
  if (actor.workspaceId !== original.workspaceId || actor.actorId !== original.actorId || !actor.capabilities.includes('material-quotation:write') || !actor.capabilities.includes('core:migration:write')) {
    invalidate()
    throw new Error('报价迁入身份或权限变化，请恢复原会话后核对')
  }
  adoptContext(actor)
}
async function readApplied(result: QuotationImportResult, current: number) {
  const item = pending.value!
  await authorize(item.descriptor, current)
  const proof = await repository.list()
  await authorize(item.descriptor, current)
  if (result.commandId !== item.descriptor.commandId || proof.meta.workspaceId !== item.descriptor.workspaceId || proof.meta.actorId !== item.descriptor.actorId || !proof.records.some(record => quotationFingerprint(record) === quotationFingerprint(result)))
    throw new Error('原迁入已保存但尚未可靠读回，请只核对原编号')
  recovery.clear(item.key, item.descriptor.commandId)
  appliedProofs.delete(item.key)
  pending.value = null
  done.value = result
}
async function initialize() {
  const current = ++generation
  error.value = ''
  context.value = null
  try {
    const actor = await repository.context()
    if (!active || current !== generation)
      return
    if (graphAuthority && (actor.workspaceId !== graphAuthority.workspaceId || actor.actorId !== graphAuthority.actorId))
      throw new Error('来源包属于原会话，请恢复原身份或明确清除来源包')
    adoptContext(actor)
    const key = commandRecoveryKey({ ...actor, family: 'material-quotation-import', targetId: null })
    const descriptor = recovery.read(key)
    if (descriptor) {
      pending.value = { descriptor, key, result: null }
      await recover()
    }
  }
  catch (cause) {
    handleFailure(cause, current)
  }
}
async function recover() {
  const item = pending.value
  if (!item || busy.value)
    return
  const current = generation
  busy.value = true
  try {
    recovery.verify(item.key, item.descriptor.commandId)
    await authorize(item.descriptor, current)
    const known = knownApplied(item)
    const result = known ? { outcome: 'applied' as const, result: known } : await repository.resolve(item.descriptor.commandId)
    if (result.outcome === 'applied')
      retainApplied(item, result.result, current)
    await authorize(item.descriptor, current)
    if (result.outcome === 'applied') {
      pending.value = { ...item, result: result.result }
      await readApplied(result.result, current)
    }
    else {
      recovery.clear(item.key, item.descriptor.commandId)
      appliedProofs.delete(item.key)
      pending.value = null
    }
    error.value = ''
  }
  catch (cause) {
    handleFailure(cause, current)
  }
  finally {
    if (current === generation)
      busy.value = false
  }
}
async function setSource(bytes: Uint8Array, actor: NonNullable<typeof context.value>, current: number) {
  fence(current)
  if (!actor || pending.value)
    return
  const [{ inspectNativeMigrationSnapshot }, { openBrowserSqlite }] = await Promise.all([import('~/lib/db/native-snapshot'), import('~/lib/db/sqljs')])
  fence(current)
  const inspected = await inspectNativeMigrationSnapshot(bytes)
  fence(current)
  if (inspected.schemaVersion < 58 || inspected.schemaVersion > 60)
    throw new Error('原库版本未进入当前已核验报价迁入边界，请保留原库')
  const db = await openBrowserSqlite(bytes)
  let decoded: QuotationGraph
  try {
    fence(current)
    db.run('PRAGMA query_only=ON')
    decoded = decodeQuotationGraph(await exportQuotationGraph({ async execute() {
      throw new Error('报价来源只能只读核验')
    }, async select<T>(sql: string, params: unknown[] = []) {
      const statement = db.prepare(sql)
      try {
        statement.bind(params as never[])
        const rows: T[] = []
        while (statement.step())
          rows.push(statement.getAsObject() as T)
        return rows
      }
      finally {
        statement.free()
      }
    } }, 'native'))
  }
  finally {
    db.close()
  }
  const hash = await quotationGraphHash(decoded)
  await authorize(actor, current)
  graph.value = decoded
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  source.value = { sha256: inspected.sha256, payloadBase64: btoa(binary) }
  selectedTargets.value = {}
  confirmed.value = false
  graphHash.value = hash
  graphAuthority = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  done.value = null
  error.value = ''
}
async function file(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  input.value = ''
  const actor = context.value
  const current = generation
  if (!selected || !actor || busy.value || pending.value)
    return
  busy.value = true
  try {
    const bytes = new Uint8Array(await selected.arrayBuffer())
    fence(current)
    await setSource(bytes, actor, current)
  }
  catch (cause) {
    handleFailure(cause, current)
  }
  finally {
    if (current === generation)
      busy.value = false
  }
}
async function execute() {
  const actor = context.value
  if (!actor || !graph.value || !source.value || !ready.value || pending.value || busy.value)
    return
  const input = { graph: graph.value, graphHash: graphHash.value, source: source.value, bindings: structuredClone(toRaw(bindings.value)) }
  const current = generation
  const descriptor: CommandRecoveryDescriptor = { commandId: crypto.randomUUID(), workspaceId: actor.workspaceId, actorId: actor.actorId, family: 'material-quotation-import', targetId: null, action: 'import' }
  const key = commandRecoveryKey(descriptor)
  try {
    recovery.remember(key, descriptor)
    pending.value = { descriptor, key, result: null }
    busy.value = true
    await authorize(descriptor, current)
    const result = await repository.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'core:migration:write', commandId: descriptor.commandId, batchId: `quotation-import-${crypto.randomUUID()}`, ...input })
    if (!active || current !== generation)
      return
    retainApplied(pending.value!, result, current)
    await authorize(descriptor, current)
    pending.value = { descriptor, key, result }
    await readApplied(result, current)
  }
  catch (cause) {
    handleFailure(cause, current)
  }
  finally {
    if (current === generation)
      busy.value = false
  }
}
function clearGraph() {
  if (!pending.value && !busy.value) {
    graph.value = null
    source.value = null
    selectedTargets.value = {}
    confirmed.value = false
    graphHash.value = ''
    graphAuthority = null
    void initialize()
  }
}
onMounted(initialize)
onDeactivated(() => {
  active = false
  invalidate()
})
onBeforeUnmount(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void initialize()
  }
})
const canLeave = () => (!pending.value && (!source.value || Boolean(done.value))) || kit.confirm({ variant: 'simple', title: '离开报价迁入', message: pending.value ? '原迁入仍需核对；编号已保留，重新打开后请继续核对原编号。确认离开？' : '来源包与逐条关系尚未迁入，确认离开？', confirmLabel: '离开' })
onBeforeRouteLeave(canLeave)
useTabCloseGuard(canLeave)
useTabTitle('报价来源迁入')
</script>

<template>
  <EntityFormShell title="报价来源迁入" back-label="返回报价清单" @back="router.push('/material/quotations')">
    <div class="grid min-w-0 gap-4">
      <section class="panel grid gap-3 p-4">
        <SectionHeader title="核验本地报价来源" /><p class="m-0 text-13px text-ink-soft">
          保留原报价身份、材料行、版本、原件和原命令。本地报价必须完整核验迁入后，才能切换平台。当前中央已有报价时会拒绝覆盖，原本地库和备份仍可恢复。
        </p><div class="flex flex-wrap gap-2">
          <NuxtLink to="/settings/data-migration#finance-migration-title" class="text-13px text-brand underline">
            从桌面设置导出完整一致快照
          </NuxtLink><label class="btn-secondary">选择完整 SQLite 来源快照<input type="file" accept=".sqlite,.db,application/vnd.sqlite3" class="sr-only" :disabled="busy || Boolean(pending) || !context" @change="file"></label><button v-if="graph" type="button" class="btn-secondary" :disabled="busy || Boolean(pending)" @click="clearGraph">
            清除当前来源包
          </button>
        </div>
      </section>
      <CommandRecoveryPanel v-if="pending" :command-id="pending.descriptor.commandId" :saved="Boolean(pending.result)" :busy="busy" @recover="recover" />
      <StatePanel v-if="error" kind="error" title="报价迁入仍需核对" :description="error" compact />
      <section v-if="graph && context" class="panel grid min-w-0 gap-3 p-4">
        <SectionHeader title="来源包待核验内容" /><p class="m-0 text-13px">
          报价 {{ graph.tables.material_quotations.length }} 份 · 冻结版本 {{ graph.tables.material_quotation_history.length }} 个 · 原件 {{ graph.originals.length }} 份 · 原命令 {{ graph.tables.material_quotation_commands.length }} 条
        </p><ul class="m-0 list-disc pl-5 text-13px">
          <li v-for="head in graph.tables.material_quotations" :key="String(head.id)">
            {{ head.party_name }} · 原身份 {{ head.id }}
          </li>
        </ul><div v-if="requiredReferences.length" class="grid min-w-0 gap-3">
          <p class="m-0 text-13px text-ink-soft">
            逐条确认原库身份对应的当前正式记录；名称相同不代表同一实体，原编号及冻结历史不会被改写。
          </p>
          <label v-for="row in requiredReferences" :key="`${row.entityType}:${row.legacyId}`" class="grid min-w-0 gap-1 text-13px">
            {{ row.entityType === 'projects' ? '原项目' : '原分供方' }} {{ row.legacyId }}
            <select v-model="selectedTargets[`${row.entityType}:${row.legacyId}`]" class="field-input w-full min-w-0" :disabled="busy || Boolean(pending)">
              <option :value="undefined">请选择实际对应记录</option>
              <option v-for="target in context.references.filter(target => target.entityType === row.entityType)" :key="target.serverId" :value="target.serverId">{{ target.label || '名称未填写' }} · {{ target.serverId }} · 版本 {{ target.version }}</option>
            </select>
          </label>
          <label class="flex items-start gap-2 text-13px"><input v-model="confirmed" type="checkbox" :disabled="busy || Boolean(pending) || bindings.length !== requiredReferences.length">我已逐条核对原身份与目标记录的对应关系</label>
        </div><p class="m-0 break-all text-11px text-ink-faint">
          完整 SQLite 实际摘要 {{ source?.sha256 }}
        </p><p class="m-0 break-all text-11px text-ink-faint">
          完整来源摘要 {{ graphHash }}
        </p><button type="button" class="btn-primary justify-self-start" :disabled="busy || Boolean(pending) || !ready || !context.capabilities.includes('core:migration:write') || !context.capabilities.includes('material-quotation:write')" @click="execute">
          核验并迁入报价
        </button>
      </section>
      <section v-if="done" role="status" class="panel grid gap-2 p-4 text-13px">
        <strong>报价迁入已保存并核验读取</strong><span>原报价身份 {{ done.importedIds.length }} 个 · 批次 {{ done.batchId }}</span><NuxtLink to="/settings/data-migration" class="text-brand">
          重新运行本地数据迁移预检
        </NuxtLink>
      </section>
    </div>
  </EntityFormShell>
</template>
