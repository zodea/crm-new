<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { WbsImportCommand, WbsImportPreview, WbsImportResult } from '~/lib/schedule/import-contract'
import { isTauri } from '@tauri-apps/api/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useKitUI } from '~/composables/useKitUI'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { problemFromHttpFailure } from '~/lib/read-model/problem'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

interface State { context: { workspaceId: string, actorId: string, capabilities: string[] }, sources: Array<{ importId: string, sourceSha256: string, projectIds: string[], groupIds: string[], taskIds: string[], importedAt: string, restored: boolean }> }
const native = isTauri()
const state = shallowRef<State | null>(null)
const source = shallowRef<WbsImportCommand['source'] | null>(null)
const preview = shallowRef<WbsImportPreview | null>(null)
const selected = ref<Record<string, string>>({})
const selectedLibraries = ref<Record<string, string>>({})
const originals = shallowRef<WbsImportCommand['originals']>([])
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const known = shallowRef<WbsImportResult | null>(null)
const result = shallowRef<WbsImportResult | null>(null)
const busy = ref(false)
const error = ref('')
const sourceName = ref('')
const recovery = createCommandRecoveryStorage()
const { confirm } = useKitUI()
const scope = computed(() => state.value ? { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, family: 'schedule-import', targetId: null } : null)
const key = computed(() => scope.value ? commandRecoveryKey(scope.value) : '')
const referenceKey = (row: WbsImportPreview['references'][number]) => JSON.stringify([row.table, row.id])
const referenceLabels = { projects: '项目', buildings: '楼栋', floors: '楼层', items: '分项', construction_stages: '施工阶段' }
const references = computed<WbsImportCommand['references']>(() => (preview.value?.references ?? []).flatMap((row) => {
  const candidate = row.candidates.find(candidate => candidate.id === selected.value[referenceKey(row)])
  return candidate ? [{ table: row.table, legacyId: row.id, id: candidate.id, version: candidate.version }] : []
}))
const libraries = computed<WbsImportCommand['libraries']>(() => (preview.value?.libraries ?? []).flatMap((row) => {
  const candidate = row.candidates.find(candidate => candidate.id === selectedLibraries.value[row.id])
  return candidate ? [{ legacyId: row.id, id: candidate.id, version: candidate.version }] : []
}))
const canAdopt = computed(() => !!source.value && !!preview.value && !busy.value && !pending.value && references.value.length === preview.value.references.length && libraries.value.length === preview.value.libraries.length && preview.value.requiredOriginals.every(file => originals.value.some(row => row.fileId === file.id)))
let generation = 0
let active = true
const urls = new Set<string>()
const files = shallowRef<Array<{ id: string, name: string, url: string | null, state: string }>>([])
bindReadAuthority((problem) => {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  known.value = null
  files.value = []
  busy.value = false
  for (const url of urls)
    URL.revokeObjectURL(url)
  urls.clear()
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
  for (const url of urls)
    URL.revokeObjectURL(url)
})
const identity = (value: State['context']) => JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])
async function readState(epoch: number, authority?: State['context']) {
  const value = await $fetch<State, string>('/api/read/schedule/import', { retry: 0 })
  if (!active || epoch !== generation || !value?.context || !Array.isArray(value.sources) || !value.context.capabilities.includes('schedule:import') || (authority && identity(authority) !== identity(value.context)))
    throw new Error('WBS接管身份或来源已变化，请保留原编号')
  state.value = value
  pending.value = recovery.read(commandRecoveryKey({ ...value.context, family: 'schedule-import', targetId: null }))
  return value
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
      throw new Error('先核对正式接管权限')
    const bytes = await file.arrayBuffer()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const converted = await fileRefDraftFromFile(file)
    if (!active || epoch !== generation || typeof converted.payloadBase64 !== 'string')
      throw new Error('原WBS库尚未完整读取')
    source.value = { sha256, payloadBase64: converted.payloadBase64 }
    sourceName.value = file.name
    selected.value = {}
    selectedLibraries.value = {}
    originals.value = []
    const value = await $fetch<WbsImportPreview, string>('/api/commands/schedule/import', { method: 'POST', retry: 0, body: { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId: generateId('wbs-preflight'), action: 'preflight', source: source.value, references: [], libraries: [], originals: [] } })
    if (!active || epoch !== generation || value.sourceSha256 !== sha256 || !Array.isArray(value.references) || !Array.isArray(value.libraries) || !Array.isArray(value.projects) || !Array.isArray(value.requiredOriginals))
      throw new Error('WBS完整预检结果无法核对')
    await readState(epoch, authority)
    preview.value = value
  })
}
async function original(fileId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || pending.value)
    return
  await run(async (epoch) => {
    const converted = await fileRefDraftFromFile(file)
    if (!active || epoch !== generation || typeof converted.payloadBase64 !== 'string')
      throw new Error('原件尚未完整读取')
    originals.value = [...originals.value.filter(row => row.fileId !== fileId), { fileId, payloadBase64: converted.payloadBase64 }]
  })
}
async function finish(receipt: WbsImportResult, epoch: number) {
  const descriptor = pending.value
  const authority = state.value?.context
  if (!descriptor || !authority || receipt.commandId !== descriptor.commandId || !Array.isArray(receipt.groupIds) || !Array.isArray(receipt.taskIds) || !Array.isArray(receipt.projectIds))
    throw new Error('WBS接管回执与原编号不同')
  if (descriptor.family !== 'schedule-import' || descriptor.targetId !== null || (descriptor.action === 'adopt' ? descriptor.scopeId !== receipt.sourceSha256 || receipt.restored : descriptor.action !== 'restore' || descriptor.scopeId !== receipt.importId || !receipt.restored))
    throw new Error('WBS原批次、来源摘要或动作与恢复定位不同')
  known.value = receipt
  const current = await readState(epoch, authority)
  if (!current.sources.some(row => row.importId === receipt.importId && row.sourceSha256 === receipt.sourceSha256 && row.restored === Boolean(receipt.restored)))
    throw new Error('已保存WBS尚未可靠读取，请只重试读取')
  recovery.clear(key.value, descriptor.commandId)
  pending.value = null
  known.value = null
  result.value = receipt
}
async function adopt() {
  if (!canAdopt.value || !state.value || !source.value)
    return
  await run(async (epoch) => {
    const descriptor = { ...scope.value!, commandId: generateId('wbs-import'), action: 'adopt', scopeId: source.value!.sha256 }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<WbsImportResult, string>('/api/commands/schedule/import', { method: 'POST', retry: 0, body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, action: 'adopt', source: source.value, references: references.value, libraries: libraries.value, originals: originals.value } }), epoch)
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
    const outcome = await $fetch<{ outcome: string, result?: WbsImportResult, commandId?: string }, string>('/api/commands/schedule/import/resolve', { method: 'POST', retry: 0, body: descriptor })
    if (outcome.outcome === 'applied' && outcome.result) {
      await finish(outcome.result, epoch)
    }
    else if (outcome.outcome === 'not-applied' && outcome.commandId === descriptor.commandId) {
      await readState(epoch, state.value!.context)
      recovery.clear(key.value, descriptor.commandId)
      pending.value = null
      error.value = '原提交已确认未应用并封存；原库、映射和补传原件仍留在当前页面，可核对后重新接管。'
    }
    else { throw new Error('WBS原提交结果尚未核实') }
  })
}
async function restore(importId: string) {
  if (!state.value || pending.value || !await confirm({ variant: 'simple', title: '恢复WBS接管？', message: '只归档未被后来计划、子级、原意图或其他事实采用的整批WBS；原图、原件和审计继续保留。有后来变化时整批拒绝。', confirmLabel: '核对并恢复' }))
    return
  await run(async (epoch) => {
    const descriptor = { ...scope.value!, commandId: generateId('wbs-restore'), action: 'restore', scopeId: importId }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<WbsImportResult, string>('/api/commands/schedule/restore-import', { method: 'POST', retry: 0, body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, importId } }), epoch)
  })
}
async function readOriginals(projectId: string) {
  await run(async (epoch) => {
    const read = await $fetch<{ files: Array<{ id: string, fileName: string, payloadState: string, payloadBase64: string | null, mimeType: string }> }, string>('/api/read/schedule/files', { query: { projectId }, retry: 0 })
    if (!active || epoch !== generation)
      return
    files.value = read.files.map((file) => {
      const body = file.payloadBase64 === null ? null : Uint8Array.from(atob(file.payloadBase64), value => value.charCodeAt(0))
      const url = body ? URL.createObjectURL(new Blob([body], { type: file.mimeType })) : null
      if (url)
        urls.add(url)
      return { id: file.id, name: file.fileName, state: file.payloadState, url }
    })
  })
}
onMounted(() => {
  if (!native)
    void run(async (epoch) => { await readState(epoch) })
})
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="WBS正式接管">
    <h3 class="text-14px font-800">
      WBS排程接管
    </h3>
    <p class="mt-2 text-12px text-ink-soft">
      选择完整 SQLite 原库，明确对应正式项目、原区域与不可变工序库版本。原任务、依赖、基线、楼层计划、已删除历史及原件一并保留。历史合同依据保留；新的合同范围与绑定等待正式上游接齐。
    </p>
    <p v-if="native" class="mt-3 text-12px text-warn-ink">
      请从已配置的本机正式浏览器入口接管。
    </p>
    <template v-else>
      <p v-if="error" role="alert" class="mt-3 break-words text-12px text-danger">
        {{ error }}
      </p>
      <KitButton v-if="!state" class="mt-3" :disabled="busy" @click="run(async epoch => { await readState(epoch) })">
        重新读取WBS接管权限
      </KitButton>
      <template v-if="state">
        <label class="mt-4 block text-12px">WBS SQLite 原库<input type="file" accept=".sqlite,.db,.sqlite3" class="mt-2 block w-full" :disabled="busy || !!pending" @change="choose"></label>
        <p v-if="sourceName" class="mt-2 break-words text-12px">
          {{ sourceName }}
        </p>
        <div v-if="preview" class="mt-4 grid min-w-0 gap-3 text-12px">
          <p>原库包含 {{ preview.projects.length }} 个排程项目；缺少原冻结量详情会明确保留为未知。</p>
          <label v-for="row in preview.references" :key="referenceKey(row)" class="grid min-w-0 gap-2">{{ referenceLabels[row.table] }} · {{ row.name }}（{{ row.id }}）<select v-model="selected[referenceKey(row)]" class="field-input w-full" :disabled="busy || !!pending"><option value="">明确选择正式范围</option><option v-for="candidate in row.candidates" :key="candidate.id" :value="candidate.id">{{ candidate.name }}（{{ candidate.id }}）{{ candidate.deletedAt ? ' · 已删除，仅保历史关联' : '' }}</option></select></label>
          <label v-for="row in preview.libraries" :key="row.id" class="grid min-w-0 gap-2">原工序库：{{ row.name }} · V{{ row.version }}<select v-model="selectedLibraries[row.id]" class="field-input w-full" :disabled="busy || !!pending"><option value="">明确选择已核验版本</option><option v-for="candidate in row.candidates" :key="candidate.id" :value="candidate.id">{{ candidate.name }} · V{{ candidate.version }}（{{ candidate.id }}）</option></select><span v-if="!row.candidates.length" class="text-warn-ink">正式目录没有逐字段吻合的原版本。保留原库，在工序库核对完整版本后重新预检；历史证据不能替代上游。</span></label>
          <label v-for="file in preview.requiredOriginals" :key="file.id" class="grid gap-2">补齐原件：{{ file.name }}<input type="file" :disabled="busy || !!pending" @change="original(file.id, $event)"></label>
          <KitButton class="justify-self-start" :disabled="!canAdopt" @click="adopt">
            核对并接管WBS
          </KitButton>
        </div>
        <div v-if="pending" class="mt-4 text-12px">
          <p>原提交结果待核对；刷新后只凭原编号读取结果。</p><KitButton class="mt-2" :disabled="busy" @click="recover">
            核对原WBS接管提交
          </KitButton>
        </div>
        <p v-if="result" class="mt-3 text-12px text-ok">
          {{ result.restored ? '原批次已归档，原图与原件证据保留。' : 'WBS接管已核对，可从施工进度读取。' }}
        </p>
        <ul class="mt-4 grid min-w-0 gap-3 text-12px">
          <li v-for="item in state.sources" :key="item.importId" class="min-w-0 border-t border-line pt-3">
            <p class="break-words">
              {{ item.importedAt }} · {{ item.groupIds.length }} 组 · {{ item.taskIds.length }} 个任务 · {{ item.restored ? '已恢复' : '已接管' }}
            </p><div class="mt-2 flex flex-wrap gap-2">
              <KitButton v-if="!item.restored" variant="secondary" :disabled="busy || !!pending" @click="restore(item.importId)">
                核对并恢复本批WBS
              </KitButton><KitButton v-for="id in item.projectIds" :key="id" variant="secondary" :disabled="busy" @click="readOriginals(id)">
                读取原件列表
              </KitButton>
            </div>
          </li>
        </ul>
        <ul class="mt-3 grid gap-2 text-12px">
          <li v-for="file in files" :key="file.id">
            <a v-if="file.url" :href="file.url" :download="file.name" class="text-brand underline">{{ file.name || file.id }} · 下载保留的原件</a><span v-else>{{ file.name || file.id }} · 原来源没有正文，缺件证据保留</span>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
