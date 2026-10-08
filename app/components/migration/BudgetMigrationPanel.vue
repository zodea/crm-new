<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { BudgetImportCommand, BudgetImportPreview, BudgetImportResult } from '~/lib/target-cost/import-contract'
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

interface State {
  context: { workspaceId: string, actorId: string, capabilities: string[] }
  sources: Array<{ importId: string, sourceSha256: string, ids: string[], importedAt: string, restored: boolean }>
}
const native = isTauri()
const state = shallowRef<State | null>(null)
const source = shallowRef<BudgetImportCommand['source'] | null>(null)
const preview = shallowRef<BudgetImportPreview | null>(null)
const selected = ref<Record<string, string>>({})
const originals = shallowRef<Array<{ fileId: string, payloadBase64: string }>>([])
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const known = shallowRef<BudgetImportResult | null>(null)
const result = shallowRef<BudgetImportResult | null>(null)
const busy = ref(false)
const error = ref('')
const sourceName = ref('')
const recovery = createCommandRecoveryStorage()
const { confirm } = useKitUI()
let active = true
let generation = 0
const scope = computed(() => state.value ? { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, family: 'target-cost-import', targetId: null } : null)
const key = computed(() => scope.value ? commandRecoveryKey(scope.value) : '')
const mappings = computed(() => (preview.value?.references ?? []).flatMap((row) => {
  const project = preview.value?.projects.find(project => project.id === selected.value[row.id])
  return project ? [{ legacyProjectId: row.id, projectId: project.id, version: project.version }] : []
}))
const canAdopt = computed(() => !!preview.value && !!source.value && !busy.value && !pending.value && mappings.value.length === preview.value.references.length && preview.value.requiredOriginals.every(file => originals.value.some(original => original.fileId === file.id)))
bindReadAuthority((problem) => {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  known.value = null
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
function identity(value: State['context']) {
  return JSON.stringify([value.workspaceId, value.actorId, [...value.capabilities].sort()])
}
async function readState(epoch: number, authority?: State['context']) {
  const value = await $fetch<State, string>('/api/read/target-costs/import', { retry: 0 })
  if (!active || epoch !== generation || !value?.context || !Array.isArray(value.sources) || !value.context.capabilities.includes('target-cost:import') || (authority && identity(value.context) !== identity(authority)))
    throw new Error('预算迁入读取身份或来源已变化，保留原编号核对')
  state.value = value
  pending.value = recovery.read(commandRecoveryKey({ ...value.context, family: 'target-cost-import', targetId: null }))
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
    const bytes = new Uint8Array(await file.arrayBuffer())
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const converted = await fileRefDraftFromFile(file)
    if (!active || epoch !== generation || typeof converted.payloadBase64 !== 'string')
      throw new Error('预算来源文件尚未完整读取')
    source.value = { sha256, payloadBase64: converted.payloadBase64 }
    sourceName.value = file.name
    preview.value = null
    selected.value = {}
    originals.value = []
    const authority = state.value?.context
    if (!authority)
      throw new Error('请先读取正式接管权限')
    const value = await $fetch<BudgetImportPreview, string>('/api/commands/target-costs/import/preflight', { method: 'POST', retry: 0, body: { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId: generateId('budget-preflight'), source: source.value, mappings: [] } })
    if (!active || epoch !== generation || value.sourceSha256 !== sha256 || !Array.isArray(value.versions) || !Array.isArray(value.projects) || !Array.isArray(value.requiredOriginals))
      throw new Error('预算来源预检不完整')
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
      throw new Error('预算原件没有完整读取')
    originals.value = [...originals.value.filter(row => row.fileId !== fileId), { fileId, payloadBase64: converted.payloadBase64 }]
  })
}
async function finish(receipt: BudgetImportResult, epoch: number) {
  const descriptor = pending.value
  const authority = state.value?.context
  if (!descriptor || !authority || receipt.commandId !== descriptor.commandId || !Array.isArray(receipt.ids) || typeof receipt.importId !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sourceSha256))
    throw new Error('原预算接管回执与编号不一致，请保留原编号')
  known.value = receipt
  const value = await readState(epoch, authority)
  if (!value.sources.some(row => row.importId === receipt.importId && row.sourceSha256 === receipt.sourceSha256))
    throw new Error('已应用的预算来源尚未可靠读取，请只重试读取')
  recovery.clear(key.value, descriptor.commandId)
  pending.value = null
  known.value = null
  result.value = receipt
}
async function adopt() {
  if (!canAdopt.value || !state.value || !source.value)
    return
  await run(async (epoch) => {
    const command: BudgetImportCommand = { workspaceId: state.value!.context.workspaceId, actorId: state.value!.context.actorId, commandId: generateId('budget-import'), source: source.value!, mappings: mappings.value, originals: originals.value }
    const descriptor = { ...scope.value!, commandId: command.commandId, action: 'adopt' }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<BudgetImportResult, string>('/api/commands/target-costs/import', { method: 'POST', retry: 0, body: command }), epoch)
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
    const resolution = await $fetch<{ outcome: string, result?: BudgetImportResult, commandId?: string }, string>('/api/commands/target-costs/import/resolve', { method: 'POST', retry: 0, body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId } })
    if (resolution.outcome === 'applied' && resolution.result) {
      await finish(resolution.result, epoch)
    }
    else if (resolution.outcome === 'not-applied' && resolution.commandId === descriptor.commandId) {
      await readState(epoch, state.value!.context)
      recovery.clear(key.value, descriptor.commandId)
      pending.value = null
      error.value = '原编号已确认未应用并封存，请核对原库和映射后重新接管。'
    }
    else { throw new Error('原预算接管结果尚未核实') }
  })
}
async function restore(importId: string) {
  if (!state.value || pending.value || !await confirm({ variant: 'simple', title: '恢复预算接管', message: '只撤除本批未发生日常更正的预算；原库证据保留。有后来真实事实时整批拒绝。', confirmLabel: '核对并恢复' }))
    return
  await run(async (epoch) => {
    const descriptor = { ...scope.value!, commandId: generateId('budget-restore'), action: 'restore' }
    recovery.remember(key.value, descriptor)
    pending.value = descriptor
    await finish(await $fetch<BudgetImportResult, string>('/api/commands/target-costs/import/restore', { method: 'POST', retry: 0, body: { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, commandId: descriptor.commandId, importId } }), epoch)
  })
}
onMounted(() => {
  if (!native)
    void run(async (epoch) => { await readState(epoch) })
})
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="预算正式接管">
    <h3 class="text-14px font-800">
      目标成本预算接管
    </h3>
    <p class="mt-2 text-12px text-ink-soft">
      选择完整 SQLite 原库，明确映射项目并补齐路径原件。预算、科目、原件和历史一起接管；已接管后继续从目标成本维护。
    </p>
    <p v-if="native" class="mt-3 text-12px text-warn-ink">
      请从已配置的本机正式浏览器入口接管预算。
    </p>
    <template v-else>
      <p v-if="error" role="alert" class="mt-3 break-words text-12px text-danger">
        {{ error }}
      </p>
      <KitButton v-if="!state" class="mt-3" :disabled="busy" @click="run(async epoch => { await readState(epoch) })">
        重新读取接管权限
      </KitButton>
      <template v-if="state">
        <label class="mt-4 block text-12px">预算 SQLite 原库<input type="file" accept=".sqlite,.db,.sqlite3" class="mt-2 block w-full" :disabled="busy || !!pending" @change="choose"></label>
        <p v-if="sourceName" class="mt-2 break-words text-12px">
          {{ sourceName }}
        </p>
        <div v-if="preview" class="mt-4 grid min-w-0 gap-3 text-12px">
          <p>原库包含 {{ preview.versions.length }} 个预算版本；历史空值、已删除明细和未知扩展一并保留。</p>
          <label v-for="reference in preview.references" :key="reference.id" class="grid min-w-0 gap-2">原项目：{{ reference.name }}（{{ reference.id }}）<select v-model="selected[reference.id]" class="field-input w-full" :disabled="busy || !!pending"><option value="">明确选择正式项目</option><option v-for="project in preview.projects" :key="project.id" :value="project.id">{{ project.name }}（{{ project.id }}）{{ project.deletedAt ? ' · 已删除，仅保历史关联' : '' }}</option></select></label>
          <label v-for="file in preview.requiredOriginals" :key="file.id" class="grid gap-2">补齐原件：{{ file.name }}<input type="file" :disabled="busy || !!pending" @change="original(file.id, $event)"></label>
          <KitButton class="justify-self-start" :disabled="!canAdopt" @click="adopt">
            核对并接管预算
          </KitButton>
        </div>
        <div v-if="pending" class="mt-4 text-12px">
          <p>原提交结果待核对；正文保留在当前页面，刷新后只按原编号查询。</p><KitButton class="mt-2" :disabled="busy" @click="recover">
            核对原预算提交
          </KitButton>
        </div>
        <p v-if="result" class="mt-3 text-12px text-ok">
          {{ result.restored ? '原批次已恢复，原库证据仍保留。' : '预算接管已核对，可从目标成本列表读取。' }}
        </p>
        <ul class="mt-4 grid min-w-0 gap-3 text-12px">
          <li v-for="item in state.sources" :key="item.importId" class="min-w-0 border-t border-line pt-3">
            <p class="break-words">
              {{ item.importedAt }} · {{ item.ids.length }} 个版本 · {{ item.restored ? '已恢复' : '已接管' }}
            </p><KitButton v-if="!item.restored" class="mt-2" variant="secondary" :disabled="busy || !!pending" @click="restore(item.importId)">
              核对并恢复本批预算
            </KitButton>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
