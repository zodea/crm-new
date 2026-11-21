<script setup lang="ts">
import type { AuxiliaryContractDTO, AuxiliaryContractKind, AuxiliaryImportCommand, AuxiliaryImportPreview, AuxiliaryImportResult } from '~/lib/auxiliary-contract/contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { useMutationObserver } from '@vueuse/core'
import KitEnumFilterOptions from '~/components/ui/KitEnumFilterOptions.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { AUXILIARY_CATEGORIES, AUXILIARY_LABELS, auxiliaryListPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryColumns, auxiliaryMoney, auxiliaryTableRow } from '~/lib/auxiliary-contract/presentation'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { enumFilterValues } from '~/lib/kit/enum-filter'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { bindReadAuthority } from '~/lib/read-model/authority'

const props = defineProps<{ kind: AuxiliaryContractKind }>()
const listRoot = useTemplateRef<HTMLElement>('listRoot')
let pendingRestore = false
const route = useRoute()
const router = useRouter()
const repository = useNuxtApp().$repositories.auxiliaryContracts
const recovery = createCommandRecoveryStorage(() => sessionStorage)
const kit = useKitUI()
const migration = shallowRef<Awaited<ReturnType<typeof repository.importState>> | null>(null)
const nativeCommand = ref<AuxiliaryImportCommand | null>(null)
const preview = shallowRef<AuxiliaryImportPreview | null>(null)
const migrationBusy = ref(false)
const migrationError = ref('')
const migrationPending = shallowRef<CommandRecoveryDescriptor | null>(null)
const migrationResult = shallowRef<AuxiliaryImportResult | null>(null)
let migrationGeneration = 0
const migrationKey = () => migration.value ? commandRecoveryKey({ ...migration.value.context, family: 'auxiliary-contract-import', targetId: null }) : ''
bindReadAuthority((failure) => {
  migrationGeneration++
  migration.value = null
  preview.value = null
  migrationError.value = failure.message
})
async function loadMigration() {
  const token = ++migrationGeneration
  migrationBusy.value = true
  migrationError.value = ''
  try {
    const state = await repository.importState()
    if (token !== migrationGeneration)
      return
    migration.value = state
    migrationPending.value = recovery.read(migrationKey())
  }
  catch (cause) {
    if (token === migrationGeneration)
      migrationError.value = cause instanceof Error ? cause.message : '来源核对失败'
  }
  finally {
    if (token === migrationGeneration)
      migrationBusy.value = false
  }
}
async function selectNative(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !migration.value || migrationPending.value)
    return
  const token = ++migrationGeneration
  migrationBusy.value = true
  migrationError.value = ''
  try {
    const original = await fileRefDraftFromFile(file)
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const command: AuxiliaryImportCommand = { commandId: crypto.randomUUID(), workspaceId: migration.value.context.workspaceId, actorId: migration.value.context.actorId, source: { sha256, payloadBase64: original.payloadBase64! }, projects: [], suppliers: [], signatories: [], originals: [] }
    const read = await repository.preflight(command)
    if (token !== migrationGeneration)
      return
    nativeCommand.value = command
    preview.value = read
  }
  catch (cause) {
    if (token === migrationGeneration)
      migrationError.value = cause instanceof Error ? cause.message : '完整来源核验失败'
  }
  finally {
    if (token === migrationGeneration)
      migrationBusy.value = false
  }
}
function bindReference(reference: AuxiliaryImportPreview['references'][number], selected: string) {
  if (!nativeCommand.value || !preview.value || migrationPending.value)
    return
  const candidate = reference.candidates.find(row => `${row.id}@${row.version}` === selected)
  const field = reference.kind === 'project' ? 'projects' : reference.kind === 'supplier' ? 'suppliers' : 'signatories'
  nativeCommand.value[field] = [...nativeCommand.value[field].filter(row => row.legacyId !== reference.id), ...(candidate ? [{ legacyId: reference.id, id: candidate.id, version: candidate.version }] : [])]
}
async function selectOriginal(id: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !nativeCommand.value || migrationPending.value)
    return
  migrationBusy.value = true
  try {
    const original = await fileRefDraftFromFile(file)
    nativeCommand.value.originals = [...nativeCommand.value.originals.filter(row => row.fileId !== id), { fileId: id, payloadBase64: original.payloadBase64! }]
  }
  catch (cause) { migrationError.value = cause instanceof Error ? cause.message : '原件读取失败' }
  finally { migrationBusy.value = false }
}
const canAdopt = computed(() => !!preview.value && !!nativeCommand.value && preview.value.references.every(reference => nativeCommand.value![reference.kind === 'project' ? 'projects' : reference.kind === 'supplier' ? 'suppliers' : 'signatories'].some(row => row.legacyId === reference.id)) && preview.value.requiredOriginals.every(file => nativeCommand.value!.originals.some(row => row.fileId === file.id)))
async function confirmMigration(result: AuxiliaryImportResult) {
  const pending = migrationPending.value
  const old = migration.value?.context
  if (!pending || !old)
    throw new Error('原提交范围尚未恢复，保留编号')
  const state = await repository.importState()
  if (old.workspaceId !== state.context.workspaceId || old.actorId !== state.context.actorId || !state.context.capabilities.includes('auxiliary-contract:import'))
    throw new Error('辅助合同采用读取时身份或权限变化，保留原编号')
  const source = state.sources.find(row => row.importId === result.importId && row.sourceSha256 === result.sourceSha256)
  if (!source || (pending.action === 'restore' ? !source.restored : source.restored) || JSON.stringify(source.ids) !== JSON.stringify(result.ids) || result.commandId !== pending.commandId)
    throw new Error('辅助合同原采用回执尚未可靠读取；只重试读取')
  recovery.clear(migrationKey(), pending.commandId)
  migration.value = state
  migrationPending.value = null
  migrationResult.value = null
  preview.value = null
  nativeCommand.value = null
  kit.success(pending.action === 'restore' ? '整批采用已退役，原图与原件历史保留' : '完整辅助合同原图已采用')
  await refresh()
}
async function adoptNative() {
  if (!canAdopt.value || !nativeCommand.value || migrationPending.value || migrationBusy.value)
    return
  if (!await kit.confirm({ variant: 'simple', title: '采用完整辅助合同', message: '两类合同、原增补及原件将同次进入正式owner。原完整SQLite文件需留在导出位置。', confirmLabel: '采用完整原图' }))
    return
  const command = JSON.parse(JSON.stringify(nativeCommand.value)) as AuxiliaryImportCommand
  const descriptor: CommandRecoveryDescriptor = { commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, family: 'auxiliary-contract-import', targetId: null, action: 'adopt', scopeId: command.source.sha256 }
  migrationBusy.value = true
  try {
    recovery.remember(migrationKey(), descriptor)
    migrationPending.value = descriptor
    migrationResult.value = await repository.adopt(command)
    await confirmMigration(migrationResult.value)
  }
  catch (cause) { migrationError.value = cause instanceof Error ? cause.message : '采用结果未知，保留原编号' }
  finally { migrationBusy.value = false }
}
async function restoreNative(importId: string) {
  if (!migration.value || migrationPending.value || migrationBusy.value || !await kit.confirm({ variant: 'simple', title: '受保护整批恢复', message: '仅未被后来修改、原意图或下游消费的完整批次可退役；任何危险引用会拒绝整批。', confirmLabel: '核验并退役采用' }))
    return
  const descriptor: CommandRecoveryDescriptor = { commandId: crypto.randomUUID(), workspaceId: migration.value.context.workspaceId, actorId: migration.value.context.actorId, family: 'auxiliary-contract-import', targetId: null, action: 'restore', scopeId: importId }
  migrationBusy.value = true
  try {
    recovery.remember(migrationKey(), descriptor)
    migrationPending.value = descriptor
    migrationResult.value = await repository.restoreImport({ commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, importId })
    await confirmMigration(migrationResult.value)
  }
  catch (cause) { migrationError.value = cause instanceof Error ? cause.message : '整批恢复结果未知，保留原编号' }
  finally { migrationBusy.value = false }
}
async function recoverMigration() {
  const pending = migrationPending.value
  if (!pending || migrationBusy.value || !pending.scopeId || !['adopt', 'restore'].includes(pending.action))
    return
  migrationBusy.value = true
  migrationError.value = ''
  try {
    if (migrationResult.value) {
      await confirmMigration(migrationResult.value)
      return
    }
    const resolution = await repository.resolve({ commandId: pending.commandId, workspaceId: pending.workspaceId, actorId: pending.actorId, action: pending.action === 'adopt' ? 'adopt' : 'restore', scopeId: pending.scopeId })
    if (resolution.outcome === 'applied') {
      if (!('importId' in resolution.result))
        throw new Error('原采用回执与辅助合同范围不同')
      migrationResult.value = resolution.result
      await confirmMigration(resolution.result)
    }
    else {
      recovery.clear(migrationKey(), pending.commandId)
      migrationPending.value = null
      if (nativeCommand.value)
        nativeCommand.value.commandId = crypto.randomUUID()
      kit.success('原编号已封存为未应用，来源文件和选择保留')
    }
  }
  catch (cause) { migrationError.value = cause instanceof Error ? cause.message : '原号仍未核实，保留编号' }
  finally { migrationBusy.value = false }
}
const { data: page, shellState, problem, load } = useAuxiliaryContractRead(
  () => repository.list({ ...route.query, kind: props.kind }),
  data => data.empty ? { kind: 'empty', data, empty: data.empty } : { kind: 'ready', data },
  { snapshotKey: () => JSON.stringify([props.kind, route.path, route.query.origin ?? 'real']) },
)
const search = shallowRef(String(route.query.search ?? ''))
const category = computed({ get: () => enumFilterValues(route.query.category), set: (value: string[]) => void filter({ category: value.length ? value : undefined }) })
const status = computed({ get: () => enumFilterValues(route.query.status), set: (value: string[]) => void filter({ status: value.length ? value : undefined }) })
const project = computed({ get: () => String(route.query.projectId ?? route.query.project ?? ''), set: value => void filter({ projectId: value || undefined, project: undefined }) })
const fetchProjects = async (keyword: string) => (page.value?.projectOptions ?? []).filter(row => row.label.includes(keyword))
const categories = computed(() => AUXILIARY_CATEGORIES[props.kind].map(value => ({ key: value, label: value })))
const statuses = ['草稿', '审批中', '已签订', '履约中', '已结算', '已结清'].map(value => ({ key: value, label: value }))
const columns = computed(() => auxiliaryColumns(props.kind))
const rows = computed(() => page.value?.items.map(auxiliaryTableRow) ?? [])
const canWrite = computed(() => shellState.value === 'ready' && (page.value?.capabilities.includes('auxiliary-contract:write') ?? false))
const hasFilters = computed(() => ['search', 'projectId', 'supplierId', 'project', 'supplier'].some(key => route.query[key]) || category.value.length > 0 || status.value.length > 0)
const empty = computed(() => ({ title: hasFilters.value ? '没有符合条件的合同' : `暂无${AUXILIARY_LABELS[props.kind]}`, description: hasFilters.value ? '请调整或清除筛选。' : '当前范围内还没有合同。', actionLabel: hasFilters.value ? '清除筛选' : '' }))
async function filter(patch: Record<string, string | string[] | undefined>) {
  await navigateTo({ path: route.path, query: { ...route.query, ...patch, page: undefined } }, { replace: true })
}
function clearFilters() {
  void navigateTo({ path: route.path, query: { returnTo: route.query.returnTo } }, { replace: true })
  search.value = ''
}
function returnTo(id: string) {
  return `${route.fullPath.split('#')[0]}#aux-row-${id}`
}
function target(row: AuxiliaryContractDTO) {
  const result = resolveNavigationTarget(row.navigation, { returnTo: returnTo(row.id) })
  return result.state === 'resolved' ? result.to : undefined
}
function remember(id: string) {
  const container = document.querySelector<HTMLElement>('[data-shell-workspace]') ?? document.scrollingElement
  sessionStorage.setItem(`auxiliary-scroll:${returnTo(id)}`, String(container?.scrollTop ?? 0))
}
async function restore() {
  await nextTick()
  if (!pendingRestore || route.path !== auxiliaryListPath(props.kind) || shellState.value !== 'ready')
    return
  const id = route.hash.slice(1)
  if (!id.startsWith('aux-row-'))
    return
  const element = document.getElementById(id)
  if (!element || !listRoot.value?.contains(element))
    return
  const saved = sessionStorage.getItem(`auxiliary-scroll:${route.fullPath}`)
  const container = document.querySelector<HTMLElement>('[data-shell-workspace]') ?? document.scrollingElement
  if (saved !== null && container)
    container.scrollTop = Number(saved) || 0
  else element.scrollIntoView({ block: 'nearest' })
  element.focus({ preventScroll: true })
  pendingRestore = false
}
// Vxe renders rows after its own asynchronous layout; restore when the actual anchor exists.
useMutationObserver(listRoot, () => void restore(), { childList: true, subtree: true })
let refreshGeneration = 0
async function refresh() {
  if (route.path !== auxiliaryListPath(props.kind))
    return
  const generation = ++refreshGeneration
  const scope = route.fullPath
  pendingRestore = true
  await load()
  if (generation !== refreshGeneration || route.fullPath !== scope || shellState.value !== 'ready')
    return
  const pagination = page.value?.pagination
  if (pagination && pagination.page !== pagination.requestedPage) {
    await router.replace({ query: { ...route.query, page: pagination.page === 1 ? undefined : String(pagination.page) } })
    return
  }
  await restore()
}
watch(() => route.fullPath, () => {
  search.value = String(route.query.search ?? '')
  void refresh()
}, { immediate: true })
onActivated(() => void refresh())
useTabTitle(() => AUXILIARY_LABELS[props.kind])
</script>

<template>
  <div ref="listRoot" class="flex min-w-0 flex-col gap-3" data-testid="auxiliary-list">
    <TargetCostSourceReturn />
    <header class="panel flex min-w-0 flex-wrap items-center gap-2 p-3">
      <h1 class="m-0 mr-auto text-15px font-800">
        {{ AUXILIARY_LABELS[kind] }}
      </h1>
      <KitMultiSelectFilter v-model="category" :options="categories" label="类别" class="lg:hidden" />
      <KitMultiSelectFilter v-model="status" :options="statuses" label="状态" />
      <LookupSelect v-if="kind === 'other_expense'" v-model="project" :fetch="fetchProjects" placeholder="筛选项目" class="w-48 max-w-full" />
      <form class="flex min-w-0 flex-wrap gap-2" @submit.prevent="filter({ search: search || undefined })">
        <input v-model="search" class="field-input min-w-0 max-w-full" placeholder="搜索合同名称 / 编号 / 对方单位" aria-label="搜索合同名称 / 编号 / 对方单位">
        <KitButton type="submit">
          搜索
        </KitButton>
      </form>
      <KitButton aria-label="刷新合同列表" @click="refresh">
        刷新
      </KitButton>
      <KitButton v-if="canWrite" variant="primary" @click="navigateTo(`${auxiliaryListPath(kind)}/form?returnTo=${encodeURIComponent(route.fullPath)}`)">
        新建合同
      </KitButton>
    </header>
    <div v-if="hasFilters" class="flex flex-wrap items-center gap-2 text-12px">
      <span>当前筛选：{{ route.query.projectId || route.query.project ? '限定项目 · ' : '' }}{{ route.query.supplierId || route.query.supplier ? '限定分供方 · ' : '' }}{{ route.query.search || route.query.category || route.query.status || '来源范围' }}</span>
      <KitButton @click="clearFilters">
        清除筛选
      </KitButton>
    </div>
    <details v-if="page?.capabilities.includes('auxiliary-contract:import')" class="panel min-w-0 p-3" @toggle="($event.target as HTMLDetailsElement).open && loadMigration()">
      <summary class="cursor-pointer text-13px font-700">
        完整 Native 辅助合同迁入与受保护恢复
      </summary>
      <div class="mt-3 flex min-w-0 flex-col gap-3">
        <p class="m-0 text-12px text-ink-soft">
          同次核验其他支出、公司支出合同与全部原增补、原件及审计。完整原库留在导出位置，正式库只保存本领域原图。
        </p>
        <p v-if="migrationError" role="alert" class="m-0 break-words text-13px text-danger">
          {{ migrationError }}
        </p>
        <div v-if="migrationPending" role="status" class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="min-w-0 break-all text-12px">原编号：{{ migrationPending.commandId }}；{{ migrationResult ? '已应用待读取，仅重试读取' : '结果未知，请核对原编号' }}</span>
          <KitButton :disabled="migrationBusy" @click="recoverMigration">
            核对原采用结果
          </KitButton>
        </div>
        <fieldset :disabled="!migration || migrationBusy || Boolean(migrationPending)" class="m-0 grid min-w-0 gap-3 border-0 p-0">
          <label class="field-block"><span class="field-label">完整 SQLite 来源文件</span><input type="file" accept=".sqlite,.db,.sqlite3" aria-label="完整辅助合同来源文件" @change="selectNative"></label>
          <template v-if="preview">
            <p class="m-0 break-all text-12px">
              来源 SHA-256：{{ preview.sourceSha256 }} · 两类合同 {{ preview.contracts.length }} 份
            </p>
            <div v-for="reference in preview.references" :key="`${reference.kind}:${reference.id}`" class="field-block">
              <span class="field-label">原{{ reference.kind === 'project' ? '工程' : reference.kind === 'supplier' ? '分供方' : '我方主体版本' }}：{{ reference.label }}（{{ reference.id }}）</span>
              <select class="field-input w-full" :aria-label="`采用${reference.id}`" @change="bindReference(reference, ($event.target as HTMLSelectElement).value)">
                <option value="">
                  明确选择真实主档及版本
                </option>
                <option v-for="candidate in reference.candidates" :key="`${candidate.id}@${candidate.version}`" :value="`${candidate.id}@${candidate.version}`">
                  {{ candidate.label }} · {{ candidate.id }} · 版本 {{ candidate.version }}{{ candidate.deletedAt ? ' · 已归档，仅保历史关联' : '' }}
                </option>
              </select>
            </div>
            <label v-for="file in preview.requiredOriginals" :key="file.id" class="field-block"><span class="field-label">补齐原目录文件：{{ file.name }}（{{ file.id }}）</span><input type="file" :aria-label="`补齐${file.id}`" @change="selectOriginal(file.id, $event)"></label>
            <KitButton :disabled="!canAdopt" variant="primary" @click="adoptNative">
              采用完整辅助合同原图
            </KitButton>
          </template>
          <div v-for="source in migration?.sources ?? []" :key="source.importId" class="flex min-w-0 flex-wrap items-center gap-2 border-t border-line pt-2 text-12px">
            <span class="min-w-0 break-all">{{ source.importId }} · {{ source.ids.length }} 份原合同 · {{ source.restored ? '已退役采用，原历史保留' : '已采用' }}</span>
            <KitButton v-if="!source.restored" @click="restoreNative(source.importId)">
              受保护整批恢复
            </KitButton>
          </div>
        </fieldset>
      </div>
    </details>
    <NuxtLink v-if="validateAuxiliaryReturnTo(route.query.returnTo)" :to="validateAuxiliaryReturnTo(route.query.returnTo)!" class="text-13px text-brand">
      返回来源
    </NuxtLink>
    <p v-if="problem && page" role="alert" class="m-0 rounded-sm bg-danger-soft p-3 text-12px text-danger">
      {{ problem.message }}；当前保留上一次成功读取的列表。
      <button v-if="problem.retryable" type="button" class="ml-2 underline" @click="refresh">
        重试
      </button>
    </p>
    <StatePanel v-if="problem && !page" :kind="shellState === 'forbidden' ? 'forbidden' : 'error'" :title="problem.message" :action-label="problem.retryable ? '重新加载' : ''" @action="refresh" />
    <div v-else class="grid min-w-0 gap-3 lg:grid-cols-[150px_minmax(0,1fr)]" :aria-busy="shellState === 'loading'">
      <aside class="panel hidden min-w-0 p-2 lg:block" aria-label="合同类别">
        <p class="m-0 border-b border-line px-2 py-3 text-12px font-700">
          合同分类
        </p>
        <KitEnumFilterOptions v-model="category" label="合同类别" :options="categories" class="mt-2" />
      </aside>
      <div class="relative min-w-0">
        <span v-if="shellState === 'loading' && page" role="status" class="pointer-events-none absolute right-3 top-1 z-1 rounded-sm bg-panel px-2 py-1 text-12px text-ink-soft">正在更新列表…</span>
        <KitTable :columns="columns" :data="rows" :loading="shellState === 'loading' && !page" :page="page?.pagination ?? { page: 1, pageSize: 20, total: 0 }" :empty="empty" @empty-action="clearFilters" @page-change="navigateTo({ path: route.path, query: { ...route.query, page: $event.page, pageSize: $event.pageSize } }, { replace: true })">
          <template #name="{ row }">
            <NuxtLink :id="`aux-row-${row.id}`" :to="target(row.source)" class="cell--link" @click="remember(row.id)">
              {{ row.name }}
            </NuxtLink>
          </template>
          <template #action="{ row }">
            <RowActionMenu :items="[{ key: 'view', label: '查看详情', icon: 'i-lucide-eye' }]" :label="`${row.name}操作`" @select="navigateTo(target(row.source)!)" />
          </template>
        </KitTable>
        <div class="flex flex-wrap justify-end gap-4 border border-line bg-surface-2 px-3 py-2 text-12px">
          <span>当前筛选 · 正式合同 {{ page?.summary.real.count ?? 0 }} 份</span><span>合同金额合计 <strong class="font-mono">{{ auxiliaryMoney(page?.summary.real.amount ?? null) }}</strong></span>
        </div>
      </div>
    </div>
  </div>
</template>
