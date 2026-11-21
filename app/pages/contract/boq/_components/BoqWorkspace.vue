<script setup lang="ts">
import type {
  CreateBoqChangeOrderDraft,
  ReviseApprovedBoqChangeOrderDraft,
} from '~/lib/boq/change'
import type { MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqAttachmentView, BoqChangeOrderView, BoqLineView } from '~/lib/boq/read-model'
import type { ExportFileOptions } from '~/lib/kit/export'
import type { QuantityBasis } from '~/lib/quantity/basis'
import type { BoqAttachmentDraft } from '~/stores/boq'
import ProjectSwitcher from '~/components/project/ProjectSwitcher.vue'
import { createBoqWorkbookExport, createMonthlyStatementExport } from '~/lib/boq/export'
import { quantityBasisLabel } from '~/lib/quantity/basis'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'
import BoqCatalogTree from './BoqCatalogTree.vue'
import BoqChangeWorkspace from './BoqChangeWorkspace.vue'
import BoqLinesTable from './BoqLinesTable.vue'
import BoqMonthlyWorkspace from './BoqMonthlyWorkspace.vue'

type BoqTab = 'lines' | 'changes' | 'monthly'

const route = useRoute()
const router = useRouter()
const store = useBoqStore()
const access = useProductionAccessStore()
const downloads = new Set<AbortController>()
function cancelDownloads() {
  for (const download of downloads)
    download.abort()
  downloads.clear()
}
const {
  confirm,
  error: toastError,
  exportFile,
  formModal,
  success,
  undoToast,
} = useKitUI()

const projectId = shallowRef('')
const contractId = shallowRef('')
const activeTab = shallowRef<BoqTab>('lines')
const treeScope = shallowRef('all')
const search = shallowRef('')
const initialized = shallowRef(false)
watch(() => [projectId.value, contractId.value, access.status?.mode, access.status?.authenticated, access.status?.mode === 'production' ? access.status.ownerId : undefined], cancelDownloads)
onDeactivated(cancelDownloads)
onBeforeUnmount(cancelDownloads)
const requestedTargetUnavailable = shallowRef(false)
const focusId = computed(() => typeof route.query.focus === 'string' ? route.query.focus : null)

const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.id,
  code: project.code,
  name: project.name,
})))

const selectedProject = computed(() => store.catalog.find(project => project.id === projectId.value) ?? null)
const contractOptions = computed(() => (selectedProject.value?.contracts ?? []).map(contract => ({
  key: contract.id,
  label: contract.no ? `${contract.name} · ${contract.no}` : contract.name,
})))

const tabs = computed(() => [
  { key: 'lines', label: '合同清单', count: store.workspace?.summary.lineCount ?? 0 },
  { key: 'changes', label: '变更单', count: store.workspace?.changes.length ?? 0 },
  { key: 'monthly', label: '月度报量', count: store.workspace?.monthlySourceState === 'unavailable' ? null : store.workspace?.monthlyStatements.length ?? 0 },
])

function queryTab(value: unknown): BoqTab {
  return value === 'changes' || value === 'monthly' ? value : 'lines'
}

async function replaceQuery() {
  await router.replace({
    query: {
      ...route.query,
      project: projectId.value || undefined,
      contract: contractId.value || undefined,
      tab: activeTab.value === 'lines' ? undefined : activeTab.value,
    },
  })
}

async function initialize() {
  initialized.value = false
  try {
    const requestedProject = String(route.query.project ?? '')
    const requestedContract = String(route.query.contract ?? '')
    if (requestedProject && requestedContract
      && (store.workspace?.projectId !== requestedProject || store.workspace.contractId !== requestedContract)) {
      store.clearWorkspace()
    }
    await store.loadCatalog()
    activeTab.value = queryTab(route.query.tab)
    const exactProject = store.catalog.find(project => project.id === requestedProject)
    const exactContract = exactProject?.contracts.find(contract => contract.id === requestedContract)
    if (requestedProject && requestedContract && (!exactProject || !exactContract)) {
      store.clearWorkspace()
      projectId.value = requestedProject
      contractId.value = requestedContract
      requestedTargetUnavailable.value = true
      return
    }
    requestedTargetUnavailable.value = false
    const preferredProject = exactProject
      ?? store.catalog.find(project => project.contracts.some(contract => contract.lineCount > 0))
      ?? store.catalog[0]
    projectId.value = preferredProject?.id ?? ''
    const preferredContract = preferredProject?.contracts.find(contract => contract.id === requestedContract)
      ?? preferredProject?.contracts.find(contract => contract.lineCount > 0)
      ?? preferredProject?.contracts[0]
    contractId.value = preferredContract?.id ?? ''
    if (projectId.value && contractId.value)
      await store.loadWorkspace(projectId.value, contractId.value)
    await replaceQuery()
    if (activeTab.value === 'monthly' && store.workspace?.monthlyStatements[0]) {
      const statement = store.workspace.monthlyStatements.find(item => item.id === focusId.value)
        ?? store.workspace.monthlyStatements[0]
      await store.loadStatement(statement.id)
    }
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
  finally {
    await nextTick()
    initialized.value = true
  }
}

watch(projectId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  requestedTargetUnavailable.value = false
  const project = store.catalog.find(candidate => candidate.id === next)
  contractId.value = project?.contracts.find(contract => contract.lineCount > 0)?.id
    ?? project?.contracts[0]?.id
    ?? ''
  treeScope.value = 'all'
  if (contractId.value)
    await store.loadWorkspace(next, contractId.value)
  await replaceQuery()
})

watch(contractId, async (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  requestedTargetUnavailable.value = false
  treeScope.value = 'all'
  await store.loadWorkspace(projectId.value, next)
  await replaceQuery()
})

watch(activeTab, async (next) => {
  if (!initialized.value)
    return
  await replaceQuery()
  if (next === 'monthly' && !store.monthlyStatement && store.workspace?.monthlyStatements[0])
    await store.loadStatement(store.workspace.monthlyStatements[0].id)
})

watch(() => route.query.tab, (value) => {
  const next = queryTab(value)
  if (next !== activeTab.value)
    activeTab.value = next
})

watch(() => [route.query.project, route.query.contract], ([project, contract]) => {
  const requestedProject = String(project ?? '')
  const requestedContract = String(contract ?? '')
  if (requestedProject !== projectId.value || requestedContract !== contractId.value)
    void initialize()
})

async function editLine(line: BoqLineView) {
  const values = await formModal({
    title: `编辑「${line.itemName}」`,
    subtitle: '识别原值保持不变；改后的合同量/合同价会标记为人工修正。',
    cols: 2,
    width: 680,
    saveText: '保存修正',
    fields: [
      { key: 'section', label: '分部', value: line.section, required: true },
      { key: 'trade', label: '工种', value: line.trade, required: true },
      { key: 'itemName', label: '分项名称', value: line.itemName, required: true },
      { key: 'unit', label: '单位', value: line.unit },
      { key: 'qty', label: '合同工程量', type: 'number', value: line.baseQty, required: true },
      { key: 'unitPrice', label: '合同单价', type: 'number', value: line.baseUnitPrice, required: true },
      { key: 'unitType', label: '户型', value: line.unitType },
      { key: 'room', label: '房间 / 部位', value: line.room },
      { key: 'spec', label: '特征描述', type: 'textarea', value: line.spec, full: true },
    ],
  })
  if (!values)
    return
  try {
    await store.updateLine(line.id, {
      section: String(values.section),
      trade: String(values.trade),
      itemName: String(values.itemName),
      unit: String(values.unit),
      qty: Number(values.qty),
      unitPrice: Number(values.unitPrice),
      unitType: String(values.unitType),
      room: String(values.room),
      spec: String(values.spec),
    })
    success('清单行已保存')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function removeLine(line: BoqLineView) {
  const approved = await confirm({
    variant: 'simple',
    title: `删除「${line.itemName}」？`,
    message: '清单行会软删除；工程量模板与排程保留既有事实，但不再把该行作为可用合同来源。',
    confirmLabel: '删除清单行',
  })
  if (!approved)
    return
  try {
    const logId = await store.removeLine(line.id)
    if (logId)
      undoToast(`已删除「${line.itemName}」`, () => store.undo([logId]))
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function openFieldFormula(line: BoqLineView) {
  await router.push({
    path: '/subcontract/quantity',
    query: {
      project: projectId.value,
      boqLine: line.id,
    },
  })
}

async function openFloorPlan(line: BoqLineView) {
  await router.push({
    path: '/schedule',
    query: {
      project: projectId.value,
      boqLine: line.id,
    },
  })
}

async function createChange(draft: CreateBoqChangeOrderDraft) {
  try {
    await store.createChange(draft)
    success('变更单草稿已创建')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function transitionChange(payload: { orderId: string, target: 'submitted' | 'rejected', note: string }) {
  try {
    await store.transitionChange(payload.orderId, payload.target, payload.note)
    success(payload.target === 'submitted' ? '变更单已上报' : '变更单已退回')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function approveChange(payload: { orderId: string, approvedAt: string }) {
  const order = store.workspace?.changes.find(change => change.id === payload.orderId)
  if (!order)
    return
  const approved = await confirm({
    variant: 'simple',
    title: `确认签证「${order.code}」？`,
    message: '签证会立即改变合同量/合同价，并自动生成锁定的业主变洽签台账行。该状态不可直接退回。',
    confirmLabel: '确认签证',
  })
  if (!approved)
    return
  try {
    await store.approveChange(payload.orderId, payload.approvedAt)
    success('变更单已签证并写入业主台账')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function reviseApprovedChange(payload: { orderId: string, draft: ReviseApprovedBoqChangeOrderDraft }) {
  const order = store.workspace?.changes.find(change => change.id === payload.orderId)
  if (!order)
    return
  const approved = await confirm({
    variant: 'cascade',
    title: `更正已签证变更「${order.code}」？`,
    message: '该操作会同步重算签证金额、锁定业主台账与变更新增结果，并完整记录修改前后值。',
    impact: [
      { label: '已签证变更单', n: 1 },
      { label: '锁定业主台账', n: order.ledgerId ? 1 : 0 },
      { label: '变更明细 / 结果清单', n: order.lines.length },
    ],
    requireTyping: order.name,
    confirmLabel: '确认更正',
  })
  if (!approved)
    return
  try {
    await store.reviseApprovedChange(payload.orderId, payload.draft, true)
    success('已签证变更及关联台账已更正')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function removeChange(order: BoqChangeOrderView) {
  const approved = await confirm(order.status === 'approved'
    ? {
        variant: 'cascade',
        title: `删除已签证变更「${order.code}」？`,
        message: '该操作会同时软删除自动生成的业主台账行和变更新增 BOQ 行。',
        impact: [
          { label: '业主变洽签台账', n: order.ledgerId ? 1 : 0 },
          { label: '变更明细及新增清单行', n: 1 },
        ],
        requireTyping: order.name,
        confirmLabel: '级联删除',
      }
    : {
        variant: 'simple',
        title: `删除变更单「${order.code}」？`,
        message: '变更单及其明细会软删除，可通过撤回恢复。',
        confirmLabel: '删除变更单',
      })
  if (!approved)
    return
  try {
    const logIds = await store.removeChange(order.id, order.status === 'approved')
    if (logIds.length)
      undoToast(`已删除变更单「${order.code}」`, () => store.undo(logIds))
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function attachChange(payload: { orderId: string, draft: BoqAttachmentDraft }) {
  try {
    await store.addChangeAttachment(payload.orderId, payload.draft)
    success('变更附件已登记')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function downloadAttachment(attachment: BoqAttachmentView) {
  try {
    await downloadActual({ defaultName: attachment.fileName, mimeType: attachment.mimeType, data: async () => {
      const file = await store.loadAttachmentFile(attachment.id)
      return typeof file.data === 'function' ? file.data() : file.data
    } })
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function downloadActual(options: ExportFileOptions) {
  const download = new AbortController()
  downloads.add(download)
  try {
    return await exportFile({ ...options, signal: download.signal })
  }
  finally { downloads.delete(download) }
}

async function removeAttachment(attachment: BoqAttachmentView) {
  const approved = await confirm({
    variant: 'simple',
    title: `删除附件「${attachment.fileName}」？`,
    message: '附件会软删除，可通过消息中的撤回操作恢复。',
    confirmLabel: '删除附件',
  })
  if (!approved)
    return
  try {
    const logId = await store.removeAttachment(attachment.id)
    if (logId)
      undoToast(`已删除附件「${attachment.fileName}」`, () => store.undo([logId]))
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

function onBasisMismatch(label: string) {
  toastError(`无法识别取数基准「${label}」，请重新选择后再生成，避免按错误口径报量`)
}

async function generateMonthly(payload: { month: string, basis: QuantityBasis }) {
  try {
    await store.generateMonthly(payload.month, payload.basis)
    success(`${payload.month} 月度报量草稿已按${quantityBasisLabel(payload.basis)}生成`)
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function regenerateMonthly(payload: { statementId: string, basis: QuantityBasis }) {
  try {
    await store.regenerateMonthly(payload.statementId, payload.basis)
    success(`草稿已按${quantityBasisLabel(payload.basis)}重算`)
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function adjustMonthly(payload: { lineId: string, adjustedQty: number, note: string }) {
  try {
    await store.adjustMonthly(payload.lineId, payload.adjustedQty, payload.note)
    success('月度报量手调已保存')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function exportAll() {
  if (!store.workspace)
    return
  try {
    await exportFile(createBoqWorkbookExport(store.workspace))
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

async function downloadOriginal(ownerId: string, fileRefId: string, fileName: string) {
  try {
    await downloadActual({ defaultName: fileName, data: async () => (await store.loadOriginalFile(ownerId, fileRefId)).data })
  }
  catch (cause) { toastError(toErrorMessage(cause)) }
}

async function exportMonthly(statement: MonthlyStatementView) {
  if (!store.workspace)
    return
  try {
    await exportFile(createMonthlyStatementExport(
      statement,
      store.workspace.projectName,
      store.workspace.contractName,
    ))
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

onMounted(initialize)
</script>

<template>
  <CommandRecoveryPanel v-for="descriptor in store.pending" :key="descriptor.commandId" :command-id="descriptor.commandId" :saved="store.savedCommands.includes(descriptor.commandId)" :busy="store.saving" @recover="store.recover(descriptor)" />
  <div class="boq-workspace min-w-0 space-y-4">
    <section data-testid="boq-workspace-header" class="boq-header panel px-3 py-2">
      <div class="boq-header__main">
        <div class="boq-header__title min-w-0">
          <div class="text-11px font-700 tracking-wide text-brand">
            合同清单 · 变更 · 月度报量
          </div>
          <h1 class="mt-0.5 text-18px font-850 text-ink">
            合同工程量清单
          </h1>
          <p v-if="store.workspace" class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-11px text-ink-soft">
            <span>{{ store.workspace.projectName }}</span>
            <span aria-hidden="true">·</span>
            <EntityLink
              :id="store.workspace.contractId"
              type="contract"
              :label="store.workspace.contractName"
            />
            <span aria-hidden="true">·</span>
            <span
              class="min-w-0 break-all font-mono tabular-nums"
              :title="store.workspace.contractNo"
              data-testid="boq-contract-number"
            >
              {{ store.workspace.contractNo || '未编号' }}
            </span>
          </p>
          <p v-else class="mt-0.5 text-11px text-ink-soft">
            选择项目与施工合同后查看
          </p>
        </div>
        <div class="boq-header__field min-w-0">
          <span class="field-label block">项目</span>
          <ProjectSwitcher
            v-model="projectId"
            :projects="projectOptions"
            :loading="!initialized && store.loading"
            :error="store.error"
            aria-label="选择清单项目"
          />
        </div>
        <div class="boq-header__field min-w-0">
          <span class="field-label block">施工合同</span>
          <SelectFilter
            v-model="contractId"
            :options="contractOptions"
            :min-width="0"
            placeholder="选择施工合同"
            full-width
          />
        </div>
        <div class="boq-header__actions flex gap-2">
          <button type="button" class="btn-secondary" :disabled="!store.workspace" @click="exportAll">
            <span class="i-lucide-download mr-1" /> 导出台账
          </button>
          <NuxtLink
            v-if="!requestedTargetUnavailable"
            :to="{ path: '/contract/boq/import', query: { project: projectId, contract: contractId } }"
            class="btn-accent"
          >
            <span class="i-lucide-file-up mr-1" /> 导入清单
          </NuxtLink>
        </div>
      </div>

      <dl v-if="store.workspace" class="boq-summary-strip" aria-label="合同清单摘要">
        <div><dt>清单行</dt><dd>{{ store.workspace.summary.lineCount }}</dd></div>
        <div><dt>原合同合价</dt><dd>{{ yuan(store.workspace.summary.baseAmount) }}</dd></div>
        <div>
          <dt>已签证变更</dt><dd class="text-brand">
            {{ yuan(store.workspace.summary.approvedChangeAmount) }}
          </dd>
        </div>
        <div><dt>当前合同合价</dt><dd>{{ yuan(store.workspace.summary.effectiveAmount) }}</dd></div>
      </dl>
    </section>

    <section class="panel overflow-hidden px-3 pt-1">
      <SegTab v-model="activeTab" :tabs="tabs" />
    </section>

    <section v-if="store.originalFiles.length" class="panel min-w-0 space-y-2 p-3" aria-label="清单完整原件">
      <p class="text-12px font-700 text-ink">
        清单完整原件
      </p>
      <div v-for="file in store.originalFiles" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-2 text-12px">
        <span class="min-w-0 flex-1 break-words">{{ file.fileName }} · {{ file.formatClass === 'E' ? '独立分项单价库' : '施工清单' }}</span>
        <span v-if="file.bodyState === 'metadata-only'" class="text-ink-faint">原件不可用 · 原历史仅有描述</span>
        <KitButton v-else variant="secondary" :disabled="store.saving" :aria-label="`下载完整原件${file.fileName}`" @click="downloadOriginal(file.id, file.fileRefId, file.fileName)">
          下载原件
        </KitButton>
      </div>
    </section>

    <StatePanel
      v-if="(!initialized || store.loading) && !store.workspace"
      kind="loading"
      title="正在读取工程量清单"
      description="正在校验项目、施工合同与清单目录。"
    />
    <StatePanel
      v-else-if="store.error && !store.workspace"
      kind="error"
      title="工程量清单读取失败"
      :description="store.error"
      action-label="重新加载"
      @action="initialize"
    />
    <StatePanel
      v-else-if="requestedTargetUnavailable"
      kind="empty"
      title="指定的施工合同清单不可用"
      description="当前本地 BOQ 目录中没有与 URL 项目和合同稳定 ID 完全一致的清单，未切换到其他合同。"
    />
    <StatePanel
      v-else-if="!store.workspace"
      kind="empty"
      title="当前没有可用施工合同"
      description="先创建施工合同，再进入工程量清单。"
    />

    <section v-else-if="activeTab === 'lines'" class="boq-lines-layout grid min-w-0 grid-cols-[15rem_minmax(0,1fr)] gap-3">
      <aside class="min-w-0">
        <details open class="boq-catalog-filter">
          <summary class="boq-catalog-summary">
            <span class="i-lucide-list-tree" />
            目录筛选
            <span class="ml-auto text-ink-faint">{{ store.workspace.lines.length }} 行</span>
          </summary>
          <BoqCatalogTree
            v-model="treeScope"
            :catalog="store.workspace.catalog"
            :line-count="store.workspace.lines.length"
          />
        </details>
      </aside>
      <div class="min-w-0">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SearchInput v-model="search" placeholder="搜索分项、户型、房间或来源…" />
          <div class="text-11px text-ink-faint">
            来源追溯键永久保留 · 识别原值与人工修正并列
          </div>
        </div>
        <BoqLinesTable
          :lines="store.workspace.lines"
          :catalog="store.workspace.catalog"
          :scope-key="treeScope"
          :search="search"
          :loading="store.saving"
          @edit="editLine"
          @formula="openFieldFormula"
          @plan="openFloorPlan"
          @remove="removeLine"
        />
      </div>
    </section>

    <BoqChangeWorkspace
      v-else-if="activeTab === 'changes'"
      :workspace="store.workspace"
      :busy="store.saving"
      :focus-id="focusId"
      @create="createChange"
      @transition="transitionChange"
      @approve="approveChange"
      @revise-approved="reviseApprovedChange"
      @remove="removeChange"
      @attach="attachChange"
      @download-attachment="downloadAttachment"
      @remove-attachment="removeAttachment"
    />

    <StatePanel v-else-if="activeTab === 'monthly' && store.workspace?.monthlySourceState === 'unavailable'" kind="empty" title="甲方报量源单尚未正式接通" description="当前施工清单与有效变洽签已可核对，月报量不从本地或空集合补造。" />
    <BoqMonthlyWorkspace
      v-else-if="store.workspace"
      :workspace="store.workspace"
      :statement="store.monthlyStatement"
      :busy="store.saving"
      :focus-id="focusId"
      @select="store.loadStatement"
      @generate="generateMonthly"
      @regenerate="regenerateMonthly"
      @basis-mismatch="onBasisMismatch"
      @adjust="adjustMonthly"
      @export="exportMonthly"
    />
  </div>
</template>

<style scoped>
.boq-workspace { container-type: inline-size; overflow: hidden; }
.boq-header__main {
  display: grid;
  grid-template-columns: minmax(10rem, 0.8fr) minmax(11rem, 13rem) minmax(14rem, 19rem) auto;
  align-items: end;
  gap: 0.75rem;
}
.boq-header__field :deep([role="combobox"]),
.boq-header__field :deep([data-testid="project-switcher-trigger"]) {
  min-width: 0;
  max-width: 100%;
  width: 100%;
}
.boq-header__field :deep([role="combobox"]) {
  overflow: hidden;
  white-space: nowrap;
}
.boq-header__field :deep([role="combobox"] > span:first-child) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.boq-header__actions {
  align-items: center;
  align-self: end;
  white-space: nowrap;
}
.boq-summary-strip {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  margin-top: 0.625rem;
  border-top: 1px solid var(--line);
  padding-top: 0.5rem;
  scrollbar-width: thin;
  white-space: nowrap;
}
.boq-summary-strip > div {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 0.375rem;
  padding: 0 0.875rem;
  border-left: 1px solid var(--line);
}
.boq-summary-strip > div:first-child {
  padding-left: 0;
  border-left: 0;
}
.boq-summary-strip dt {
  color: var(--ink-faint);
  font-size: 11px;
}
.boq-summary-strip dd {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.boq-catalog-summary { display: none; }
@container (max-width: 68rem) {
  .boq-header__main {
    grid-template-columns: minmax(10rem, 12rem) minmax(13rem, 1fr) auto;
  }
  .boq-header__title { grid-column: 1 / -1; }
}
@container (max-width: 44rem) {
  .boq-header__main { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .boq-header__title,
  .boq-header__actions { grid-column: 1 / -1; }
  .boq-header__actions { justify-content: flex-end; }
}
@container (max-width: 32rem) {
  .boq-header__main { grid-template-columns: minmax(0, 1fr); }
  .boq-header__title,
  .boq-header__actions { grid-column: auto; }
  .boq-header__actions { justify-content: stretch; }
  .boq-header__actions > * { flex: 1 1 0; justify-content: center; }
}
@container (max-width: 58rem) {
  .boq-lines-layout { grid-template-columns: minmax(0, 1fr); }
  .boq-catalog-filter { border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--panel); }
  .boq-catalog-summary { display: flex; cursor: pointer; align-items: center; gap: 8px; padding: 10px 12px; color: var(--ink); font-size: 12px; font-weight: 750; }
  .boq-catalog-filter[open] .boq-catalog-summary { border-bottom: 1px solid var(--line); }
}
</style>
