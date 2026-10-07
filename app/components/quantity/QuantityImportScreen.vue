<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { readQuantityRecoveryForRoute } from '~/lib/quantity/command-recovery'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { problemFromHttpFailure } from '~/lib/read-model/problem'
import { generateId } from '~/lib/util/id'

interface Catalog {
  context: { workspaceId: string, actorId: string, capabilities: string[] }
  projects: Array<{ serverId: string, label: string, version: string }>
  people: Array<{ kind: 'crew' | 'worker', id: string, name: string, version: string, deleted: boolean }>
  imports: Array<{ id: string, source_sha256: string, created_at: string, restored: number }>
}
interface Inspection { sourceSha256: string, schemaVersion: number, projects: Array<{ id: string, name: string }>, people: Array<{ kind: 'crew' | 'worker', id: string }> }
interface Receipt { commandId: string, importId: string, sourceSha256?: string, outcome?: 'restored', preservedOriginals?: boolean }
const catalog = shallowRef<Catalog | null>(null)
const inspection = shallowRef<Inspection | null>(null)
const source = shallowRef<{ sha256: string, payloadBase64: string } | null>(null)
const sourceName = ref('')
const projectSelections = ref<Record<string, string>>({})
const peopleSelections = ref<Record<string, string>>({})
const pending = shallowRef<CommandRecoveryDescriptor[]>([])
const known = shallowRef<Receipt | null>(null)
const busy = ref(false)
const error = ref('')
const success = ref('')
const codec = createCommandRecoveryStorage()
const { confirm } = useKitUI()
useTabTitle('工程量原库接管')
let active = true
let generation = 0
const projects = computed(() => inspection.value?.projects.flatMap((row) => {
  const selected = catalog.value?.projects.find(project => project.serverId === projectSelections.value[row.id])
  return selected ? [{ legacyId: row.id, projectId: selected.serverId, version: selected.version }] : []
}) ?? [])
const people = computed(() => inspection.value?.people.flatMap((row) => {
  const selected = catalog.value?.people.find(person => person.kind === row.kind && person.id === peopleSelections.value[`${row.kind}:${row.id}`])
  return selected ? [{ kind: row.kind, legacyId: row.id, id: selected.id, version: selected.version }] : []
}) ?? [])
const canAdopt = computed(() => !busy.value && !pending.value.length && !!source.value && !!inspection.value?.projects.length && projects.value.length === inspection.value.projects.length && new Set(projects.value.map(row => row.projectId)).size === projects.value.length && people.value.length === inspection.value.people.length)
function identity(context: Catalog['context']) {
  return JSON.stringify([context.workspaceId, context.actorId, [...context.capabilities].sort()])
}
function assertCurrent(epoch: number) {
  if (!active || epoch !== generation)
    throw new Error('工程量来源或权限已切换，原提交定位仍保留。')
}
bindReadAuthority((problem) => {
  generation++
  catalog.value = null
  inspection.value = null
  source.value = null
  known.value = null
  error.value = problem.message
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load(epoch: number, authority?: Catalog['context']) {
  const value = await $fetch<Catalog, string>('/api/read/quantity/import', { retry: 0 })
  assertCurrent(epoch)
  if (!value?.context || !Array.isArray(value.projects) || !Array.isArray(value.people) || !Array.isArray(value.imports) || (authority && identity(authority) !== identity(value.context)))
    throw new Error('工程量采用状态与当前身份无法核对。')
  catalog.value = value
  pending.value = readQuantityRecoveryForRoute('/subcontract/quantity/import?origin=real', value.context, sessionStorage)
  return value
}
async function run(work: (epoch: number) => Promise<void>) {
  if (busy.value)
    return
  const epoch = generation
  busy.value = true
  error.value = ''
  try {
    await work(epoch)
  }
  catch (cause) {
    if (active && epoch === generation)
      error.value = problemFromHttpFailure(cause)?.message ?? (cause instanceof Error ? cause.message : '工程量接管暂时不可用。')
  }
  finally {
    if (active)
      busy.value = false
  }
}
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || pending.value.length)
    return
  await run(async (epoch) => {
    inspection.value = null
    source.value = null
    projectSelections.value = {}
    peopleSelections.value = {}
    const bytes = new Uint8Array(await file.arrayBuffer())
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const body = await fileRefDraftFromFile(file)
    assertCurrent(epoch)
    const authority = catalog.value?.context
    if (!authority || typeof body.payloadBase64 !== 'string')
      throw new Error('原库尚未完整读取或缺少正式权限。')
    source.value = { sha256, payloadBase64: body.payloadBase64 }
    sourceName.value = file.name
    const preview = await $fetch<Inspection, string>('/api/commands/quantity/import', { method: 'POST', retry: 0, body: { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId: generateId('quantity-inspect'), action: 'inspect', source: source.value, projects: [], people: [] } })
    assertCurrent(epoch)
    if (preview.sourceSha256 !== sha256 || !Array.isArray(preview.projects) || !Array.isArray(preview.people))
      throw new Error('完整来源的领域预检不可靠。')
    await load(epoch, authority)
    inspection.value = preview
  })
}
function remember(descriptor: CommandRecoveryDescriptor) {
  codec.remember(commandRecoveryKey(descriptor), descriptor)
  pending.value = [...pending.value, descriptor]
}
async function finish(receipt: Receipt, descriptor: CommandRecoveryDescriptor, epoch: number) {
  assertCurrent(epoch)
  if (receipt.commandId !== descriptor.commandId || typeof receipt.importId !== 'string' || (descriptor.action === 'adopt' ? receipt.sourceSha256 !== descriptor.scopeId : receipt.importId !== descriptor.targetId || receipt.outcome !== 'restored'))
    throw new Error('原采用或恢复回执与原范围不同。')
  known.value = receipt
  const authority = catalog.value?.context
  if (!authority)
    throw new Error('当前身份已变化，请保留原编号。')
  const current = await load(epoch, authority)
  if (!current.imports.some(row => row.id === receipt.importId && row.source_sha256 === descriptor.scopeId && (descriptor.action !== 'restore' || row.restored)))
    throw new Error('已保存结果尚未可靠读回，请核对原编号。')
  codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
  pending.value = readQuantityRecoveryForRoute('/subcontract/quantity/import?origin=real', current.context, sessionStorage)
  known.value = null
  success.value = descriptor.action === 'adopt' ? '工程量已接管，可从工程量矩阵读取。' : '该批采用已恢复，原件、原审计与回执仍保留。'
}
async function adopt() {
  if (!canAdopt.value || !catalog.value || !source.value)
    return
  if (!await confirm({ title: '采用完整工程量', message: '按明确项目与责任身份接管本域区域、模板、三量、完成及原照片。目标已有工程量时整批拒绝。原 SQLite 文件继续由你保留。', variant: 'simple' }))
    return
  await run(async (epoch) => {
    const authority = catalog.value!.context
    const commandId = generateId('quantity-adopt')
    const descriptor = { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId, family: 'quantity-import', action: 'adopt', targetId: null, scopeId: source.value!.sha256 }
    const command = { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId, action: 'adopt', source: source.value, projects: projects.value, people: people.value }
    remember(descriptor)
    const receipt = await $fetch<Receipt, string>('/api/commands/quantity/import', { method: 'POST', retry: 0, body: command })
    await finish(receipt, descriptor, epoch)
  })
}
async function recover(descriptor: CommandRecoveryDescriptor) {
  await run(async (epoch) => {
    const authority = catalog.value?.context
    if (!authority || authority.workspaceId !== descriptor.workspaceId || authority.actorId !== descriptor.actorId)
      throw new Error('请回到原工作区与操作者核对。')
    if (known.value?.commandId === descriptor.commandId)
      return finish(known.value, descriptor, epoch)
    const result = await $fetch<{ outcome: string, result?: Receipt, commandId?: string }, string>('/api/commands/quantity/import/resolve', { method: 'POST', retry: 0, body: descriptor })
    assertCurrent(epoch)
    if (result.outcome === 'applied' && result.result) {
      await finish(result.result, descriptor, epoch)
    }
    else if (result.outcome === 'not-applied' && result.commandId === descriptor.commandId) {
      codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
      await load(epoch, authority)
      success.value = '原编号已明确未应用，迟到请求不能重建。可以重新核对来源后提交。'
    }
    else {
      throw new Error('原结果尚无法可靠核对，请保留定位。')
    }
  })
}
async function restore(item: Catalog['imports'][number]) {
  if (!catalog.value || pending.value.length || busy.value)
    return
  if (!await confirm({ title: '恢复本批工程量采用', message: '系统先核对整批依赖。后来工程量、工资、WBS及其历史引用会阻止恢复。允许恢复时隐藏本批量域根并保留全部原件、审计与回执。', variant: 'simple' }))
    return
  await run(async (epoch) => {
    const authority = catalog.value!.context
    const commandId = generateId('quantity-restore')
    const descriptor = { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId, family: 'quantity-import', action: 'restore', targetId: item.id, scopeId: item.source_sha256 }
    remember(descriptor)
    const receipt = await $fetch<Receipt, string>('/api/commands/quantity/import/restore', { method: 'POST', retry: 0, body: { workspaceId: authority.workspaceId, actorId: authority.actorId, commandId, importId: item.id } })
    await finish(receipt, descriptor, epoch)
  })
}
onMounted(() => {
  void run(async (epoch) => {
    await load(epoch)
  })
})
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <SectionHeader title="工程量原库接管" subtitle="明确选择项目和责任身份，核对完整原库后采用本领域资料。" />
    <NuxtLink to="/subcontract/quantity" class="justify-self-start text-12px text-brand">
      返回工程量矩阵
    </NuxtLink>
    <p v-if="error" role="alert" class="panel break-words p-4 text-13px text-danger">
      {{ error }}
    </p>
    <CommandRecoveryPanel v-for="descriptor in pending" :key="descriptor.commandId" :command-id="descriptor.commandId" :saved="known?.commandId === descriptor.commandId" :busy="busy" @recover="recover(descriptor)" />
    <KitButton v-if="!catalog" class="justify-self-start" :disabled="busy" @click="run(async epoch => { await load(epoch) })">
      重新读取接管权限
    </KitButton>
    <section v-if="catalog" class="panel grid min-w-0 gap-4 p-4">
      <p class="m-0 text-12px text-ink-soft">
        原 SQLite 文件保持在你保存的位置。系统保全本域未知扩展、历史冻结及真实零；历史合同清单引用只供原链保全，新合同及清单采用仍未开放。
      </p>
      <label class="grid min-w-0 gap-2 text-12px">工程量 SQLite 原库<input type="file" accept=".sqlite,.sqlite3,.db" :disabled="busy || !!pending.length" @change="choose"></label>
      <p v-if="sourceName" class="m-0 break-words text-12px">
        {{ sourceName }}
      </p>
      <template v-if="inspection">
        <p v-if="!inspection.projects.length" class="m-0 text-12px text-ink-soft">
          原库没有可采用的工程量图，不会生成空模板或施工记录。
        </p>
        <label v-for="project in inspection.projects" :key="project.id" class="grid min-w-0 gap-2 text-12px">原项目：{{ project.name }}（{{ project.id }}）<select v-model="projectSelections[project.id]" class="field-input min-w-0 w-full" :disabled="busy || !!pending.length"><option value="">明确选择正式项目</option><option v-for="target in catalog.projects" :key="target.serverId" :value="target.serverId">{{ target.label }}（{{ target.serverId }}）</option></select></label>
        <label v-for="person in inspection.people" :key="`${person.kind}:${person.id}`" class="grid min-w-0 gap-2 text-12px">原{{ person.kind === 'crew' ? '班组' : '工人' }}：{{ person.id }}<select v-model="peopleSelections[`${person.kind}:${person.id}`]" class="field-input min-w-0 w-full" :disabled="busy || !!pending.length"><option value="">明确选择正式身份</option><option v-for="target in catalog.people.filter(row => row.kind === person.kind)" :key="target.id" :value="target.id">{{ target.name }}（{{ target.id }}）{{ target.deleted ? ' · 已删除，只保历史关联' : '' }}</option></select></label>
        <KitButton class="justify-self-start" :disabled="!canAdopt" @click="adopt">
          核对并采用完整工程量
        </KitButton>
      </template>
    </section>
    <p v-if="success" role="status" class="panel p-4 text-12px text-ok">
      {{ success }}
    </p>
    <section v-if="catalog?.imports.length" class="panel grid min-w-0 gap-3 p-4" aria-label="工程量采用历史">
      <h2 class="m-0 text-14px font-800">
        采用历史
      </h2>
      <div v-for="item in catalog.imports" :key="item.id" class="grid min-w-0 gap-2 border-t border-line pt-3">
        <p class="m-0 break-words text-12px">
          {{ item.created_at }} · {{ item.restored ? '已恢复采用，原件仍保留' : '已采用' }}
        </p>
        <KitButton v-if="!item.restored" variant="secondary" class="justify-self-start" :disabled="busy || !!pending.length" @click="restore(item)">
          核对并恢复本批采用
        </KitButton>
      </div>
    </section>
  </div>
</template>
