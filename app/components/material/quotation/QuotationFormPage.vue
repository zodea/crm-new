<script setup lang="ts">
import type { PendingFileRef } from '~/components/shared/FileRefAttachmentSection.vue'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { QuotationDraft, QuotationFile, QuotationHistory, QuotationLine } from '~/lib/material-quotation/contract'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { createFormCommandActions } from '~/lib/forms/command-session'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { newQuotationDraft, newQuotationLine } from '~/lib/material-quotation/contract'
import { quotationUnknownProblem } from '~/lib/material-quotation/http-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'

const route = useRoute()
const router = useRouter()
const kit = useKitUI()
const repository = useMaterialQuotationRepository()
const latestConflict = shallowRef<Awaited<ReturnType<typeof repository.loadForm>> | null>(null)
const actions = createFormCommandActions({ repository: () => repository, capability: 'material-quotation:write' as const, problemFromUnknown: quotationUnknownProblem, conflict: (latest) => {
  latestConflict.value = latest
  return new Error('报价已更新；请核对版本，当前输入和原件仍保留')
} })
const session = actions.createSession()
const draft = ref<QuotationDraft & {
  id?: string
}>(newQuotationDraft())
const attachments = shallowRef<QuotationFile[]>([])
const history = shallowRef<QuotationHistory[]>([])
const pending = ref<PendingFileRef[]>([])
const removeIds = ref<string[]>([])
const restoreIds = ref<string[]>([])
const baseline = ref(JSON.stringify(draft.value))
const loading = ref(false)
const error = ref('')
const loadingAction = ref<FormFooterAction | null>(null)
const closeAfter = ref(true)
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
const title = computed(() => `${id.value ?? session.targetId ? '编辑' : '新增'} · 材料报价`)
const dirty = computed(() => baseline.value !== JSON.stringify(draft.value) || Boolean(pending.value.length || removeIds.value.length || restoreIds.value.length))
const canWrite = computed(() => session.context?.capabilities.includes('material-quotation:write') === true)
let generation = 0
let active = true
let submitted: string | null = null
let submittedChanges: {
  add: PendingFileRef[]
  remove: string[]
  restore: string[]
} | null = null
let retainRouteInput = false
const inputs = () => JSON.stringify({ draft: draft.value, pending: pending.value, removeIds: removeIds.value, restoreIds: restoreIds.value })
function invalidate(message: string) {
  generation++
  actions.invalidate(session)
  attachments.value = []
  history.value = []
  latestConflict.value = null
  loading.value = false
  error.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
function adoptRead(form: Awaited<ReturnType<typeof repository.loadForm>>, adoptInput: boolean) {
  baseline.value = JSON.stringify(form.draft)
  history.value = form.history
  attachments.value = form.attachments
  if (adoptInput) {
    draft.value = form.draft
    pending.value = []
    removeIds.value = []
    restoreIds.value = []
  }
  else if (submittedChanges) {
    pending.value = pending.value.filter(file => !submittedChanges!.add.some(saved => saved.localId === file.localId && JSON.stringify(saved) === JSON.stringify(file)))
    removeIds.value = removeIds.value.filter(id => !submittedChanges!.remove.includes(id))
    restoreIds.value = restoreIds.value.filter(id => !submittedChanges!.restore.includes(id))
  }
  submittedChanges = null
}
async function canonicalFormTarget(targetId: string) {
  if (id.value === targetId || session.targetId !== targetId || dirty.value)
    return
  retainRouteInput = true
  await router.replace(`/material/quotations/form/${targetId}`)
}
async function initialize(retain = false) {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = retain ? await actions.revalidate(session) : await actions.hydrate(session, id.value)
    if (!active || current !== generation)
      return
    if (result.form) {
      adoptRead(result.form, !retain)
    }
    else if (!retain) {
      draft.value = newQuotationDraft()
      baseline.value = JSON.stringify(draft.value)
      attachments.value = []
      history.value = []
      pending.value = []
      removeIds.value = []
      restoreIds.value = []
    }
    if (!result.context.capabilities.includes('material-quotation:write'))
      error.value = '当前会话仅可读取报价'
  }
  catch (cause) {
    if (active && current === generation)
      error.value = quotationUnknownProblem(cause).message
  }
  finally {
    if (current === generation)
      loading.value = false
  }
}
async function save(action: FormFooterAction) {
  if (action === 'cancel') {
    await leave()
    return
  }
  if (!canWrite.value || loading.value || error.value || session.pending || session.busy)
    return
  const current = generation
  const input = inputs()
  submitted = input
  submittedChanges = JSON.parse(JSON.stringify({ add: pending.value, remove: removeIds.value, restore: restoreIds.value }))
  loadingAction.value = action
  try {
    const result = await actions.saveForm(session, draft.value, 'save', { add: pending.value.map(({ localId: _id, ...file }) => file), removeIds: [...removeIds.value], restoreIds: [...restoreIds.value] })
    if (!active || current !== generation)
      return
    const retained = input !== inputs()
    adoptRead(result.form, !retained)
    if (retained) {
      kit.success('原提交已保存并读回，后来的输入仍保留')
      return
    }
    kit.success('报价已保存并读取确认')
    if (action === 'saveNew') {
      actions.startNew(session)
      await router.push('/material/quotations/form')
      await initialize()
      return
    }
    if (closeAfter.value)
      await router.push(`/material/quotations/${result.id}`)
    else
      await canonicalFormTarget(result.id)
  }
  catch (cause) {
    if (active && current === generation)
      kit.error(quotationUnknownProblem(cause).message)
  }
  finally {
    if (current === generation)
      loadingAction.value = null
  }
}
async function recover() {
  const current = generation
  const input = inputs()
  try {
    const result = await actions.recover(session)
    if (!active || current !== generation)
      return
    if (result.outcome === 'applied' && result.form) {
      const retained = (submitted !== null && input !== submitted) || input !== inputs()
      adoptRead(result.form, !retained)
      if (!retained)
        await canonicalFormTarget(result.result.id)
    }
    error.value = ''
    kit.success(result.outcome === 'applied' ? '原提交已保存并读取确认' : '原编号已封存为未应用，当前输入可重新明确提交')
  }
  catch (cause) {
    if (active && current === generation)
      kit.error(quotationUnknownProblem(cause).message)
  }
}
function adoptVersion() {
  if (latestConflict.value) {
    actions.adoptConflictVersion(session, latestConflict.value)
    history.value = latestConflict.value.history
    latestConflict.value = null
  }
}
function toggleFile(fileId: string) {
  const removed = attachments.value.find(file => file.id === fileId)?.deletedAt
  const ids = removed ? restoreIds : removeIds
  ids.value = ids.value.includes(fileId) ? ids.value.filter(id => id !== fileId) : [...ids.value, fileId]
}
async function pickFiles(files: File[]) {
  const current = generation
  try {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('单份报价原件不能超过10 MiB')
      const data = await fileRefDraftFromFile(file)
      if (!active || current !== generation)
        return
      pending.value.push({ ...data, localId: crypto.randomUUID() })
    }
  }
  catch (cause) {
    kit.error(quotationUnknownProblem(cause).message)
  }
}
function text(event: Event) {
  return (event.target as HTMLInputElement).value
}
function number(line: QuotationLine, field: 'unitPrice' | 'quantity' | 'taxRate', event: Event) {
  const value = text(event)
  line[field] = value.trim() ? Number(value) : null
}
function condition(line: QuotationLine, field: 'freight' | 'quantityCondition' | 'paymentCondition' | 'validity', event: Event) {
  const value = text(event)
  line[field] = value || null
}
function scope(event: Event) {
  draft.value.scope = text(event) as QuotationDraft['scope']
  if (draft.value.scope !== 'project')
    draft.value.projectId = null
}
async function leave() {
  if (!dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '报价或原件尚未保存，确认返回？', confirmLabel: '放弃修改' }))
    await router.push('/material/quotations')
}
useTabCloseGuard(async () => !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '报价或原件尚未保存，确认关闭？', confirmLabel: '放弃修改' }))
watch(id, () => {
  const retain = retainRouteInput
  retainRouteInput = false
  void initialize(retain)
}, { immediate: true })
onDeactivated(() => {
  active = false
  invalidate('页面已停用，请重新核对原身份')
})
onBeforeUnmount(() => {
  active = false
  invalidate('页面已关闭')
})
onActivated(() => {
  if (!active) {
    active = true
    void initialize(true)
  }
})
useTabTitle(title)
const conditions = [{ key: 'freight' as const, label: '运费条件' }, { key: 'quantityCondition' as const, label: '数量条件' }, { key: 'paymentCondition' as const, label: '付款条件' }, { key: 'validity' as const, label: '有效条件' }]
</script>

<template>
  <EntityFormShell :title="title" back-label="返回报价清单" :sections="[{ key: 'facts', label: '报价资料' }, { key: 'lines', label: '材料明细' }, { key: 'attachments', label: '原件与备注' }]" :state="loading && !session.pending ? 'loading' : error && !session.pending ? 'error' : 'ready'" :state-title="error || '正在读取报价'" state-action-label="重新核对" @back="leave" @state-action="initialize(Boolean(session.authority))">
    <form class="grid min-w-0 gap-4" @submit.prevent>
      <CommandRecoveryPanel v-if="session.pending" :command-id="session.pending.id" :saved="Boolean(session.pending.result)" :busy="session.busy" @recover="recover" />
      <section v-if="latestConflict" class="panel grid gap-2 p-4 text-13px" role="status">
        <strong>最新报价版本 {{ latestConflict.version }} · {{ latestConflict.draft.partyName }}</strong><pre class="max-h-60 overflow-auto whitespace-pre-wrap text-12px">{{ JSON.stringify(latestConflict.draft, null, 2) }}</pre><button type="button" class="btn-secondary justify-self-start" :disabled="Boolean(session.pending)" @click="adoptVersion">
          核对最新版本并保留当前输入
        </button>
      </section>
      <fieldset id="section-facts" class="panel m-0 grid min-w-0 gap-4 border-line p-4" :disabled="!canWrite">
        <legend class="px-1 text-15px font-700">
          报价资料
        </legend><p class="m-0 text-13px text-ink-soft">
          按原文录入。未建档报价方可直接保存；项目不明确请选择“范围未知”。数字留空表示未知，0表示原件明确为零。
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1 text-13px">报价方原文 *<input v-model="draft.partyName" class="field-input w-full" data-testid="quotation-party" required></label>
          <label class="grid gap-1 text-13px">已核验分供方（可空）<select v-model="draft.supplierId" class="field-input w-full" data-testid="quotation-supplier"><option :value="null">未关联</option><option v-for="supplier in session.context?.suppliers ?? []" :key="supplier.id" :value="supplier.id">{{ supplier.name }} · {{ supplier.id }}</option></select></label>
          <label class="grid gap-1 text-13px">实际适用范围<select :value="draft.scope" class="field-input w-full" data-testid="quotation-scope" @change="scope"><option value="unknown">范围未知</option><option value="general">通用报价（明确无项目）</option><option value="project">明确项目</option></select></label>
          <label v-if="draft.scope === 'project'" class="grid gap-1 text-13px">已核验项目 *<select v-model="draft.projectId" class="field-input w-full" data-testid="quotation-project"><option :value="null">请选择项目</option><option v-for="project in session.context?.projects ?? []" :key="project.id" :value="project.id">{{ project.name }} · {{ project.id }}</option></select></label>
          <label class="grid gap-1 text-13px">原报价日期（未知留空）<input type="date" :value="draft.quotationDate ?? ''" class="field-input w-full" @input="draft.quotationDate = text($event) || null"></label>
        </div>
      </fieldset>
      <section id="section-lines" class="panel grid min-w-0 gap-3 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title="材料原始明细" /><button type="button" class="btn-secondary" :disabled="!canWrite || Boolean(session.pending)" @click="draft.lines.push(newQuotationLine())">
            添加材料
          </button>
        </div>
        <fieldset v-for="(line, index) in draft.lines" :key="line.id" class="m-0 grid min-w-0 gap-3 rounded border border-line p-3" :disabled="!canWrite">
          <legend class="px-1 text-13px font-600">
            材料 {{ index + 1 }}
          </legend><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label v-for="field in [{ key: 'name' as const, label: '名称 *' }, { key: 'spec' as const, label: '规格' }, { key: 'grade' as const, label: '等级' }, { key: 'brand' as const, label: '品牌' }, { key: 'unit' as const, label: '原计价单位 *' }]" :key="field.key" class="grid gap-1 text-13px">{{ field.label }}<input v-model="line[field.key]" class="field-input w-full" :data-testid="`quotation-line-${index}-${field.key}`"></label>
            <label class="grid gap-1 text-13px">原报价单价<input type="number" min="0" step="any" :value="line.unitPrice ?? ''" class="field-input w-full" :data-testid="`quotation-line-${index}-price`" @input="number(line, 'unitPrice', $event)"></label>
            <label class="grid gap-1 text-13px">报价数量<input type="number" min="0" step="any" :value="line.quantity ?? ''" class="field-input w-full" @input="number(line, 'quantity', $event)"></label>
            <label class="grid gap-1 text-13px">含税口径<select v-model="line.taxIncluded" class="field-input w-full"><option :value="null">未知</option><option :value="true">含税</option><option :value="false">不含税</option></select></label>
            <label class="grid gap-1 text-13px">原适用税率（%）<input type="number" min="0" max="100" step="any" :value="line.taxRate ?? ''" class="field-input w-full" @input="number(line, 'taxRate', $event)"></label>
            <label v-for="field in conditions" :key="field.key" class="grid gap-1 text-13px">{{ field.label }}<input :value="line[field.key] ?? ''" class="field-input w-full" placeholder="原件未明确请留空" @input="condition(line, field.key, $event)"></label>
          </div><p class="m-0 break-all text-11px text-ink-faint">
            明细身份 {{ line.id }}
          </p><button v-if="draft.lines.length > 1" type="button" class="btn-secondary justify-self-start text-danger" @click="draft.lines.splice(index, 1)">
            移除此行（历史版本保留）
          </button>
        </fieldset>
      </section>
      <FileRefAttachmentSection :attachments="attachments" :pending-attachments="pending" :pending-remove-ids="removeIds" :pending-restore-ids="restoreIds" :note="draft.note" :readonly="!canWrite || Boolean(session.pending) || session.busy" picker-description="选择真实报价原件，正文与报价同次保存" @files="pickFiles" @toggle-existing="toggleFile" @remove-pending="pending = pending.filter(file => file.localId !== $event)" @patch-pending="(fileId, patch) => { const file = pending.find(file => file.localId === fileId); if (file) Object.assign(file, patch) }" @update-note="draft.note = $event" />
      <p v-if="history.length" class="m-0 text-13px text-ink-soft">
        已保留 {{ history.length }} 个不可变报价版本，可在报价详情查看历史原价与原件。
      </p>
      <FormFooter v-model="closeAfter" :actions="['cancel', 'saveNew', 'save']" :dirty="dirty" close-after-save :write-disabled="!canWrite || loading || Boolean(session.pending) || session.busy || Boolean(error)" :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
