<script setup lang="ts">
import type { FinanceDeclaredMissingOriginal, FinanceMigrationMapping, FinanceMigrationOriginal, FinanceMigrationPreview, FinanceMigrationResult, FinanceMigrationSourceProof, FinanceMigrationState } from '~/lib/finance/migration-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { financeProblemFromUnknown } from '~/lib/finance/central-contract'
import { createFinanceMigrationRepository } from '~/lib/finance/migration-repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { bindReadAuthority } from '~/lib/read-model/authority'

const repository = createFinanceMigrationRepository((url, options) => {
  const body = options?.body
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body)))
    throw new Error('财务迁入提交格式无效。')
  return $fetch<unknown, string>(url, { ...options, body, retry: 0 })
})
const recovery = createCommandRecoveryStorage(() => sessionStorage)
const state = shallowRef<FinanceMigrationState | null>(null)
const authority = shallowRef<{ workspaceId: string, actorId: string, capabilities: string[] } | null>(null)
const source = shallowRef<FinanceMigrationSourceProof | null>(null)
const sourceName = ref('')
const preview = shallowRef<FinanceMigrationPreview | null>(null)
const result = shallowRef<FinanceMigrationResult | null>(null)
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const known = shallowRef<{ commandId: string, receipt: FinanceMigrationResult } | null>(null)
const selected = ref<Record<string, string>>({})
const reasons = ref<Record<string, string>>({})
const originals = shallowRef<FinanceMigrationOriginal[]>([])
const originalNames = ref<Record<string, string>>({})
const missingSelected = ref<Record<string, boolean>>({})
const missingReasons = ref<Record<string, string>>({})
const busy = ref(false)
const error = ref('')
let generation = 0
let active = true
bindReadAuthority((problem) => {
  ++generation
  state.value = null
  preview.value = null
  result.value = null
  pending.value = null
  busy.value = false
  error.value = problem.message
})
function current(token: number) {
  if (!active || token !== generation)
    throw new Error('访问状态已变化，旧读取不能采用。原输入和原提交编号继续保留。')
}
const family = 'finance-import'
const names = { current: '往来款', reimbursement: '费用与报销', payment_application: '付款申请', payment_record: '支付记录', invoice_application: '开票申请' }
const entityNames = { projects: '项目', suppliers: '分供方', workers: '工人', customers: '客户' }
const scope = computed(() => authority.value ? { workspaceId: authority.value.workspaceId, actorId: authority.value.actorId, family, targetId: null } : null)
const key = computed(() => scope.value ? commandRecoveryKey(scope.value) : '')
const mappings = computed<FinanceMigrationMapping[]>(() => preview.value?.references.flatMap((reference) => {
  const referenceKey = `${reference.entityType}:${reference.id}`
  const candidate = preview.value?.candidates.find(row => row.entityType === reference.entityType && row.serverId === selected.value[referenceKey])
  const reason = reasons.value[referenceKey]?.trim()
  return candidate && reason ? [{ entityType: reference.entityType, legacyId: reference.id, targetId: candidate.serverId, version: candidate.version, sourceVersion: candidate.sourceVersion, reason }] : []
}) ?? [])
const declaredMissingOriginals = computed<FinanceDeclaredMissingOriginal[]>(() => preview.value?.originals.flatMap(file => file.bodyState === 'external-required' && file.canDeclareMissingClearance && missingSelected.value[file.fileId] && missingReasons.value[file.fileId]?.trim() ? [{ fileId: file.fileId, reason: missingReasons.value[file.fileId]!.trim() }] : []) ?? [])
const originalsReady = computed(() => preview.value?.originals.every(file => file.bodyState !== 'external-required' || originals.value.some(original => original.fileId === file.fileId) || declaredMissingOriginals.value.some(item => item.fileId === file.fileId)) === true)
const canAdopt = computed(() => !busy.value && !!state.value && !!source.value && preview.value?.eligible === true && !pending.value
  && mappings.value.length === preview.value.references.length && originalsReady.value)
const identity = (value: { workspaceId: string, actorId: string, capabilities: string[] }) => JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])
async function run(work: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  const token = generation
  try {
    await work()
  }
  catch (cause) {
    if (active && token === generation)
      error.value = cause instanceof Error ? cause.message : '未能完成财务核对，请保留原库与原提交编号。'
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function load(token = generation) {
  let fresh: FinanceMigrationState
  try {
    fresh = await repository.state()
    current(token)
  }
  catch (cause) {
    if (active && token === generation) {
      state.value = null
      preview.value = null
      result.value = null
      if (['forbidden', 'unauthenticated'].includes(financeProblemFromUnknown(cause).problem.code))
        pending.value = null
    }
    throw cause
  }
  if (authority.value && identity(authority.value) !== identity(fresh)) {
    state.value = null
    preview.value = null
    result.value = null
    throw new Error('工作区、操作者或权限已变化；原输入和原提交编号已保留，恢复原身份后再核对。')
  }
  authority.value = { workspaceId: fresh.workspaceId, actorId: fresh.actorId, capabilities: [...fresh.capabilities] }
  state.value = fresh
  pending.value = recovery.read(key.value)
  if (pending.value && (pending.value.family !== family || pending.value.targetId !== null || pending.value.action !== 'adopt'))
    throw new Error('财务迁入原提交描述不完整，请保留原编号并核对浏览器存储。')
}
async function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('未能读取所选原文件。'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}
async function choose(event: Event) {
  const token = generation
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || pending.value)
    return
  preview.value = null
  result.value = null
  source.value = null
  originals.value = []
  originalNames.value = {}
  missingSelected.value = {}
  missingReasons.value = {}
  selected.value = {}
  reasons.value = {}
  const bytes = new Uint8Array(await file.arrayBuffer())
  current(token)
  const { inspectNativeMigrationSnapshot } = await import('~/lib/db/native-snapshot')
  const inspected = await inspectNativeMigrationSnapshot(bytes)
  current(token)
  const payloadBase64 = await base64(file)
  current(token)
  source.value = { sha256: inspected.sha256, payloadBase64 }
  sourceName.value = file.name
  await preflight()
}
async function preflight() {
  const token = generation
  preview.value = null
  await load(token)
  current(token)
  if (!source.value || !authority.value || pending.value)
    return
  const before = identity(authority.value)
  const read = await repository.preflight({ workspaceId: authority.value.workspaceId, actorId: authority.value.actorId }, source.value)
  current(token)
  await load(token)
  current(token)
  if (!authority.value || before !== identity(authority.value) || identity(read) !== before)
    throw new Error('来源核验期间身份或权限变化，请保留输入并重新核验。')
  preview.value = read
}
async function chooseOriginal(fileId: string, event: Event) {
  const token = generation
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const expected = preview.value?.originals.find(row => row.fileId === fileId)
  if (!file || !expected || expected.bodyState !== 'external-required' || pending.value)
    return
  if (expected.fileSize === null)
    throw new Error('原记录大小未知，不能用新文件猜补正文；只可按真实旧清偿来源声明原单缺失并保留原记录。')
  if (file.size !== expected.fileSize)
    throw new Error('所选原件真实大小与旧记录不同；请核对原文件，不能替换原记录。')
  const payloadBase64 = await base64(file)
  current(token)
  originals.value = [...originals.value.filter(row => row.fileId !== fileId), { fileId, payloadBase64 }]
  originalNames.value[fileId] = file.name
  missingSelected.value[fileId] = false
}
function selectMissing(fileId: string, event: Event) {
  const expected = preview.value?.originals.find(row => row.fileId === fileId)
  if (!expected?.canDeclareMissingClearance || expected.bodyState !== 'external-required' || busy.value || pending.value)
    return
  missingSelected.value[fileId] = (event.target as HTMLInputElement).checked
  if (missingSelected.value[fileId]) {
    originals.value = originals.value.filter(row => row.fileId !== fileId)
    delete originalNames.value[fileId]
  }
}
async function readBack(descriptor: CommandRecoveryDescriptor, token: number) {
  await load(token)
  current(token)
  if (!state.value || descriptor.workspaceId !== state.value.workspaceId || descriptor.actorId !== state.value.actorId)
    throw new Error('原迁入身份不属于当前读取范围，请保留原提交编号。')
  const receipt = known.value?.commandId === descriptor.commandId ? known.value.receipt : null
  if (!receipt || !state.value.receipts.some(actual => JSON.stringify(actual) === JSON.stringify(receipt)))
    throw new Error('迁入已返回回执，但完整采用结果未能读回；保留原编号并只读核对。')
  result.value = receipt
  recovery.clear(commandRecoveryKey(descriptor), descriptor.commandId)
  pending.value = null
  source.value = null
  preview.value = null
  originals.value = []
  missingSelected.value = {}
  missingReasons.value = {}
}
async function adopt() {
  const token = generation
  if (!state.value || !source.value || !scope.value || preview.value?.eligible !== true || pending.value || mappings.value.length !== preview.value.references.length
    || !originalsReady.value) {
    return
  }
  const captured = { source: source.value, mappings: mappings.value.map(row => ({ ...row })), originals: originals.value.map(row => ({ ...row })), declaredMissingOriginals: declaredMissingOriginals.value.map(row => ({ ...row })) }
  await load(token)
  current(token)
  if (!scope.value || pending.value || !state.value)
    return
  const descriptor: CommandRecoveryDescriptor = { ...scope.value, commandId: `finance-import-${crypto.randomUUID()}`, action: 'adopt' }
  recovery.remember(commandRecoveryKey(descriptor), descriptor)
  pending.value = descriptor
  const receipt = await repository.adopt({ workspaceId: descriptor.workspaceId, actorId: descriptor.actorId }, descriptor.commandId, captured.source, captured.mappings, captured.originals, captured.declaredMissingOriginals)
  known.value = { commandId: descriptor.commandId, receipt }
  current(token)
  await readBack(descriptor, token)
}
async function recover() {
  const token = generation
  await load(token)
  current(token)
  const descriptor = pending.value
  if (!descriptor)
    return
  if (known.value?.commandId === descriptor.commandId) {
    await readBack(descriptor, token)
    return
  }
  const resolution = await repository.resolve(descriptor.commandId)
  if (resolution.outcome === 'applied')
    known.value = { commandId: descriptor.commandId, receipt: resolution.result }
  current(token)
  if (resolution.outcome === 'applied') {
    await readBack(descriptor, token)
  }
  else {
    recovery.clear(commandRecoveryKey(descriptor), descriptor.commandId)
    pending.value = null
    preview.value = null
    error.value = '原迁入已核对为未采用并封存。原输入保留，重新核验后才能生成新提交。'
  }
}
onMounted(() => void run(load))
onUnmounted(() => {
  active = false
  ++generation
})
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="finance-migration-title" data-testid="finance-migration">
    <h2 id="finance-migration-title" class="m-0 text-14px font-800">
      财务原库迁入
    </h2>
    <p class="mt-2 text-12px leading-5 text-ink-soft">
      保留原费用、往来、票款分摊、冻结记录、原件和旧审计。请保留桌面原库与一致快照，先核对当前真实资料再采用。
    </p>

    <div class="grid min-w-0 gap-3">
      <p v-if="state" class="m-0 break-all text-12px">
        当前工作区 {{ state.workspaceId }} · 操作者 {{ state.actorId }} · 财务来源 {{ state.sourceVersion }}
      </p>
      <div v-if="pending" class="border border-line p-3" role="status">
        <p class="m-0 break-all text-12px">
          原迁入 {{ pending.commandId }} 尚未完成核对。
        </p>
        <KitButton class="mt-2" :disabled="busy" @click="run(recover)">
          核对原财务迁入
        </KitButton>
      </div>
      <label class="grid min-w-0 gap-1 text-12px">选择桌面导出的 SQLite 一致快照
        <input type="file" accept=".sqlite,.db" :disabled="busy || !!pending || !state" class="max-w-full" @change="event => run(() => choose(event))">
      </label>
      <p v-if="source" class="m-0 break-all text-12px">
        {{ sourceName }} · SHA-256 {{ source.sha256 }}
      </p>
      <div v-if="preview" class="grid min-w-0 gap-3">
        <p class="m-0 text-12px">
          来源版本 {{ preview.nativeSchemaVersion }} · 原件 {{ preview.originals.length }}
        </p>
        <ul class="m-0 pl-5 text-12px">
          <li v-for="record in preview.records" :key="record.kind">
            {{ names[record.kind] }}：{{ record.count }} 条（含已移除历史 {{ record.deletedCount }} 条）
          </li>
        </ul>
        <div v-for="reference in preview.references" :key="`${reference.entityType}:${reference.id}`" class="grid min-w-0 gap-2 border border-line p-3">
          <label class="grid min-w-0 gap-1 text-12px">
            原{{ entityNames[reference.entityType] }}：{{ reference.label }} · {{ reference.id }}
            <select v-model="selected[`${reference.entityType}:${reference.id}`]" :disabled="busy || !!pending" class="min-w-0 max-w-full border border-line bg-surface px-2 py-2">
              <option value="">逐项选择当前真实资料</option>
              <option v-for="candidate in preview.candidates.filter(row => row.entityType === reference.entityType)" :key="candidate.serverId" :value="candidate.serverId">
                {{ candidate.label }} · {{ candidate.serverId }} · 版本 {{ candidate.version }} · {{ candidate.sourceVersion }}
              </option>
            </select>
          </label>
          <label class="grid gap-1 text-12px">身份对应的确认依据
            <input v-model="reasons[`${reference.entityType}:${reference.id}`]" :disabled="busy || !!pending" type="text" class="min-w-0 border border-line bg-surface px-2 py-2" placeholder="填写核验的原始资料依据，系统不按同名猜测">
          </label>
        </div>
        <div v-for="original in preview.originals.filter(file => file.bodyState === 'external-required')" :key="original.fileId" class="grid min-w-0 gap-2 rounded border border-line p-3 text-12px">
          <label class="grid gap-1 text-12px">补充原字节：{{ original.fileName }} · {{ original.fileSize === null ? '原大小未知' : `${original.fileSize} 字节` }} · {{ original.fileId }}
            <input type="file" :disabled="busy || !!pending || original.fileSize === null || missingSelected[original.fileId]" class="max-w-full" @change="event => run(() => chooseOriginal(original.fileId, event))"></label>
          <span v-if="originalNames[original.fileId]">已读入 {{ originalNames[original.fileId] }}</span>
          <template v-if="original.canDeclareMissingClearance">
            <label class="flex min-w-0 items-start gap-2"><input type="checkbox" :checked="missingSelected[original.fileId]" :disabled="busy || !!pending" :aria-label="`声明旧清偿原单缺失 ${original.fileName}`" @change="selectMissing(original.fileId, $event)"><span>此真实旧清偿原单已遗失，保留原记录并另行交叉核验</span></label>
            <label v-if="missingSelected[original.fileId]" class="grid gap-1">原单缺失说明<input v-model="missingReasons[original.fileId]" :disabled="busy || !!pending" :aria-label="`原单缺失说明 ${original.fileName}`" class="min-w-0 border border-line bg-surface px-2 py-2"></label>
          </template>
        </div>
        <p v-if="preview.originals.some(file => file.bodyState === 'metadata-only')" class="m-0 text-12px text-ink-soft">
          原库确实只有元数据的历史附件会保留缺件标记，不能当作零字节文件。
        </p>
        <p v-if="preview.retainedReferences.length" class="m-0 text-12px text-ink-soft">
          合同、结算和已开票等外域旧关联保留原稳定编号与原证据。当前真实来源尚未接入的关联不会成为新增候选。
        </p>
        <p v-for="reason in preview.blockingReasons" :key="reason" class="m-0 text-12px" role="alert">
          {{ reason }}
        </p>
        <KitButton :disabled="!canAdopt" variant="primary" @click="run(adopt)">
          按已核验身份完整采用财务
        </KitButton>
      </div>
      <KitButton v-if="source && !pending" :disabled="busy || !state" @click="run(preflight)">
        重新核验当前来源
      </KitButton>
      <p v-if="result" class="m-0 break-all text-12px" role="status">
        已核对迁入 {{ result.commandId }} · {{ result.records.length }} 条财务记录 · 来源 {{ result.sourceBytesSha256 }}
      </p>
      <KitButton v-if="!state" :disabled="busy" @click="run(load)">
        重新读取当前授权
      </KitButton>
    </div>
    <p v-if="error" class="m-0 mt-3 break-words text-12px" role="alert">
      {{ error }}
    </p>
  </section>
</template>
