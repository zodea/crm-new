<script setup lang="ts">
import type { TargetCostFormRead, TargetCostListRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import type { TargetCostListRow } from '~/lib/target-cost/list'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { clampPage, paginate } from '~/lib/kit/table'
import { filterTargetCostList } from '~/lib/target-cost/list'
import { TARGET_COST_LIST_PATH, targetCostListPath, targetCostListQuery, targetCostLocation, targetCostOrigin } from '~/lib/target-cost/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const route = useRoute()
const router = useRouter()
const store = useTargetCostListStore()
const commandStore = useTargetCostStore()
const { confirm, success } = useKitUI()
const initial = targetCostListQuery(route.query)
const search = shallowRef(typeof initial.search === 'string' ? initial.search : '')
const project = shallowRef(typeof initial.project === 'string' ? initial.project : 'all')
const baseline = shallowRef(Array.isArray(initial.baseline) ? initial.baseline : [])
const status = shallowRef(Array.isArray(initial.status) ? initial.status : [])
const page = shallowRef(Number(initial.page) || 1)
const pageSize = shallowRef(Number(initial.pageSize) || 10)
const sort = shallowRef(typeof initial.sort === 'string' ? initial.sort : 'updated-desc')
const deleted = shallowRef(initial.deleted === 'true')
const origin = computed(() => targetCostOrigin(route.query.origin))
const read = shallowRef<TargetCostListRead | null>(null)
const operationRead = shallowRef<TargetCostFormRead | null>(null)
const loading = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
const active = shallowRef(true)
let sequence = 0
let commandSequence = 0
let started = false
let applyingRoute = false
const pending = computed(() => operationRead.value ? commandStore.getPending(operationRead.value) : null)
const pendingOperations = computed(() => read.value?.context.origin === origin.value ? commandStore.getPendingForList(read.value) : [])
const rows = computed(() => read.value?.context.origin === origin.value ? read.value.rows : [])
const canWrite = computed(() => origin.value === 'real' && read.value?.context.capabilities.includes('target-cost:write') && !saving.value && !pending.value)
const query = computed(() => ({ origin: origin.value, search: search.value, project: project.value, baseline: baseline.value, status: status.value, page: String(page.value), pageSize: String(pageSize.value), sort: sort.value, deleted: deleted.value ? 'true' : 'false' }))
const returnTo = computed(() => targetCostListPath(query.value))
const filtered = computed(() => filterTargetCostList(rows.value.filter(row => !!row.deletedAt === deleted.value), { search: search.value, project: project.value, baseline: baseline.value, status: status.value }).sort((a, b) => sort.value === 'name-asc' ? a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id) : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)))
const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))
const projectOptions = computed(() => [{ key: 'all', label: '全部项目' }, { key: 'unassigned', label: '未关联项目' }, ...[...new Map(rows.value.flatMap(row => row.projectId ? [[row.projectId, { key: row.projectId, label: row.projectName || row.projectId }] as const] : [])).values()]])
const statusOptions = [{ key: 'draft', label: '草稿' }, { key: 'submitted', label: '已提交' }]
const hasFilters = computed(() => !!search.value.trim() || project.value !== 'all' || baseline.value.length > 0 || status.value.length > 0)
const totals = computed(() => (['taxInclusiveTotal', 'signedContractSum', 'plannedProfit'] as const).map((key) => {
  const values = filtered.value.map(row => row[key]).filter((value): value is number => value != null)
  return { key, known: values.length || !filtered.value.length ? values.reduce((sum, value) => sum + value, 0) : null, missing: filtered.value.length - values.length }
}))
const totalLabels = { taxInclusiveTotal: '含税合价', signedContractSum: '已签合同额（录入）', plannedProfit: '计划利润' }
async function load() {
  const request = ++sequence
  const requested = origin.value
  started = true
  loading.value = true
  error.value = ''
  if (!requested) {
    read.value = null
    loading.value = false
    error.value = '资料来源无效，请选择正式或演示来源'
    return
  }
  try {
    const value = await store.load(requested)
    if (active.value && request === sequence && requested === origin.value)
      read.value = value
  }
  catch (cause) {
    if (active.value && request === sequence && requested === origin.value)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active.value && request === sequence)
      loading.value = false
  }
}
async function handleAction(action: string, row: TargetCostListRow) {
  if (!origin.value)
    return
  if (action === 'detail' || action === 'edit') {
    await router.push(targetCostLocation(row.id, origin.value, returnTo.value, action === 'edit'))
    return
  }
  if (!canWrite.value || !['delete', 'restore'].includes(action))
    return
  const requested = origin.value
  const request = sequence
  const attempt = ++commandSequence
  saving.value = true
  error.value = ''
  try {
    const value = await commandStore.loadForm(row.id, requested)
    if (!active.value || request !== sequence || origin.value !== requested)
      return
    operationRead.value = value
    if (commandStore.getPending(value))
      return
    const accepted = await confirm({ variant: 'simple', title: action === 'delete' ? '删除目标成本' : '恢复目标成本', message: `确认${action === 'delete' ? '删除' : '恢复'}「${value.draft.name || '未填写版本名'}」？${action === 'delete' ? '当前基线删除后不会自动选择历史版本。' : '若与后续基线或当前来源冲突，恢复将被拒绝。'}`, confirmLabel: action === 'delete' ? '删除' : '恢复' })
    if (!accepted || !active.value || request !== sequence || origin.value !== requested)
      return
    const result = action === 'delete' ? await commandStore.remove(value) : await commandStore.restore(value)
    if (!active.value || request !== sequence || requested !== origin.value || result.id !== value.targetCostId)
      return
    success(action === 'delete' ? '预算版本已删除' : '预算版本已恢复')
    await load()
  }
  catch (cause) {
    if (active.value && request === sequence && requested === origin.value)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active.value && requested === origin.value && attempt === commandSequence)
      saving.value = false
  }
}
async function recover(original?: TargetCostPending) {
  const operation = original ?? pending.value
  if (!operation || saving.value)
    return
  const requested = origin.value
  const attempt = ++commandSequence
  saving.value = true
  try {
    await commandStore.recover(operation)
    if (active.value && requested === origin.value && attempt === commandSequence)
      await load()
  }
  catch (cause) {
    if (active.value && requested === origin.value && attempt === commandSequence)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active.value && requested === origin.value && attempt === commandSequence)
      saving.value = false
  }
}
function create() {
  if (canWrite.value)
    void router.push({ path: `${TARGET_COST_LIST_PATH}/form`, query: { origin: 'real', returnTo: returnTo.value } })
}
function restoreFilters() {
  if (!active.value || route.path !== TARGET_COST_LIST_PATH)
    return
  const value = targetCostListQuery(route.query)
  applyingRoute = true
  search.value = typeof value.search === 'string' ? value.search : ''
  project.value = typeof value.project === 'string' ? value.project : 'all'
  baseline.value = Array.isArray(value.baseline) ? value.baseline : []
  status.value = Array.isArray(value.status) ? value.status : []
  sort.value = typeof value.sort === 'string' ? value.sort : 'updated-desc'
  deleted.value = value.deleted === 'true'
  page.value = Number(value.page) || 1
  pageSize.value = Number(value.pageSize) || 10
  applyingRoute = false
}
watch([search, project, baseline, status, deleted, sort], () => {
  if (!applyingRoute)
    page.value = 1
}, { flush: 'sync' })
watch(() => route.query, restoreFilters)
watch(query, () => {
  if (active.value && route.path === TARGET_COST_LIST_PATH && origin.value && targetCostListPath(route.query) !== returnTo.value)
    void router.replace({ path: TARGET_COST_LIST_PATH, query: targetCostListQuery(query.value) })
})
watch(origin, () => {
  if (active.value) {
    operationRead.value = null
    commandSequence += 1
    saving.value = false
    void load()
  }
}, { immediate: true })
watch(() => commandStore.revision, () => {
  if (active.value)
    void load()
})
onDeactivated(() => {
  active.value = false
  loading.value = false
  saving.value = false
  sequence += 1
  commandSequence += 1
})
onActivated(() => {
  if (active.value && started)
    return
  active.value = true
  restoreFilters()
  void load()
})
onScopeDispose(() => {
  active.value = false
  sequence += 1
})
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <TargetCostListFilters v-model:search="search" v-model:project="project" v-model:baseline="baseline" v-model:status="status" :loading="loading" :project-options="projectOptions" :status-options="statusOptions" :can-create="!!canWrite" @refresh="load" @create="create" />
    <div class="panel flex min-w-0 flex-wrap items-center gap-4 p-3 text-12px">
      <label>资料来源<select class="field-input ml-2" :value="origin || ''" aria-label="预算资料来源" @change="router.replace({ path: TARGET_COST_LIST_PATH, query: { origin: ($event.target as HTMLSelectElement).value } })"><option value="real">正式预算</option><option value="demo">演示预算（只读）</option></select></label>
      <label>排序<select v-model="sort" class="field-input ml-2" aria-label="预算排序"><option value="updated-desc">最近更新</option><option value="name-asc">版本名</option></select></label>
      <label class="flex items-center gap-2"><input v-model="deleted" type="checkbox" class="accent-brand">查看已删除版本</label>
    </div>
    <TargetCostCommandState :error="error" :pending="!!pending" :busy="loading || saving" :applied="pending?.state === 'applied'" @recover="recover()" @recheck="load" />
    <section v-for="operation in pendingOperations.filter(item => item.descriptor.commandId !== pending?.descriptor.commandId)" :key="operation.descriptor.commandId" class="panel p-3 text-12px" aria-label="预算未决操作">
      <p>「{{ rows.find(row => row.id === operation.descriptor.targetId)?.name || '未填写版本名' }}」仍有一次提交结果待核对。</p>
      <KitButton class="mt-2" :disabled="loading || saving" @click="recover(operation)">
        核对并恢复原提交
      </KitButton>
    </section>
    <TargetCostListTable v-if="!error" :rows="pageRows" :loading="loading && !read" :page="currentPage" :page-size="pageSize" :total="filtered.length" :filtered="hasFilters" :origin="origin || 'real'" :return-to="returnTo" :can-write="!!canWrite" :can-read-project="!!read?.context.capabilities.includes('project:list:read')" @page-change="value => { page = value.page; pageSize = value.pageSize }" @action="handleAction" />
    <footer v-if="!error" role="status" aria-label="目标成本列表汇总" class="panel flex min-w-0 flex-wrap items-center justify-end gap-x-6 gap-y-2 px-4 py-3 text-12px">
      <span class="mr-auto text-ink-faint">当前筛选 {{ filtered.length }} 个版本</span>
      <span v-for="total in totals" :key="total.key">{{ totalLabels[total.key] }} <b class="ml-1 font-mono">{{ total.known == null ? `未知 · 缺 ${total.missing} 个版本` : total.missing ? `已知 ${yuan(total.known)} · 缺 ${total.missing} 个版本` : yuan(total.known) }}</b></span>
    </footer>
  </div>
</template>
