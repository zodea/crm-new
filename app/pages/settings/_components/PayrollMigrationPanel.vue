<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { PayrollImportInput, PayrollImportMapping, PayrollImportPreview, PayrollImportResult, PayrollImportState } from '~/lib/payroll/production-import'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useKitUI } from '~/composables/useKitUI'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { createPayrollImportRepository } from '~/lib/payroll/production-import-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

const repository = createPayrollImportRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
const kit = useKitUI()
const recovery = createCommandRecoveryStorage(() => sessionStorage)
const state = shallowRef<PayrollImportState | null>(null)
const source = shallowRef<PayrollImportInput['source'] | null>(null)
const preview = shallowRef<PayrollImportPreview | null>(null)
const result = shallowRef<PayrollImportResult | null>(null)
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const selections = ref<Record<string, string>>({})
const notes = ref<Record<string, string>>({})
const sourceName = ref('')
const busy = ref(false)
const error = ref('')
let generation = 0
let active = true
const family = 'payroll-import'
const key = () => state.value ? commandRecoveryKey({ ...state.value.context, family, targetId: null }) : ''
const rowKey = (row: { entityType: string, legacyId: string }) => JSON.stringify([row.entityType, row.legacyId])
const mappings = computed<PayrollImportMapping[]>(() => (preview.value?.requiredReferences ?? []).flatMap((row) => {
  const selected = state.value?.references.find(candidate => candidate.entityType === row.entityType && candidate.serverId === selections.value[rowKey(row)])
  return selected && notes.value[rowKey(row)]?.trim() ? [{ entityType: row.entityType, legacyId: row.legacyId, serverId: selected.serverId, version: selected.version, sourceVersion: selected.sourceVersion, evidenceNote: notes.value[rowKey(row)]! }] : []
}))
function current(token: number) {
  if (!active || token !== generation)
    throw new Error('工资迁入身份或来源已变化，请保留原文件与原提交编号。')
}
bindReadAuthority((problem) => {
  generation++
  state.value = null
  preview.value = null
  result.value = null
  pending.value = null
  busy.value = false
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load() {
  const token = ++generation
  busy.value = true
  error.value = ''
  try {
    const value = await repository.state()
    current(token)
    state.value = value
    pending.value = recovery.read(key())
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || busy.value || pending.value)
    return
  const token = generation
  busy.value = true
  error.value = ''
  try {
    const bytes = await file.arrayBuffer()
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const upload = await fileRefDraftFromFile(file, { category: 'sqlite-migration-source' })
    current(token)
    source.value = { sha256: digest, payloadBase64: upload.payloadBase64! }
    sourceName.value = file.name
    preview.value = null
    result.value = null
    selections.value = {}
    notes.value = {}
    await inspect()
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
function input(commandId: string): PayrollImportInput {
  if (!state.value || !source.value)
    throw new Error('请读取正式目录并明确选择完整SQLite文件。')
  return { workspaceId: state.value.context.workspaceId, actorId: state.value.context.actorId, commandId, action: 'preview', source: source.value, referenceMappings: mappings.value }
}
async function inspect() {
  if (!state.value || pending.value)
    return
  const token = generation
  busy.value = true
  if (preview.value)
    preview.value.eligible = false
  error.value = ''
  try {
    const value = await repository.preview(input(generateId('payroll-preview')))
    current(token)
    preview.value = value
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function adopt() {
  if (!preview.value?.eligible || busy.value || pending.value || !state.value)
    return
  if (!await kit.confirm({ variant: 'simple', title: '确认完整工资迁入', message: '按已核对身份采用完整工资原图、历史与固定引用。不会复制人员主档或另记成本现金。', confirmLabel: '确认接管' }))
    return
  const token = generation
  const command = { ...input(generateId('payroll-import')), action: 'adopt' as const }
  const descriptor: CommandRecoveryDescriptor = { ...state.value.context, family, commandId: command.commandId, targetId: null, action: 'adopt', scopeId: command.source.sha256 }
  // Context capabilities never enter the minimal recovery record or the closed command envelope.
  const marker = { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, family, commandId: descriptor.commandId, targetId: null, action: 'adopt', scopeId: descriptor.scopeId }
  const body = { workspaceId: command.workspaceId, actorId: command.actorId, commandId: command.commandId, action: command.action, source: command.source, referenceMappings: command.referenceMappings }
  busy.value = true
  error.value = ''
  try {
    recovery.remember(key(), marker)
    pending.value = marker
    const saved = await repository.adopt(body)
    current(token)
    result.value = saved
    const verified = await repository.state()
    current(token)
    if (verified.context.workspaceId !== marker.workspaceId || verified.context.actorId !== marker.actorId || !verified.sources.some(row => row.sourceSha256 === saved.sourceSha256 && row.adoptedAt === saved.adoptedAt))
      throw new Error('已保存工资原图尚未从同一正式来源读取确认，请保留原编号。')
    state.value = verified
    recovery.clear(key(), marker.commandId)
    pending.value = null
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function recover() {
  if (!pending.value || busy.value)
    return
  const token = generation
  const marker = pending.value
  busy.value = true
  error.value = ''
  try {
    const resolution = await repository.resolve(marker.commandId)
    current(token)
    if (resolution.outcome === 'applied') {
      if (marker.scopeId && resolution.result.sourceSha256 !== marker.scopeId)
        throw new Error('原迁入结果与来源摘要不匹配。')
      result.value = resolution.result
      const verified = await repository.state()
      current(token)
      if (verified.context.workspaceId !== marker.workspaceId || verified.context.actorId !== marker.actorId || !verified.sources.some(row => row.sourceSha256 === resolution.result.sourceSha256 && row.adoptedAt === resolution.result.adoptedAt))
        throw new Error('原工资已保存，但同一正式目标尚未读取确认。')
      state.value = verified
    }
    recovery.clear(key(), marker.commandId)
    pending.value = null
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
</script>

<template>
  <details class="panel min-w-0 p-4" @toggle="($event.target as HTMLDetailsElement).open && !state && !busy && load()">
    <summary class="cursor-pointer text-14px font-700">
      完整工资 SQLite 迁入
    </summary>
    <div class="mt-4 grid min-w-0 gap-4">
      <p class="text-12px leading-6 text-ink-soft">
        选择从现有桌面维护出口导出的完整 SQLite 文件。完整原文件在外部保留；这里保全工资原图、原 JSON、稳定身份与历史，复用已接管的人员、工程量及照片原件。
      </p>
      <p v-if="error" role="alert" class="text-13px text-danger">
        {{ error }}
      </p>
      <KitButton v-if="!state" :loading="busy" @click="load">
        读取正式工资目录
      </KitButton>
      <template v-if="state">
        <label class="grid gap-2 text-13px">选择完整 SQLite 文件<input type="file" accept=".sqlite,.sqlite3,.db" :disabled="busy || !!pending" @change="selectFile"></label>
        <p v-if="sourceName" class="break-all text-12px text-ink-soft">
          已选 {{ sourceName }}
        </p>
        <div v-if="pending" role="status" class="grid gap-2 rounded-lg border border-line p-3">
          <p class="text-13px">
            原工资迁入结果待核对，继续使用原编号 {{ pending.commandId }}。
          </p><KitButton :loading="busy" @click="recover">
            核对原工资迁入
          </KitButton>
        </div>
        <div v-if="preview" class="grid gap-3">
          <p class="text-13px">
            来源工资项目：{{ preview.projects.map(project => project.label).join('、') || '未找到完整工资项目' }}
          </p>
          <div v-for="row in preview.requiredReferences" :key="rowKey(row)" class="grid min-w-0 gap-2 rounded-lg border border-line p-3 md:grid-cols-2">
            <label class="grid gap-1 text-12px">{{ row.label }} · 原身份 {{ row.legacyId }}<select v-model="selections[rowKey(row)]" :disabled="busy || !!pending" class="form-input min-w-0" @change="preview.eligible = false"><option value="">明确选择现有真实身份</option><option v-for="candidate in state.references.filter(candidate => candidate.entityType === row.entityType)" :key="candidate.serverId" :value="candidate.serverId">{{ candidate.label }} · {{ candidate.serverId }}{{ candidate.deleted ? '（历史隐藏）' : '' }}</option></select></label>
            <label class="grid gap-1 text-12px">原身份核验依据<input v-model="notes[rowKey(row)]" :disabled="busy || !!pending" class="form-input min-w-0" @input="preview.eligible = false"></label>
          </div>
          <p v-for="reason in preview.blockingReasons" :key="reason" class="text-12px text-warning">
            {{ reason }}
          </p>
          <p v-for="reason in preview.diagnostics" :key="reason" class="text-12px text-ink-soft">
            {{ reason }}
          </p>
          <div class="flex flex-wrap gap-2">
            <KitButton :disabled="busy || !!pending" @click="inspect">
              重新核对完整原图与映射
            </KitButton><KitButton variant="primary" :loading="busy" :disabled="!preview.eligible || !!pending" @click="adopt">
              确认完整工资接管
            </KitButton>
          </div>
        </div>
        <p v-if="result" role="status" class="text-13px">
          工资原图已保存，原工资 {{ result.statementIds.length }} 份。原号、配置、P4–P7、固定名册和目录沿原引用保留，未重新发工资或记现金。
        </p>
      </template>
    </div>
  </details>
</template>
