<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { LookupOption } from '~/lib/kit/lookup'
import type { OwnerDocumentMigrationCommand, OwnerDocumentMigrationPreview, OwnerDocumentMigrationResult, OwnerDocumentMigrationState } from '~/lib/owner-document/production-migration'
import { isTauri } from '@tauri-apps/api/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useKitUI } from '~/composables/useKitUI'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import { OWNER_DOCUMENT_META } from '~/lib/owner-document/page'
import { createOwnerDocumentMigrationRepository, ownerDocumentMigrationDescriptor } from '~/lib/owner-document/production-migration'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { generateId } from '~/lib/util/id'

const native = isTauri()
const repository = createOwnerDocumentMigrationRepository((path, options) => $fetch<unknown, string>(path, { ...options, retry: 0 }))
const state = shallowRef<OwnerDocumentMigrationState | null>(null)
const source = shallowRef<OwnerDocumentMigrationCommand['source'] | null>(null)
const preview = shallowRef<OwnerDocumentMigrationPreview | null>(null)
const selection = ref<Record<string, string>>({})
const originals = shallowRef<OwnerDocumentMigrationCommand['originals']>([])
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const known = shallowRef<OwnerDocumentMigrationResult | null>(null)
const result = shallowRef<OwnerDocumentMigrationResult | null>(null)
const busy = shallowRef(false)
const error = shallowRef('')
const fileName = shallowRef('')
const recovery = createCommandRecoveryStorage()
const { confirm } = useKitUI()
let active = true
let generation = 0
let authority: { workspaceId: string, actorId: string } | null = null
const labels = { 'project': '工程项目', 'customer': '甲方', 'supplier': '分供方', 'crew': '班组', 'construction': '施工合同', 'subcontract': '分包合同', 'auxiliary': '其他支出合同', 'other-settlement': 'Other原结算' }
const key = computed(() => state.value ? commandRecoveryKey({ ...state.value, family: 'owner-document-import', targetId: null }) : '')
const refKey = (row: OwnerDocumentMigrationPreview['references'][number]) => `${row.kind}:${row.legacyId}`
const lookups = new WeakMap<OwnerDocumentMigrationPreview['references'][number], (keyword: string) => Promise<LookupOption[]>>()
function lookup(row: OwnerDocumentMigrationPreview['references'][number]) {
  let fetch = lookups.get(row)
  if (!fetch) {
    fetch = async keyword => row.candidates.filter(candidate => `${candidate.label} ${candidate.id}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(candidate => ({ id: JSON.stringify([candidate.id, candidate.version]), label: candidate.label, hint: candidate.id }))
    lookups.set(row, fetch)
  }
  return fetch
}
const mappings = computed(() => (preview.value?.references ?? []).flatMap((row) => {
  const chosen = row.candidates.find(candidate => JSON.stringify([candidate.id, candidate.version]) === selection.value[refKey(row)])
  return chosen ? [{ kind: row.kind, legacyId: row.legacyId, id: chosen.id, version: chosen.version }] : []
}))
const canAdopt = computed(() => !!state.value && !!source.value && !!preview.value && !pending.value && !busy.value && mappings.value.length === preview.value.references.length && preview.value.originals.filter(file => file.required).every(file => originals.value.some(original => original.fileId === file.fileId)))
function assertCurrent(epoch: number) {
  if (!active || generation !== epoch)
    throw new Error('访问身份或来源已经变化，请保留原库与原编号')
}
bindReadAuthority((problem) => {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  known.value = null
  busy.value = false
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load(epoch: number) {
  const fresh = await repository.state()
  assertCurrent(epoch)
  if (!fresh.capabilities.includes('owner-document:import') || (authority && (fresh.workspaceId !== authority.workspaceId || fresh.actorId !== authority.actorId))) {
    state.value = null
    preview.value = null
    result.value = null
    known.value = null
    throw new Error('商务采用权限或原工作区身份已变化，请保留原编号')
  }
  state.value = fresh
  authority = { workspaceId: fresh.workspaceId, actorId: fresh.actorId }
  pending.value = recovery.read(key.value)
  return fresh
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
    if (active && generation === epoch) {
      if (cause instanceof OwnerCommercialDocumentRepositoryProblem && ['forbidden', 'unauthenticated'].includes(cause.problem.code)) {
        state.value = null
        preview.value = null
        result.value = null
        known.value = null
      }
      error.value = cause instanceof Error ? cause.message : '商务接管未完成，请保留原库和原编号'
    }
  }
  finally {
    if (active && generation === epoch)
      busy.value = false
  }
}
async function choose(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  element.value = ''
  if (!file || pending.value || !state.value)
    return
  await run(async (epoch) => {
    preview.value = null
    result.value = null
    selection.value = {}
    originals.value = []
    const bytes = await file.arrayBuffer()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const input = await fileRefDraftFromFile(file)
    assertCurrent(epoch)
    if (!input.payloadBase64)
      throw new Error('所选完整 SQLite 字节尚未读取')
    source.value = { sha256, payloadBase64: input.payloadBase64 }
    fileName.value = file.name
    const value = await repository.preflight({ workspaceId: state.value!.workspaceId, actorId: state.value!.actorId, commandId: generateId('business-preflight'), source: source.value, selections: [], originals: [] })
    assertCurrent(epoch)
    preview.value = value
  })
}
async function original(fileId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || pending.value)
    return
  await run(async (epoch) => {
    const input = await fileRefDraftFromFile(file)
    assertCurrent(epoch)
    originals.value = [...originals.value.filter(original => original.fileId !== fileId), { fileId, file: input }]
  })
}
async function finish(receipt: OwnerDocumentMigrationResult, epoch: number) {
  assertCurrent(epoch)
  const descriptor = pending.value
  if (!descriptor || receipt.commandId !== descriptor.commandId || receipt.workspaceId !== descriptor.workspaceId || receipt.actorId !== descriptor.actorId || receipt.sourceSha256 !== descriptor.scopeId || receipt.restored !== (descriptor.action === 'restore') || (receipt.restored && receipt.importId !== descriptor.targetId))
    throw new Error('原商务整批回执与原身份、来源或目标不同，请保留原编号')
  known.value = receipt
  const fresh = await load(epoch)
  assertCurrent(epoch)
  if (!fresh.sources.some(item => item.importId === receipt.importId && item.sourceSha256 === receipt.sourceSha256 && item.restored === receipt.restored))
    throw new Error('已应用结果尚未可靠后读，请按原编号只核对结果')
  recovery.clear(key.value, descriptor.commandId)
  pending.value = null
  known.value = null
  result.value = receipt
}
async function adopt() {
  if (!canAdopt.value)
    return
  await run(async (epoch) => {
    const command: OwnerDocumentMigrationCommand = { workspaceId: state.value!.workspaceId, actorId: state.value!.actorId, commandId: generateId('business-import'), source: source.value!, selections: mappings.value, originals: originals.value }
    const descriptor = ownerDocumentMigrationDescriptor({ ...command, sourceSha256: command.source.sha256 })
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await repository.adopt(command), epoch)
  })
}
async function recover() {
  if (!pending.value || !state.value)
    return
  await run(async (epoch) => {
    if (known.value)
      return finish(known.value, epoch)
    const descriptor = pending.value!
    const resolved = await repository.resolve(descriptor)
    assertCurrent(epoch)
    if (resolved.outcome === 'applied') {
      await finish(resolved.result, epoch)
    }
    else {
      await load(epoch)
      recovery.clear(key.value, descriptor.commandId)
      pending.value = null
      error.value = '原采用已确认未应用并封存；原库、映射和原件保留，可重新核对后提交新编号。'
    }
  })
}
async function restore(item: OwnerDocumentMigrationState['sources'][number]) {
  if (!state.value || pending.value || !await confirm({ variant: 'simple', title: '核对并恢复本批商务单据？', message: '仅未被后来修改、原意图、收付、抵扣或冻结历史消费的整批可归档。危险恢复整批拒绝；原件、原文、审计与回执继续保留。', confirmLabel: '核对并恢复' }))
    return
  await run(async (epoch) => {
    const command = { workspaceId: state.value!.workspaceId, actorId: state.value!.actorId, commandId: generateId('business-restore'), sourceSha256: item.sourceSha256, importId: item.importId }
    const descriptor = ownerDocumentMigrationDescriptor(command)
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await repository.restore(command), epoch)
  })
}
onMounted(() => {
  if (!native)
    void run(async (epoch) => { await load(epoch) })
})
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="商务单据正式接管">
    <h3 class="text-14px font-800">
      商务单据接管
    </h3>
    <p class="mt-2 text-12px leading-5 text-ink-soft">
      选择完整 SQLite 原库，明确对应真实项目、甲方、分供方与合同。原编号、冻结历史、未知金额、原件与审计保留；甲方变洽签沿同一来源已接管的 BOQ 稳定事实复用。
    </p>
    <p v-if="native" class="mt-3 text-12px text-warn-ink">
      请从已配置的正式浏览器入口接管完整原库。
    </p>
    <template v-else>
      <p v-if="error" role="alert" class="mt-3 break-words text-12px text-danger">
        {{ error }}
      </p>
      <KitButton v-if="!state" class="mt-3" :disabled="busy" @click="run(async epoch => { await load(epoch) })">
        重新读取商务接管权限
      </KitButton>
      <template v-if="state">
        <label class="mt-4 block text-12px">商务 SQLite 原库<input type="file" accept=".sqlite,.db,.sqlite3" class="mt-2 block w-full" :disabled="busy || !!pending" @change="choose"></label>
        <p v-if="fileName" class="mt-2 break-words text-12px">
          {{ fileName }}
        </p>
        <div v-if="preview" class="mt-4 grid min-w-0 gap-3 text-12px">
          <p>{{ preview.documents.length }} 份原单据；{{ preview.reusedOwnerChanges.length }} 份变洽签复用 BOQ 原事实，缺件与原软删保历史。</p>
          <div class="min-w-0 overflow-x-auto">
            <table class="w-full min-w-600px text-left">
              <thead><tr><th>单据</th><th>原编号</th><th>原状态</th><th>原额</th></tr></thead><tbody>
                <tr v-for="document in preview.documents" :key="`${document.kind}:${document.id}`">
                  <td>{{ OWNER_DOCUMENT_META[document.kind].label }}</td><td>{{ document.no || document.id }}</td><td>{{ document.status }}{{ document.deleted ? ' · 已删除历史' : '' }}</td><td>{{ document.amount === null ? '未知' : document.amount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-for="row in preview.references" :key="refKey(row)" class="grid min-w-0 gap-2">
            <label>{{ labels[row.kind] }}：{{ row.label }}（{{ row.legacyId }}）</label><LookupSelect v-model="selection[refKey(row)]" :fetch="lookup(row)" :placeholder="`搜索对应真实${labels[row.kind]}`" :disabled-reason="busy || pending ? '请先核对原提交' : undefined" /><span v-if="!row.candidates.length" class="text-warn-ink">当前没有可核验的真实候选；请保留原库，不按同名猜接。</span>
          </div>
          <div v-for="file in preview.originals" :key="file.fileId" class="grid gap-2">
            <span>{{ file.fileName }} · {{ file.bodyState === 'embedded' ? '原完整字节已核验' : file.required ? '需补齐路径原件' : '仅有原登记，正文未知' }}</span><input v-if="file.required" type="file" :aria-label="`补齐原件：${file.fileName}`" :disabled="busy || !!pending" @change="original(file.fileId, $event)">
          </div>
          <KitButton class="justify-self-start" :disabled="!canAdopt" @click="adopt">
            核对并接管商务原图
          </KitButton>
        </div>
        <div v-if="pending" class="mt-4 text-12px">
          <p>原整批提交结果待核对。原编号 {{ pending.commandId }} 已保留；刷新后继续核对原结果。</p><KitButton class="mt-2" :disabled="busy" @click="recover">
            {{ known ? '重试读取已应用结果' : '核对原商务接管提交' }}
          </KitButton>
        </div>
        <p v-if="result" class="mt-3 text-12px text-ok">
          {{ result.restored ? '本批已归档，原件、历史与原回执仍保留。' : '商务原图已接管并可靠读取。' }}
        </p>
        <ul class="mt-4 grid min-w-0 gap-3 text-12px">
          <li v-for="item in state.sources" :key="item.importId" class="min-w-0 border-t border-line pt-3">
            <p class="break-words">
              {{ item.importedAt }} · {{ item.original.documentIds.length }} 份原单据 · {{ item.restored ? '已恢复' : '已接管' }}
            </p><KitButton v-if="!item.restored" class="mt-2" variant="secondary" :disabled="busy || !!pending" @click="restore(item)">
              核对并恢复本批商务原图
            </KitButton>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
