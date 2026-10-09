<script setup lang="ts">
import type { BoqSourceImportCommand, BoqSourceImportPreview, BoqSourceImportResult } from '~/lib/boq/import-contract'
import type { BoqOriginalInput } from '~/lib/boq/production-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { readBoqSourceImportRecoveryForRoute } from '~/lib/boq/command-recovery'
import { createProductionBoqImportRepository } from '~/lib/boq/production-import-repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'

const repository = createProductionBoqImportRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
const codec = createCommandRecoveryStorage()
const route = useRoute()
const access = useProductionAccessStore()
const { confirm } = useKitUI()
const state = shallowRef<Awaited<ReturnType<typeof repository.state>> | null>(null)
const preview = shallowRef<BoqSourceImportPreview | null>(null)
const source = shallowRef<BoqSourceImportCommand['source'] | null>(null)
const originals = shallowRef<Record<string, BoqOriginalInput>>({})
const pending = shallowRef<CommandRecoveryDescriptor[]>([])
const applied = shallowRef<BoqSourceImportResult | null>(null)
const busy = shallowRef(false)
const message = shallowRef('')
const fileName = shallowRef('')
let generation = 0
const canImport = computed(() => access.allowed && state.value?.capabilities.includes('boq:import') && state.value.capabilities.includes('core:migration:write'))

function invalidate() {
  generation++
  state.value = null
  preview.value = null
  source.value = null
  originals.value = {}
  applied.value = null
  pending.value = []
  fileName.value = ''
  busy.value = false
}
watch(() => [route.fullPath, access.status?.mode, access.status?.mode === 'production' ? access.status.ownerId : undefined, access.status?.authenticated], invalidate, { flush: 'sync' })

function markers(identity: { workspaceId: string, actorId: string }) {
  return readBoqSourceImportRecoveryForRoute(route.fullPath, identity, sessionStorage)
}
async function load(epoch = generation) {
  const identity = await repository.state()
  if (epoch !== generation)
    return null
  state.value = identity
  pending.value = markers(identity)
  if (applied.value) {
    const record = identity.sources.find(row => row.importId === applied.value!.importId && row.sourceSha256 === applied.value!.sourceSha256 && row.restored === !!applied.value!.restored)
    if (!record || !['fileIds', 'lineIds', 'changeIds', 'priceIds'].every(key => JSON.stringify(record.original[key as keyof BoqSourceImportResult]) === JSON.stringify(applied.value![key as keyof BoqSourceImportResult])))
      throw new Error('原结果已应用，但该原批次尚未完整读回，保留原编号')
    for (const marker of pending.value.filter(row => row.commandId === applied.value!.commandId)) codec.clear(commandRecoveryKey(marker), marker.commandId)
    applied.value = null
    pending.value = markers(identity)
  }
  return identity
}
async function pickSource(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || busy.value)
    return
  const epoch = ++generation
  source.value = null
  preview.value = null
  originals.value = {}
  busy.value = true
  message.value = ''
  try {
    const identity = await load(epoch)
    if (!identity || !canImport.value)
      throw new Error('当前身份或权限不能预检完整原清单，原库保留')
    const bytes = await file.arrayBuffer()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const body = await fileRefDraftFromFile(file)
    if (epoch !== generation)
      return
    source.value = { sha256, payloadBase64: body.payloadBase64! }
    fileName.value = file.name
    originals.value = {}
    const checked = await repository.preflight({ workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: generateId('boq-source-inspect'), source: source.value, heads: [], originals: [] })
    if (epoch === generation)
      preview.value = checked
  }
  catch (cause) {
    if (epoch === generation)
      message.value = cause instanceof Error ? cause.message : '完整清单来源预检失败，保留原库'
  }
  finally {
    if (epoch === generation)
      busy.value = false
  }
}
async function pickOriginal(id: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || busy.value || !canImport.value || !preview.value?.originals.some(row => row.fileId === id && row.required))
    return
  const epoch = generation
  const selectedSource = source.value?.sha256
  busy.value = true
  try {
    const bytes = await file.arrayBuffer()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const draft = await fileRefDraftFromFile(file)
    if (epoch === generation && selectedSource === source.value?.sha256 && canImport.value)
      originals.value = { ...originals.value, [id]: { fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream', sha256, payloadBase64: draft.payloadBase64! } }
  }
  catch (cause) {
    if (epoch === generation)
      message.value = cause instanceof Error ? cause.message : '原件正文读取失败，请重新选择'
  }
  finally {
    if (epoch === generation)
      busy.value = false
  }
}
async function send(action: 'adopt' | 'restore', record?: NonNullable<typeof state.value>['sources'][number], event?: Event) {
  if (!state.value || !canImport.value || busy.value || pending.value.length || (action === 'adopt' && (!source.value || !preview.value || preview.value.sourceSha256 !== source.value.sha256 || preview.value.originals.some(file => file.required && !originals.value[file.fileId]))) || (action === 'restore' && (!record || record.restored)))
    return
  const identity = state.value
  const epoch = generation
  const originalSource = source.value ? structuredClone(source.value) : null
  const originalPreview = preview.value ? structuredClone(preview.value) : null
  const originalFiles = structuredClone(originals.value)
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const sourceSha256 = action === 'adopt' ? source.value!.sha256 : record!.sourceSha256
  const descriptor: CommandRecoveryDescriptor = { workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: generateId('boq-source-command'), family: 'boq-import', action, targetId: action === 'adopt' ? sourceSha256 : record!.importId, scopeId: sourceSha256 }
  busy.value = true
  const allowed = await confirm({ variant: 'cascade', title: action === 'adopt' ? '确认采用同源施工清单完整图？' : '确认恢复原采用批次？', message: action === 'adopt' ? '原库由你在外部保留；本库保施工清单、有效变化、独立E价、原件及原审计。不会复制其他领域。' : '整批恢复仅隐藏本批原图，原件、原编号与审计保留。后来工程量、WBS或工资引用会使整批拒绝。', impact: [{ label: '原来源', n: 1 }], requireTyping: action === 'adopt' ? fileName.value : record!.importId, confirmLabel: action === 'adopt' ? '确认采用' : '核查并恢复' })
  if (!allowed || epoch !== generation || !canImport.value || state.value !== identity) {
    if (epoch === generation) {
      busy.value = false
      await nextTick()
      if (trigger?.isConnected && canImport.value)
        trigger.focus()
    }
    return
  }
  message.value = ''
  try {
    const current = await repository.state()
    if (epoch !== generation || !canImport.value || current.workspaceId !== identity.workspaceId || current.actorId !== identity.actorId || !['boq:import', 'core:migration:write'].every(capability => current.capabilities.includes(capability)))
      throw new Error('确认期间来源、身份或权限已变化，保留原资料重新核对')
    codec.remember(commandRecoveryKey(descriptor), descriptor)
    pending.value = [descriptor]
    const completed = action === 'adopt' ? await repository.adopt({ workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: descriptor.commandId, source: originalSource!, heads: originalPreview!.heads.map(head => ({ id: head.id, version: head.version })), originals: Object.entries(originalFiles).map(([fileId, original]) => ({ fileId, original })) }) : await repository.restore({ workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: descriptor.commandId, sourceSha256, importId: record!.importId })
    if (epoch !== generation)
      return
    applied.value = completed
    await load(epoch)
    message.value = action === 'adopt' ? '原完整清单已采用并读回。' : '原批次已受控恢复，原件与审计保留。'
  }
  catch (cause) {
    if (epoch === generation)
      message.value = cause instanceof Error ? cause.message : '原结果未知，请先核对原编号'
  }
  finally {
    if (epoch === generation)
      busy.value = false
  }
}
async function recover(marker: CommandRecoveryDescriptor) {
  if (busy.value || !canImport.value)
    return
  const epoch = generation
  busy.value = true
  try {
    const identity = await repository.state()
    if (identity.workspaceId !== marker.workspaceId || identity.actorId !== marker.actorId)
      throw new Error('当前身份不同，原编号保留')
    const resolution = await repository.resolve(marker)
    if (epoch !== generation)
      return
    if (resolution.outcome === 'applied')
      applied.value = resolution.result
    else codec.clear(commandRecoveryKey(marker), marker.commandId)
    await load(epoch)
  }
  catch (cause) {
    if (epoch === generation)
      message.value = cause instanceof Error ? cause.message : '原结果尚不能核对'
  }
  finally {
    if (epoch === generation)
      busy.value = false
  }
}
onMounted(() => load().catch((cause) => {
  message.value = cause instanceof Error ? cause.message : '采用状态暂不可用'
}))
onBeforeUnmount(() => {
  generation++
})
</script>

<template>
  <section class="panel min-w-0 space-y-4 p-4">
    <h2 class="text-16px font-800 text-ink">
      原 SQLite 施工清单迁入
    </h2>
    <p class="text-12px text-ink-soft">
      先在本机维护确认同一完整原库的施工主合同；分项引用还需同源工程量确认。原 SQLite 由你外部保留，本页只采用清单本域。
    </p>
    <CommandRecoveryPanel v-for="marker in pending" :key="marker.commandId" :command-id="marker.commandId" :saved="applied?.commandId === marker.commandId" :busy="busy" @recover="recover(marker)" />
    <p v-if="message" role="status" class="break-words text-12px text-ink-soft">
      {{ message }}
    </p>
    <label class="field-label flex flex-wrap items-center gap-2">完整原 SQLite <input data-testid="boq-sqlite-input" type="file" accept=".sqlite,.sqlite3,.db" :disabled="busy || !canImport || pending.length > 0" @change="pickSource"></label>
    <template v-if="preview">
      <p class="break-all text-11px text-ink-faint">
        {{ fileName }} · {{ preview.sourceSha256 }}
      </p>
      <ul class="space-y-1 text-12px text-ink-soft">
        <li v-for="head in preview.heads" :key="head.id">
          {{ head.name }} · 已确认同源主合同
        </li>
      </ul>
      <p class="text-12px text-ink">
        {{ preview.counts.files }} 份原清单 · {{ preview.counts.lines }} 条施工量 · {{ preview.counts.changes }} 份甲方变化 · {{ preview.counts.prices }} 条独立E价
      </p>
      <div v-for="file in preview.originals" :key="file.fileId" class="space-y-1 rounded-2 border border-line px-3 py-2 text-12px">
        <p class="break-words">
          {{ file.fileName }} · {{ file.required ? '须补传原路径文件' : file.bodyState === 'embedded' ? '原正文已嵌入' : '原历史仅有元数据' }}
        </p>
        <p v-if="file.filePath" class="break-all text-11px text-ink-faint">
          {{ file.filePath }}
        </p>
        <input v-if="file.required" type="file" :disabled="busy || !canImport" :aria-label="`按原ID补传${file.fileName}`" @change="pickOriginal(file.fileId, $event)">
      </div>
      <KitButton variant="primary" :loading="busy" :disabled="!canImport || pending.length > 0 || preview.originals.some(file => file.required && !originals[file.fileId])" @click="send('adopt', undefined, $event)">
        确认采用完整原图
      </KitButton>
    </template>
    <div v-for="record in state?.sources ?? []" :key="record.importId" class="space-y-2 rounded-2 border border-line p-3 text-12px">
      <p class="break-all text-ink">
        {{ record.importId }} · {{ record.restored ? '已受控恢复' : '原图已采用' }}
      </p>
      <p class="break-all text-11px text-ink-faint">
        {{ record.sourceSha256 }}
      </p>
      <KitButton v-if="!record.restored" variant="secondary" :disabled="busy || !canImport || pending.length > 0" @click="send('restore', record, $event)">
        核查原整批恢复
      </KitButton>
    </div>
  </section>
</template>
