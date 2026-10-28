<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { LookupOption } from '~/lib/kit/lookup'
import type { SubcontractImportCommand, SubcontractImportPreview, SubcontractImportResult } from '~/lib/subcontract-contract/import-contract'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useKitUI } from '~/composables/useKitUI'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { problemFromHttpFailure } from '~/lib/read-model/problem'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

interface State { context: { workspaceId: string, actorId: string, capabilities: string[] }, sources: Array<{ importId: string, sourceSha256: string, ids: string[], supplementIds: string[], importedAt: string, restored: boolean }> }
const state = shallowRef<State | null>(null)
const source = shallowRef<SubcontractImportCommand['source'] | null>(null)
const preview = shallowRef<SubcontractImportPreview | null>(null)
const selection = ref<Record<string, string>>({})
const originals = shallowRef<SubcontractImportCommand['originals']>([])
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const known = shallowRef<SubcontractImportResult | null>(null)
const result = shallowRef<SubcontractImportResult | null>(null)
const busy = ref(false)
const error = ref('')
const name = ref('')
const { confirm } = useKitUI()
const recovery = createCommandRecoveryStorage()
let active = true
let generation = 0
const labels = { project: '项目', supplier: '分供方', signatory: '原我方核实版本' }
const identity = computed(() => state.value ? { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, family: 'subcontract-contract-import', targetId: null } : null)
const key = computed(() => identity.value ? commandRecoveryKey(identity.value) : '')
const refKey = (row: SubcontractImportPreview['references'][number]) => JSON.stringify([row.kind, row.id])
const lookups = new WeakMap<SubcontractImportPreview['references'][number], (keyword: string) => Promise<LookupOption[]>>()
async function candidates(row: SubcontractImportPreview['references'][number], keyword: string) {
  const search = keyword.trim().toLocaleLowerCase()
  return row.candidates.filter(candidate => !search || `${candidate.label} ${candidate.id} ${candidate.version}`.toLocaleLowerCase().includes(search))
    .map(candidate => ({ id: JSON.stringify([candidate.id, candidate.version]), label: candidate.label, hint: `V${candidate.version} · ${candidate.id}${candidate.deletedAt ? ' · 已删除，仅保历史关联' : ''}` }))
}
function candidateLookup(row: SubcontractImportPreview['references'][number]) {
  let lookup = lookups.get(row)
  if (!lookup) {
    lookup = keyword => candidates(row, keyword)
    lookups.set(row, lookup)
  }
  return lookup
}
function mappings(kind: SubcontractImportPreview['references'][number]['kind']) {
  return (preview.value?.references ?? []).filter(row => row.kind === kind).flatMap((row) => {
    const candidate = row.candidates.find(candidate => JSON.stringify([candidate.id, candidate.version]) === selection.value[refKey(row)])
    return candidate ? [{ legacyId: row.id, id: candidate.id, version: candidate.version }] : []
  })
}
const canAdopt = computed(() => !!state.value && !!source.value && !!preview.value && !pending.value && !busy.value && preview.value.references.every(row => !!selection.value[refKey(row)]) && preview.value.requiredOriginals.every(row => originals.value.some(file => file.fileId === row.id)))
bindReadAuthority((problem) => {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  busy.value = false
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load(epoch: number, expected?: State['context']) {
  const read = await $fetch<State, string>('/api/read/subcontract-contracts/import', { retry: 0 })
  if (!active || epoch !== generation || !read?.context || !Array.isArray(read.sources) || !read.context.capabilities.includes('subcontract-contract:import') || (expected && (read.context.workspaceId !== expected.workspaceId || read.context.actorId !== expected.actorId)))
    throw new Error('分包采用权限或可信身份变化，请保留原编号')
  state.value = read
  pending.value = recovery.read(commandRecoveryKey({ ...read.context, family: 'subcontract-contract-import', targetId: null }))
  return read
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
      error.value = problemFromHttpFailure(cause)?.message ?? toErrorMessage(cause)
  }
  finally {
    if (active && epoch === generation)
      busy.value = false
  }
}
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || pending.value)
    return
  await run(async (epoch) => {
    const authority = state.value?.context
    if (!authority)
      throw new Error('请先读取真实采用权限')
    const bytes = await file.arrayBuffer()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const input = await fileRefDraftFromFile(file)
    if (!active || epoch !== generation || typeof input.payloadBase64 !== 'string')
      throw new Error('分包完整原库未成功读取')
    source.value = { sha256, payloadBase64: input.payloadBase64 }
    name.value = file.name
    preview.value = null
    selection.value = {}
    originals.value = []
    const value = await $fetch<SubcontractImportPreview, string>('/api/commands/subcontract-contracts/import', { method: 'POST', query: { preflight: 'true' }, retry: 0, body: { commandId: generateId('subcontract-preflight'), workspaceId: authority.workspaceId, actorId: authority.actorId, source: source.value, projects: [], suppliers: [], signatories: [], originals: [] } })
    if (!active || epoch !== generation || value.sourceSha256 !== sha256 || !Array.isArray(value.references) || !Array.isArray(value.contracts))
      throw new Error('分包原库预检范围或摘要不一致')
    await load(epoch, authority)
    preview.value = value
  })
}
async function original(fileId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || pending.value)
    return
  await run(async (epoch) => {
    const input = await fileRefDraftFromFile(file)
    if (!active || epoch !== generation || typeof input.payloadBase64 !== 'string')
      throw new Error('原签约文件尚未完整读取')
    originals.value = [...originals.value.filter(row => row.fileId !== fileId), { fileId, payloadBase64: input.payloadBase64 }]
  })
}
async function finish(receipt: SubcontractImportResult, epoch: number) {
  const descriptor = pending.value
  const authority = state.value?.context
  if (!descriptor || !authority || receipt.commandId !== descriptor.commandId || !Array.isArray(receipt.ids) || !Array.isArray(receipt.supplementIds) || (descriptor.action === 'adopt' ? descriptor.scopeId !== receipt.sourceSha256 || receipt.restored : descriptor.scopeId !== receipt.importId || !receipt.restored))
    throw new Error('分包原采用回执、来源定位或动作不一致')
  known.value = receipt
  const read = await load(epoch, authority)
  if (!read.sources.some(row => row.importId === receipt.importId && row.sourceSha256 === receipt.sourceSha256 && row.restored === Boolean(receipt.restored)))
    throw new Error('已应用分包原图未获可靠后读，请只重试读取')
  recovery.clear(key.value, descriptor.commandId)
  pending.value = null
  known.value = null
  result.value = receipt
}
async function adopt() {
  if (!canAdopt.value || !state.value || !source.value)
    return
  await run(async (epoch) => {
    const descriptor = { ...identity.value!, commandId: generateId('subcontract-import'), action: 'adopt', scopeId: source.value!.sha256 }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<SubcontractImportResult, string>('/api/commands/subcontract-contracts/import', { method: 'POST', retry: 0, body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, source: source.value, projects: mappings('project'), suppliers: mappings('supplier'), signatories: mappings('signatory'), originals: originals.value } }), epoch)
  })
}
async function recover() {
  if (!pending.value)
    return
  await run(async (epoch) => {
    if (known.value) {
      await finish(known.value, epoch)
      return
    }
    const descriptor = pending.value!
    const resolved = await $fetch<{ outcome: string, result?: SubcontractImportResult, commandId?: string }, string>('/api/commands/subcontract-contracts/import/resolve', { method: 'POST', retry: 0, body: descriptor })
    if (resolved.outcome === 'applied' && resolved.result) {
      await finish(resolved.result, epoch)
    }
    else if (resolved.outcome === 'not-applied' && resolved.commandId === descriptor.commandId) {
      await load(epoch, state.value!.context)
      recovery.clear(key.value, descriptor.commandId)
      pending.value = null
      error.value = '原采用已确认未应用并封存；原库、映射和原件仍留当前页面，可核对后重试。'
    }
    else { throw new Error('分包原采用结果尚未取得有效证明') }
  })
}
async function restore(importId: string) {
  if (!state.value || pending.value || !await confirm({ variant: 'simple', title: '恢复分包原图采用？', message: '未被后来合同更正、工程关联、费用、原意图或其他事实引用的整批分包图可归档；原件和历史继续保留。任何危险引用均整批拒绝。', confirmLabel: '核对并恢复' }))
    return
  await run(async (epoch) => {
    const descriptor = { ...identity.value!, commandId: generateId('subcontract-restore'), action: 'restore', scopeId: importId }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<SubcontractImportResult, string>('/api/commands/subcontract-contracts/restore-import', { method: 'POST', retry: 0, body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, importId } }), epoch)
  })
}
onMounted(() => {
  void run(async (epoch) => {
    await load(epoch)
  })
})
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="分包主合同正式接管">
    <h3 class="text-14px font-800">
      分包主合同与补充协议接管
    </h3>
    <p class="mt-2 text-12px text-ink-soft">
      选择完整 SQLite 原库，明确对应已有正式项目、分供方及原我方核实版本，补齐路径签约原件。原分包合同、补充协议、原件和历史一并保留；历史合同不强填新工程关系。
    </p>

    <p v-if="error" role="alert" class="mt-3 break-words text-12px text-danger">
      {{ error }}
    </p>
    <KitButton v-if="!state" class="mt-3" :disabled="busy" @click="run(async epoch => { await load(epoch) })">
      重新读取分包接管权限
    </KitButton>
    <template v-if="state">
      <label class="mt-4 block text-12px">分包 SQLite 原库<input type="file" accept=".sqlite,.db,.sqlite3" class="mt-2 block w-full" :disabled="busy || !!pending" @change="choose"></label>
      <p v-if="name" class="mt-2 break-words text-12px">
        {{ name }}
      </p>
      <div v-if="preview" class="mt-4 grid min-w-0 gap-3 text-12px">
        <p>原库包含 {{ preview.contracts.length }} 份分包主合同；已删除原图、未知扩展和历史空值保留。</p>
        <div v-for="row in preview.references" :key="refKey(row)" class="grid min-w-0 gap-2">
          <label>{{ labels[row.kind] }}：{{ row.label }}（{{ row.id }}）</label><LookupSelect v-model="selection[refKey(row)]" :fetch="candidateLookup(row)" :placeholder="`搜索原${labels[row.kind]}对应的正式身份及版本`" :disabled-reason="busy || pending ? '请先核对原提交' : undefined" /><span v-if="!row.candidates.length" class="text-warn-ink">没有逐字段核实的原版本，请保留原库核对，不补用当前资料。</span>
        </div>
        <label v-for="file in preview.requiredOriginals" :key="file.id" class="grid gap-2">补齐原件：{{ file.name }}<input type="file" :disabled="busy || !!pending" @change="original(file.id, $event)"></label>
        <KitButton class="justify-self-start" :disabled="!canAdopt" @click="adopt">
          核对并接管分包主补图
        </KitButton>
      </div>
      <div v-if="pending" class="mt-4 text-12px">
        <p>原采用结果待核对；保留原编号核对结果，刷新后请按该编号恢复。</p><KitButton class="mt-2" :disabled="busy" @click="recover">
          核对原分包接管提交
        </KitButton>
      </div>
      <p v-if="result" class="mt-3 text-12px text-ok">
        {{ result.restored ? '本批已归档，原图、原件与历史仍保留。' : '分包主补图已接管并可靠读取。' }}
      </p>
      <ul class="mt-4 grid min-w-0 gap-3 text-12px">
        <li v-for="item in state.sources" :key="item.importId" class="min-w-0 border-t border-line pt-3">
          <p class="break-words">
            {{ item.importedAt }} · {{ item.ids.length }} 份主合同 · {{ item.supplementIds.length }} 份协议 · {{ item.restored ? '已恢复' : '已接管' }}
          </p><KitButton v-if="!item.restored" class="mt-2" variant="secondary" :disabled="busy || !!pending" @click="restore(item.importId)">
            核对并恢复本批分包图
          </KitButton>
        </li>
      </ul>
    </template>
  </section>
</template>
