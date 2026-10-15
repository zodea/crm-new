<script setup lang="ts">
import type { CrewWorkerImportPreview, CrewWorkerImportReferenceMapping, CrewWorkerImportResolution, CrewWorkerImportResult, CrewWorkerImportSource } from '~/lib/crew-worker/import-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { CREW_WORKER_IMPORT_SCHEMA_RANGE } from '~/lib/crew-worker/import-contract'
import { commandRecoveryKey, commandRecoveryStorageForFamily } from '~/lib/forms/command-recovery'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { isISODateTimeDTO } from '~/types/read-model'

interface Context { workspaceId: string, actorId: string, capabilities: string[] }
interface State { context: Context, references: Array<{ entityType: string, serverId: string, label: string, version: string, sourceVersion: string }>, sources: Array<{ source_sha256: string, schema_version: number, created_at: string }> }
const state = shallowRef<State | null>(null)
const authority = shallowRef<Context | null>(null)
const source = shallowRef<CrewWorkerImportSource | null>(null)
const preview = shallowRef<CrewWorkerImportPreview | null>(null)
const result = shallowRef<CrewWorkerImportResult | null>(null)
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const selectedProjects = ref<Record<string, string>>({})
const busy = ref(false)
const error = ref('')
const recovery = commandRecoveryStorageForFamily('crew-worker-import')
let generation = 0
let active = true
let knownProof: { descriptor: CommandRecoveryDescriptor, result: CrewWorkerImportResult } | null = null
const identity = (context: Context) => JSON.stringify([context.workspaceId, context.actorId, [...context.capabilities].sort()])
function assertCurrent(epoch: number) {
  if (!active || epoch !== generation)
    throw new Error('访问状态已变化，原输入与原提交编号保留。')
}
function invalidate(problem: { message: string }) {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  pending.value = null
  busy.value = false
  error.value = problem.message
}
bindReadAuthority(invalidate)
onBeforeUnmount(() => {
  active = false
  generation++
  knownProof = null
})
const scope = computed(() => state.value ? { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, family: 'crew-worker-import', targetId: null } : null)
const key = computed(() => scope.value ? commandRecoveryKey(scope.value) : '')
const mappings = computed<CrewWorkerImportReferenceMapping[]>(() => Object.entries(selectedProjects.value).flatMap(([legacyId, serverId]) => {
  const project = state.value?.references.find(row => row.entityType === 'projects' && row.serverId === serverId)
  return project ? [{ entityType: 'projects' as const, legacyId, serverId, version: project.version }] : []
}))
const canAdopt = computed(() => !!state.value && !!source.value && preview.value?.eligible === true && !pending.value && !busy.value)
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作未完成，请保留原库和快照并重新核对。'
}
function verifyState(value: State) {
  if (!value || !value.context || !stableId(value.context.workspaceId) || !stableId(value.context.actorId) || !Array.isArray(value.context.capabilities) || !value.context.capabilities.every(cap => typeof cap === 'string')
    || !['core:migration:write', 'worker:sensitive:read', 'worker:list:read', 'crew:list:read'].every(cap => value.context.capabilities.includes(cap)) || !Array.isArray(value.references) || !Array.isArray(value.sources)
    || value.references.some(row => !row || row.entityType !== 'projects' || !stableId(row.serverId) || typeof row.label !== 'string' || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion)
    || value.sources.some(row => !row || !/^[a-f0-9]{64}$/.test(row.source_sha256) || !Number.isSafeInteger(row.schema_version) || row.schema_version < CREW_WORKER_IMPORT_SCHEMA_RANGE.min || row.schema_version > CREW_WORKER_IMPORT_SCHEMA_RANGE.max || !isISODateTimeDTO(row.created_at))) {
    throw new Error('正式迁入授权或读取来源不完整。')
  }
  return value
}
function stableId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
}
function verifyResult(value: CrewWorkerImportResult, commandId: string, sha256?: string) {
  if (!value || value.commandId !== commandId || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || (sha256 && value.sourceSha256 !== sha256)
    || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < CREW_WORKER_IMPORT_SCHEMA_RANGE.min || value.schemaVersion > CREW_WORKER_IMPORT_SCHEMA_RANGE.max || !isISODateTimeDTO(value.adoptedAt)
    || !Number.isSafeInteger(value.originalCount) || value.originalCount < 0 || ![value.workerIds, value.crewIds, value.archiveIds].every(ids => Array.isArray(ids) && ids.every(stableId) && new Set(ids).size === ids.length)) {
    throw new Error('原迁入回执与原编号、来源或采用身份不一致，请保留原提交编号。')
  }
  return value
}
function verifyPreview(value: CrewWorkerImportPreview, sha256: string) {
  if (!value || value.sourceSha256 !== sha256 || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < CREW_WORKER_IMPORT_SCHEMA_RANGE.min || value.schemaVersion > CREW_WORKER_IMPORT_SCHEMA_RANGE.max
    || ![value.originalCount, value.archiveCount].every(count => Number.isSafeInteger(count) && count >= 0) || typeof value.eligible !== 'boolean'
    || !Array.isArray(value.blockingReasons) || !value.blockingReasons.every(reason => typeof reason === 'string') || (value.eligible && value.blockingReasons.length > 0)
    || ![value.workers, value.crews].every(rows => Array.isArray(rows) && rows.every(row => row && stableId(row.id) && typeof row.name === 'string' && typeof row.deleted === 'boolean'))
    || !Array.isArray(value.projects) || !value.projects.every(row => row && stableId(row.legacyId) && typeof row.label === 'string')) {
    throw new Error('工人来源预检与所选原快照不一致，不能采用。')
  }
  return value
}
async function load(epoch = generation) {
  let fresh: State
  try {
    const data = await $fetch<State, string>('/api/read/crew-worker/import')
    assertCurrent(epoch)
    fresh = verifyState(data)
  }
  catch (cause) {
    assertCurrent(epoch)
    state.value = null
    preview.value = null
    const status = Number((cause as { statusCode?: number, status?: number }).statusCode ?? (cause as { status?: number }).status)
    if (status === 401 || status === 403) {
      result.value = null
      pending.value = null
    }
    throw cause
  }
  if (authority.value && identity(fresh.context) !== identity(authority.value)) {
    invalidate({ message: '工作区、操作者或权限已变化；原输入和原编号保留，恢复原身份后再读取。' })
    assertCurrent(epoch)
  }
  state.value = fresh
  authority.value = fresh.context
  pending.value = recovery.read(key.value)
  if (pending.value && (pending.value.family !== 'crew-worker-import' || pending.value.action !== 'adopt'))
    throw new Error('原迁入描述无效，请保留原编号并核对浏览器存储。')
}
async function run(work: (epoch: number) => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  const epoch = generation
  try {
    await work(epoch)
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = message(cause)
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
async function choose(event: Event, epoch = generation) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || pending.value)
    return
  source.value = null
  preview.value = null
  result.value = null
  selectedProjects.value = {}
  const bytes = new Uint8Array(await file.arrayBuffer())
  assertCurrent(epoch)
  const { inspectNativeMigrationSnapshot } = await import('~/lib/db/native-snapshot')
  assertCurrent(epoch)
  const inspected = await inspectNativeMigrationSnapshot(bytes)
  assertCurrent(epoch)
  const payloadBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取所选 SQLite 快照。'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
  assertCurrent(epoch)
  await load(epoch)
  assertCurrent(epoch)
  source.value = { sha256: inspected.sha256, payloadBase64 }
  await preflight(epoch)
}
async function preflight(epoch = generation) {
  if (!source.value || pending.value)
    return
  const captured = { source: { ...source.value }, mappings: mappings.value.map(row => ({ ...row })) }
  preview.value = null
  await load(epoch)
  assertCurrent(epoch)
  if (!state.value || pending.value)
    return
  const read = await $fetch<CrewWorkerImportPreview, string>('/api/commands/crew-worker/import', { method: 'POST', body: { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, commandId: `cw-preflight-${crypto.randomUUID()}`, action: 'preflight', source: captured.source, referenceMappings: captured.mappings } })
  assertCurrent(epoch)
  preview.value = verifyPreview(read, captured.source.sha256)
}
async function adopt(epoch = generation) {
  if (preview.value?.eligible !== true || pending.value || !source.value || !scope.value || !state.value)
    return
  const captured = { source: { ...source.value }, mappings: mappings.value.map(row => ({ ...row })) }
  await load(epoch)
  assertCurrent(epoch)
  if (pending.value || !scope.value || !state.value)
    return
  const descriptor: CommandRecoveryDescriptor = { ...scope.value, commandId: `cw-import-${crypto.randomUUID()}`, action: 'adopt' }
  recovery.remember(commandRecoveryKey(descriptor), descriptor)
  pending.value = descriptor
  // The full source, project mappings, private fields and receipt body never enter recovery storage.
  const saved = await $fetch<CrewWorkerImportResult, string>('/api/commands/crew-worker/import', { method: 'POST', body: { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, commandId: descriptor.commandId, action: 'adopt', source: captured.source, referenceMappings: captured.mappings } })
  assertCurrent(epoch)
  knownProof = { descriptor, result: verifyResult(saved, descriptor.commandId, captured.source.sha256) }
  await readBack(descriptor, knownProof.result, epoch)
}
async function readBack(descriptor: CommandRecoveryDescriptor, proof: CrewWorkerImportResult, epoch: number) {
  await load(epoch)
  assertCurrent(epoch)
  if (!state.value || state.value.context.workspaceId !== descriptor.workspaceId || state.value.context.actorId !== descriptor.actorId || !state.value.sources.some(row => row.source_sha256 === proof.sourceSha256))
    throw new Error('迁入已返回回执，但目录采用来源未能读回，请核对原提交。')
  recovery.clear(commandRecoveryKey(descriptor), descriptor.commandId)
  pending.value = null
  source.value = null
  preview.value = null
  result.value = proof
  knownProof = null
}
async function recover(epoch = generation) {
  await load(epoch)
  assertCurrent(epoch)
  const descriptor = pending.value
  if (!descriptor)
    return
  if (knownProof && commandRecoveryKey(knownProof.descriptor) === commandRecoveryKey(descriptor) && knownProof.descriptor.commandId === descriptor.commandId) {
    await readBack(descriptor, knownProof.result, epoch)
    return
  }
  const resolution = await $fetch<CrewWorkerImportResolution, string>('/api/commands/crew-worker/import/resolve', { method: 'POST', body: { commandId: descriptor.commandId } })
  assertCurrent(epoch)
  if (resolution.outcome === 'applied') {
    knownProof = { descriptor, result: verifyResult(resolution.result, descriptor.commandId) }
    await readBack(descriptor, knownProof.result, epoch)
  }
  else if (resolution.outcome === 'not-applied' && resolution.commandId === descriptor.commandId) {
    recovery.clear(commandRecoveryKey(descriptor), descriptor.commandId)
    pending.value = null
    preview.value = null
    error.value = '原迁入确认未应用且已封存，请重新选择原快照并核对项目。'
  }
  else { throw new Error('原迁入核对响应没有确认原编号，请保留原提交并重读。') }
}
onMounted(() => void run(load))
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="crew-worker-migration-title" data-testid="crew-worker-migration">
    <h2 id="crew-worker-migration-title" class="m-0 text-14px font-800">
      工人、班组目录迁入
    </h2>
    <p class="mt-2 text-12px leading-5 text-ink-soft">
      保留全局稳定身份、私密历史、原件、名册冻结和原回执。请保留桌面原数据库及一致快照；采用范围仅为工人、班组目录。
    </p>

    <div class="grid min-w-0 gap-3">
      <div v-if="pending" class="border border-line bg-surface-2 p-3" role="status" data-testid="crew-worker-import-recovery">
        <p class="m-0 break-all text-12px">
          原迁入 {{ pending.commandId }} 尚未完成核对，先核对原结果再采用新来源。
        </p>
        <KitButton class="mt-2" :disabled="busy" @click="run(recover)">
          核对原工人班组迁入
        </KitButton>
      </div>
      <label class="grid min-w-0 gap-1 text-12px">选择桌面导出的 SQLite 一致快照
        <input type="file" accept=".sqlite,.db" :disabled="busy || !!pending || !state" class="w-full min-w-0 max-w-full" @change="event => run(epoch => choose(event, epoch))">
      </label>
      <KitButton v-if="!state" :disabled="busy" @click="run(load)">
        重新读取迁入权限与状态
      </KitButton>
      <p v-if="source && state" class="m-0 break-all text-12px">
        来源 SHA-256：{{ source.sha256 }}
      </p>
      <KitButton v-if="source && state && !preview" :disabled="busy || !!pending" @click="run(preflight)">
        重新核对来源与项目
      </KitButton>
      <div v-if="preview" class="grid min-w-0 gap-3">
        <p class="m-0 text-12px">
          来源版本 {{ preview.schemaVersion }} · 班组 {{ preview.crews.length }} · 工人 {{ preview.workers.length }} · 原件 {{ preview.originalCount }} · 冻结名册 {{ preview.archiveCount }}
        </p>
        <label v-for="project in preview.projects" :key="project.legacyId" class="grid min-w-0 gap-1 text-12px">
          <span class="break-all">原项目 {{ project.label }}（{{ project.legacyId }}）对应中央项目</span>
          <select v-model="selectedProjects[project.legacyId]" :disabled="busy || !!pending" class="field-input w-full min-w-0" @change="preview = { ...preview, eligible: false }">
            <option value="">请选择并明确核对</option>
            <option v-for="target in state?.references" :key="target.serverId" :value="target.serverId">{{ target.label }}（{{ target.serverId }} · 版本 {{ target.version }}）</option>
          </select>
        </label>
        <ul v-if="preview.blockingReasons.length" class="m-0 pl-5 text-12px text-danger">
          <li v-for="reason in preview.blockingReasons" :key="reason">
            {{ reason }}
          </li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <KitButton :disabled="busy || !!pending || !source" @click="run(preflight)">
            重新核对来源与项目
          </KitButton>
          <KitButton variant="primary" :disabled="!canAdopt" @click="run(adopt)">
            采用核验后的工人、班组目录
          </KitButton>
        </div>
      </div>
      <div v-if="result && !pending" role="status" class="text-12px" data-testid="crew-worker-import-result">
        已采用 {{ result.crewIds.length }} 个班组、{{ result.workerIds.length }} 个工人；原件 {{ result.originalCount }} 份，冻结名册 {{ result.archiveIds.length }} 份。<NuxtLink to="/base/worker" class="ml-2 text-brand">
          查看全局工人目录
        </NuxtLink>
      </div>
      <p v-if="state?.sources.length" class="m-0 text-12px text-ink-soft">
        本域已采用 {{ state.sources.length }} 份经核验来源，其他核心域沿用各自现行来源与迁入门禁。
      </p>
    </div>
    <p v-if="error" role="alert" class="m-0 mt-3 break-words text-12px text-danger">
      {{ error }}
    </p>
  </section>
</template>
