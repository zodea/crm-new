<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { OtherSettlementImportPreview } from '~/lib/other-settlement/import-repository'
import type { OtherSettlementMigrationRequest, OtherSettlementMigrationResult } from '~/lib/other-settlement/migration-contract'
import { onBeforeRouteLeave } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createOtherSettlementImportRepository } from '~/lib/other-settlement/import-repository'
import { otherSettlementFingerprint } from '~/lib/other-settlement/storage'
import { bindReadAuthority } from '~/lib/read-model/authority'

const repository = createOtherSettlementImportRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
const business = useNuxtApp().$repositories.otherSettlements
const recovery = createCommandRecoveryStorage()
const kit = useKitUI()
const context = shallowRef<Awaited<ReturnType<typeof business.context>> | null>(null)
const source = shallowRef<OtherSettlementMigrationRequest['source'] | null>(null)
const preview = shallowRef<OtherSettlementImportPreview | null>(null)
const targets = ref<Record<string, string>>({})
const reasons = ref<Record<string, string>>({})
const confirmed = ref(false)
const busy = ref(false)
const error = ref('')
const done = shallowRef<OtherSettlementMigrationResult | null>(null)
const pending = shallowRef<{
  descriptor: CommandRecoveryDescriptor
  key: string
  result: OtherSettlementMigrationResult | null
} | null>(null)
const appliedProofs = new Map<string, { commandId: string, result: OtherSettlementMigrationResult }>()
function knownApplied(item: NonNullable<typeof pending.value>) {
  const proof = appliedProofs.get(item.key)
  return proof?.commandId === item.descriptor.commandId ? proof.result : null
}
const mappings = computed(() => preview.value?.references.flatMap((ref) => {
  const key = `${ref.entityType}:${ref.legacyId}`
  const target = preview.value!.candidates.find(row => row.entityType === ref.entityType && row.serverId === targets.value[key])
  return target && reasons.value[key]?.trim() ? [{ entityType: ref.entityType, legacyId: ref.legacyId, targetId: target.serverId, version: target.version, sourceVersion: target.sourceVersion, reason: reasons.value[key]!.trim() }] : []
}) ?? [])
const ready = computed(() => Boolean(source.value && preview.value && confirmed.value && mappings.value.length === preview.value.references.length && !pending.value && !busy.value))
watch([targets, reasons], () => {
  confirmed.value = false
}, { deep: true })
let generation = 0
let active = true
function fence(current: number) {
  if (!active || current !== generation)
    throw new Error('原操作已因身份变化或页面离开失效；来源与原编号保留')
}
function retainApplied(item: NonNullable<typeof pending.value>, result: OtherSettlementMigrationResult, current: number) {
  fence(current)
  if (pending.value?.key !== item.key || pending.value.descriptor.commandId !== item.descriptor.commandId || context.value?.workspaceId !== item.descriptor.workspaceId || context.value.actorId !== item.descriptor.actorId || result.commandId !== item.descriptor.commandId)
    throw new Error('结算迁入保存证明不属于当前原编号和原身份；原编号保留')
  const prior = knownApplied(item)
  if (prior && otherSettlementFingerprint(prior) !== otherSettlementFingerprint(result))
    throw new Error('原结算迁入保存证明出现冲突；请保留原编号')
  appliedProofs.set(item.key, { commandId: item.descriptor.commandId, result: structuredClone(result) })
}
let sourceAuthority: {
  workspaceId: string
  actorId: string
} | null = null
async function authorize(original: {
  workspaceId: string
  actorId: string
}, current: number) {
  fence(current)
  const actor = await business.context()
  fence(current)
  if (actor.workspaceId !== original.workspaceId || actor.actorId !== original.actorId || !actor.capabilities.includes('core:migration:write') || !actor.capabilities.includes('other-settlement:write')) {
    invalidate()
    throw new Error('迁入身份或权限变化，请恢复原会话后核对原编号')
  }
  context.value = actor
  return actor
}
async function readApplied(result: OtherSettlementMigrationResult, current: number) {
  const item = pending.value!
  await authorize(item.descriptor, current)
  const proof = await repository.list()
  fence(current)
  await authorize(item.descriptor, current)
  if (result.commandId !== item.descriptor.commandId || proof.meta.workspaceId !== item.descriptor.workspaceId || proof.meta.actorId !== item.descriptor.actorId || !proof.records.some(row => row.commandId === result.commandId && row.graphHash === result.graphHash && row.sourceBytesSha256 === result.sourceBytesSha256 && JSON.stringify(row.ids) === JSON.stringify(result.ids)))
    throw new Error('原迁入已保存但尚未可靠读回，请只核对原编号')
  recovery.clear(item.key, item.descriptor.commandId)
  appliedProofs.delete(item.key)
  pending.value = null
  done.value = result
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
    fence(current)
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
async function initialize() {
  const current = ++generation
  error.value = ''
  context.value = null
  try {
    const actor = await business.context()
    if (!active || current !== generation)
      return
    if (sourceAuthority && (sourceAuthority.workspaceId !== actor.workspaceId || sourceAuthority.actorId !== actor.actorId))
      throw new Error('当前来源属于原会话，请恢复原身份或明确清除来源')
    context.value = actor
    const key = commandRecoveryKey({ ...actor, family: 'other-settlement-import', targetId: null })
    const descriptor = recovery.read(key)
    if (descriptor) {
      pending.value = { descriptor, key, result: null }
      await recover()
    }
    else if (source.value && !preview.value) {
      const result = await repository.preview(source.value)
      await authorize(actor, current)
      if (result.meta.workspaceId !== actor.workspaceId || result.meta.actorId !== actor.actorId)
        throw new Error('来源核验身份不一致')
      preview.value = result
    }
  }
  catch (cause) {
    handleFailure(cause, current)
  }
}
async function setBytes(bytes: Uint8Array, actor: NonNullable<typeof context.value>, current: number) {
  fence(current)
  if (!actor || pending.value)
    return
  const ownedBytes = new Uint8Array(bytes.length)
  ownedBytes.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', ownedBytes.buffer)
  fence(current)
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  const payload = { sha256, payloadBase64: btoa(binary) }
  await authorize(actor, current)
  const result = await repository.preview(payload)
  fence(current)
  await authorize(actor, current)
  if (result.meta.workspaceId !== actor.workspaceId || result.meta.actorId !== actor.actorId)
    throw new Error('完整来源核验属于其他工作区或操作者；未采用本次来源')
  source.value = payload
  preview.value = result
  targets.value = {}
  reasons.value = {}
  confirmed.value = false
  sourceAuthority = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  done.value = null
  error.value = ''
}
async function file(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  const actor = context.value
  const current = generation
  if (!selected || !actor || pending.value || busy.value)
    return
  busy.value = true
  try {
    if (selected.size > 64 * 1024 * 1024)
      throw new Error('完整原库超过本次已核验的64 MiB读取范围，请保留原库')
    const bytes = new Uint8Array(await selected.arrayBuffer())
    fence(current)
    await setBytes(bytes, actor, current)
  }
  catch (cause) {
    handleFailure(cause, current)
  }
  finally {
    if (active && current === generation)
      busy.value = false;
    (event.target as HTMLInputElement).value = ''
  }
}
async function importSource() {
  const actor = context.value
  if (!actor || !source.value || !ready.value)
    return
  const current = generation
  const request: OtherSettlementMigrationRequest = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: crypto.randomUUID(), source: structuredClone(source.value), mappings: structuredClone(mappings.value) }
  const descriptor = { ...actor, commandId: request.commandId, family: 'other-settlement-import', targetId: null, action: 'import' }
  const safeDescriptor: CommandRecoveryDescriptor = { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, commandId: descriptor.commandId, family: descriptor.family, targetId: null, action: 'import' }
  const key = commandRecoveryKey(safeDescriptor)
  busy.value = true
  try {
    recovery.remember(key, safeDescriptor)
    pending.value = { descriptor: safeDescriptor, key, result: null }
    await authorize(actor, current)
    const result = await repository.execute(request)
    if (!active || generation !== current)
      return
    retainApplied(pending.value!, result, current)
    await authorize(actor, current)
    pending.value = { ...pending.value!, result }
    await readApplied(result, current)
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
function clearSource() {
  if (pending.value)
    return
  source.value = null
  preview.value = null
  targets.value = {}
  reasons.value = {}
  confirmed.value = false
  sourceAuthority = null
}
function invalidate() {
  generation++
  context.value = null
  if (pending.value)
    pending.value = { ...pending.value, result: null }
  preview.value = null
  done.value = null
  confirmed.value = false
  busy.value = false
  error.value = '身份或来源变化，请恢复原会话并核对原迁入编号'
}
function handleFailure(cause: unknown, current: number) {
  if (!active || current !== generation)
    return
  const problem = auxiliaryProblemFromUnknown(cause).problem
  if (problem.code === 'unauthenticated' || problem.code === 'forbidden')
    invalidate()
  error.value = problem.message
}
bindReadAuthority(invalidate)
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
const canLeave = () => (!pending.value && (!source.value || Boolean(done.value))) || kit.confirm({ variant: 'simple', title: '离开迁入核验', message: pending.value ? '原迁入仍需核对；编号已保留，重新打开后请继续核对原编号。确认离开？' : '来源包与逐条关系尚未迁入，确认离开？', confirmLabel: '离开' })
onBeforeRouteLeave(canLeave)
useTabCloseGuard(canLeave)
onMounted(initialize)
useTabTitle('支出结算历史迁入')
</script>

<template>
  <EntityFormShell title="支出结算历史迁入" back-label="返回结算" :sections="[{ key: 'source', label: '完整原库' }, { key: 'relations', label: '逐条关系确认' }]" :state="context ? 'ready' : error ? 'error' : 'loading'" :state-title="error" state-action-label="重新核对会话" @back="navigateTo('/contract/other-settlement')" @state-action="initialize">
    <div class="min-w-0 space-y-4">
      <p v-if="error" role="alert" class="rounded border border-danger/30 p-3 text-13px text-danger">
        {{ error }}
      </p>
      <div v-if="pending" role="status" class="rounded border border-line p-3 text-13px">
        <p class="break-all">
          {{ pending.result ? '已保存待刷新，只重试读取' : '提交结果未知，请核对原编号' }} · {{ pending.descriptor.commandId }}
        </p><KitButton :disabled="busy" @click="recover">
          核对原迁入
        </KitButton>
      </div>
      <section id="source" class="panel min-w-0 p-4">
        <SectionHeader title="完整 Native 原库" /><p class="text-13px leading-6">
          保留原稳定ID、原文、原件、旧审计及原命令。旧回执作为历史证据保存；当前付款来源仍须真实费用与当前可核实的结算净额。
        </p><label class="block text-13px">选择完整 SQLite 原库<input type="file" accept=".sqlite,.db,.sqlite3" :disabled="Boolean(pending) || busy" class="mt-2 block max-w-full" @change="file"></label><div class="mt-3 flex flex-wrap gap-2">
          <NuxtLink to="/settings/data-migration#finance-migration-title" class="text-13px text-brand underline">
            从桌面设置导出完整一致快照
          </NuxtLink><KitButton :disabled="Boolean(pending) || busy || !source" @click="clearSource">
            明确清除来源包
          </KitButton>
        </div><p v-if="source" class="break-all text-12px text-ink-soft">
          完整原库 SHA-256 {{ source.sha256 }}
        </p><p v-if="preview" class="text-13px">
          实际现行结算 {{ preview.heads.length }} 条；冻结原图摘要 {{ preview.graphHash }}
        </p>
      </section>
      <section v-if="preview" id="relations" class="panel min-w-0 p-4">
        <SectionHeader title="逐条确认实际主档" /><div v-for="ref in preview.references" :key="`${ref.entityType}:${ref.legacyId}`" class="mt-3 grid min-w-0 gap-3 rounded border border-line p-3 md:grid-cols-2">
          <p class="m-0 min-w-0 break-all text-13px">
            原{{ ref.entityType === 'projects' ? '项目' : ref.entityType === 'workers' ? '工人' : '分供方' }} {{ ref.label }} · {{ ref.legacyId }}
          </p><label class="text-13px">当前真实目标<select v-model="targets[`${ref.entityType}:${ref.legacyId}`]" class="field-input mt-2 w-full min-w-0"><option value="">请选择实际主档</option><option v-for="target in preview.candidates.filter(row => row.entityType === ref.entityType)" :key="target.serverId" :value="target.serverId">{{ target.label }} · {{ target.serverId }}</option></select></label><label class="text-13px md:col-span-2">身份核对依据<input v-model="reasons[`${ref.entityType}:${ref.legacyId}`]" class="field-input mt-2 w-full" placeholder="根据原件与实际主档逐条核对，不按同名推断"></label>
        </div><label class="mt-4 flex items-start gap-2 text-13px"><input v-model="confirmed" type="checkbox"><span>已核对每条真实关系，确认迁入冻结原图与原件；未核实的旧付款或奖罚净额保持未知。</span></label>
      </section>
      <section v-if="done" role="status" class="panel p-4">
        <p class="text-13px">
          原图已保存并读取核验。
        </p><NuxtLink v-for="target in done.ids" :key="target" :to="`/contract/other-settlement/${target}?origin=real`" class="mr-3 inline-block break-all text-13px text-brand underline">
          查看原结算 {{ target }}
        </NuxtLink>
      </section>
    </div><template #footer>
      <KitButton variant="primary" :disabled="!ready" @click="importSource">
        确认迁入原结算图
      </KitButton>
    </template>
  </EntityFormShell>
</template>
