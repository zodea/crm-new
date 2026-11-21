<script setup lang="ts">
// 发票编辑页签（#71）：左原件（上传会话中的原文件；不在会话中如实说明）+ 右完整字段集（与识别校对一致）+ 货物明细 +
// 重新识别 + 删除（软删 + 10 秒撤回 + 关页签）/ 保存（关页签回台账）。
// 字段走本地缓冲、保存一次提交（区别于工作台 correctField 即时落库）——
// 归档后保存前的 simple 二次确认（ADR 0003）在提交口拦截。
// 重新识别结果只作草稿填进缓冲，保存前二次确认列出变动；未保存的识别草稿离开/关页签须确认放弃。
// 同票复用页签由 tab-machine 同路由同参数复用保证；页签标题「发票·尾8位」useTabTitle 回填。
import type { RecognizedInvoiceFields } from '~/lib/invoice/recognize'
import type { InvoiceDocStatus } from '~/lib/invoice/status'
import type { Invoice } from '~/stores/invoice'
import { onBeforeRouteLeave } from 'vue-router'
import InvoiceOriginalMissing from '~/components/invoice/InvoiceOriginalMissing.vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'
import { useInvoiceRegionTarget } from '~/composables/useInvoiceRegionTarget'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { INVOICE_RECOGNITION_FIELDS, invoiceRecognitionChanges, invoiceRecognitionMarks, invoiceRecognitionSaveMessage } from '~/lib/invoice/recognition-changes'
import { invoiceRegionFocus, invoiceRegionHighlights } from '~/lib/invoice/recognition-regions'
import { invoiceDocStatus } from '~/lib/invoice/status'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { round2 } from '~/lib/util/number'

const route = useRoute()
const router = useRouter()
const store = useInvoiceStore()
const projectStore = useProjectStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error, undoToast } = useKitUI()

const id = computed(() => String(route.params.id))
const invoice = computed(() => store.byId(id.value))

function tail8(no: string | undefined) {
  return no ? no.slice(-8) : '—'
}

useTabTitle(() => invoice.value ? `发票·${tail8(invoice.value.invoiceNumber)}` : null)

// ── 字段本地缓冲 ──
interface FieldDef {
  key: keyof Invoice & string
  label: string
  type?: 'text' | 'date' | 'number' | 'select'
  mono?: boolean
  full?: boolean
  options?: string[]
  projectList?: boolean
}

// 字段集与识别校对一致（InvoiceReviewForm FIELDS，蓝本 §5.5 网格序）
const FIELDS: FieldDef[] = [
  { key: 'invoiceNumber', label: '单据编号', mono: true },
  { key: 'invoiceDate', label: '开票日期', type: 'date', mono: true },
  { key: 'buyer', label: '购买方' },
  { key: 'buyerTaxNo', label: '购买方税号', mono: true },
  { key: 'seller', label: '供应商' },
  { key: 'sellerTaxNo', label: '供应商税号', mono: true },
  { key: 'invoiceType', label: '票据类型', type: 'select', options: ['增值税专用发票', '增值税普通发票'] },
  { key: 'totalAmount', label: '价税合计', type: 'number', mono: true },
  { key: 'taxAmount', label: '税额', type: 'number', mono: true },
  { key: 'taxRate', label: '税率', mono: true },
  { key: 'projectName', label: '对应项目', full: true, projectList: true },
  { key: 'remark', label: '票面备注', full: true },
]

type FormShape = Record<string, string | number>

function snapshot(inv: Invoice): FormShape {
  const f: FormShape = {}
  for (const d of FIELDS)
    f[d.key] = inv[d.key] as string | number
  return f
}

const form = ref<FormShape>(invoice.value ? snapshot(invoice.value) : {})
const ownerKind = shallowRef<Invoice['ownerKind']>(invoice.value?.ownerKind ?? null)

function resetForm() {
  if (invoice.value) {
    form.value = snapshot(invoice.value)
    ownerKind.value = invoice.value.ownerKind
  }
}

const isRecognizing = computed(() => store.recognitionProgress[id.value] != null)

const isArchived = computed(() => invoice.value?.accountStatus === 'archived')

// 状态判定统一走 invoiceDocStatus（单一权威派生），此处只映射 chip 文案/样式
const DOC_CHIP: Record<InvoiceDocStatus, { label: string, cls: string }> = {
  recognizing: { label: '识别中', cls: 'chip-brand' },
  pending: { label: '待识别', cls: 'chip-warn' },
  failed: { label: '识别失败', cls: 'chip-danger' },
  duplicate: { label: '重复已排除', cls: 'chip-danger' },
  unreviewed: { label: '待校对', cls: 'chip-warn' },
  reviewed: { label: '已校对', cls: 'chip-ok' },
}
const docChip = computed(() => {
  const inv = invoice.value
  if (!inv)
    return null
  return DOC_CHIP[invoiceDocStatus(inv, store.recognitionProgress[inv.id] != null)]
})
const showItems = shallowRef(false)

// ── 重新识别草稿（用户 2026-10-13 确认）：识别结果只填进表单缓冲，数据库保持识别前的值，
// 保存时二次确认列出变动；放弃则恢复识别前的表单。首次识别（未识别/失败票）仍直接写库。
interface RecognitionDraft {
  /** 识别前用户看到的表单（含当时未保存的手工修改）；多次重识别保留最早一份 */
  before: FormShape
  recognized: RecognizedInvoiceFields
  /** 识别结果套进表单后的值，用于判断其后的人工修改 */
  applied: FormShape
  ownerKind: Invoice['ownerKind']
}
const recognitionDraft = shallowRef<RecognitionDraft | null>(null)
const recognitionChanges = computed(() => recognitionDraft.value
  ? invoiceRecognitionChanges(INVOICE_RECOGNITION_FIELDS, recognitionDraft.value.before, form.value)
  : [])
const recognitionMarks = computed(() => recognitionDraft.value
  ? invoiceRecognitionMarks(INVOICE_RECOGNITION_FIELDS, recognitionDraft.value.before, recognitionDraft.value.applied, form.value)
  : {})

// 左栏原件：原文件仍在上传会话中时显示真实原件（可缩放、旋转，PDF 逐页），否则如实说明不在会话中。
// 区域框只在内存中、随原文件失效：重新识别草稿常驻框出变动字段（比对）；否则已识别票用最近写入的
// 识别区域做点字段定位——聚焦/悬停识别字段时只框该字段，失焦撤回。
const originalFile = computed(() => store.recognitionFile(id.value))
const RECOGNITION_KEYS = new Set(INVOICE_RECOGNITION_FIELDS.map(field => field.key))
const regionTarget = useInvoiceRegionTarget()
const draftRegions = computed(() => {
  const pending = recognitionDraft.value
  if (!pending || !originalFile.value)
    return undefined
  const { groups, unlocated } = invoiceRegionHighlights(INVOICE_RECOGNITION_FIELDS, recognitionMarks.value, pending.recognized.fieldRegions)
  return groups.length || unlocated.length ? { mode: 'compare' as const, groups, unlocated } : undefined
})
const focusRegions = computed(() => {
  const regions = !recognitionDraft.value && invoice.value?.ocrStatus === 'done' && originalFile.value
    ? store.recognitionRegions(id.value)
    : undefined
  if (!regions)
    return undefined
  const { groups, unlocated } = invoiceRegionFocus(INVOICE_RECOGNITION_FIELDS, regions, regionTarget.active.value)
  return { mode: 'focus' as const, groups, unlocated, locatedKeys: Object.keys(regions) }
})
const viewerRegions = computed(() => draftRegions.value ?? focusRegions.value)
const draftLocatedKeys = computed(() => draftRegions.value?.groups.flatMap(group => group.keys))
const draftUnlocatedKeys = computed(() => draftRegions.value?.unlocated.map(field => field.key))
watch(() => recognitionDraft.value?.recognized, () => regionTarget.reset())

/** 点字段定位下该字段是否参与（识别字段才有原图区域） */
function focusLocatable(key: string) {
  return !!focusRegions.value && RECOGNITION_KEYS.has(key)
}

function regionHintId(key: string) {
  return `invoice-${id.value}-${key}-region-hint`
}

function focusUnlocated(key: string) {
  return focusLocatable(key) && !focusRegions.value!.locatedKeys.includes(key)
}

function describedBy(key: string) {
  if (recognitionMarks.value[key])
    return markId(key)
  return focusUnlocated(key) ? regionHintId(key) : undefined
}

function onFieldFocus(key: string) {
  if (recognitionMarks.value[key] || focusLocatable(key))
    regionTarget.locate(key)
}

function onFieldBlur(key: string) {
  if (focusLocatable(key))
    regionTarget.release(key)
}

function onFieldHover(key: string, hovering: boolean) {
  if (recognitionMarks.value[key] || focusLocatable(key))
    regionTarget.preview(hovering ? key : null)
}

// ── 关页签回台账（设计稿行为：删/存后回台账）──
// 删除、保存成功后调用方已处理草稿，直接关；返回按钮经离开保护。
let allowLeave = false
function closeTabToLedger() {
  allowLeave = true
  tabsStore.close(deriveKey(route.fullPath))
  router.push('/finance/ledger')
}

async function backToLedger() {
  if (await canLeave())
    closeTabToLedger()
}

// ── 保存：diff 缓冲 → 一次提交；归档后先 simple 二次确认 ──
async function save() {
  const inv = invoice.value
  if (!inv || isRecognizing.value)
    return

  const total = Number(form.value.totalAmount)
  const tax = Number(form.value.taxAmount)
  if (Number.isNaN(total) || Number.isNaN(tax)) {
    warning('价税合计 / 税额需要有效金额')
    return
  }

  // 归属解析：项目归属须命中项目主数据规范名（归档铁律，保护 §4.2 台账口径）
  const patch: Partial<Invoice> = { ownerKind: ownerKind.value }
  for (const d of FIELDS) {
    const v = form.value[d.key]
    patch[d.key] = (d.type === 'number' ? round2(Number(v)) : v) as never
  }
  patch.amount = round2(total - tax)

  if (ownerKind.value === 'project') {
    const nameInput = String(form.value.projectName).trim()
    const project = projectStore.list.find(p => p.name === nameInput)
    if (project) {
      patch.projectId = project.id
      patch.projectName = project.name
    }
    else if (nameInput === inv.projectName && inv.projectId) {
      // 项目名未改且原挂接有效：沿用原 projectId（历史/种子票的项目名可能非主数据规范名，
      // 不因别的字段修改被归属校验连坐拦下）
      patch.projectId = inv.projectId
    }
    else if (isArchived.value) {
      warning('已归档发票的项目归属必须命中项目主数据，请从下拉中选择')
      return
    }
    else {
      patch.projectId = null
    }
  }
  else if (ownerKind.value === 'personal') {
    patch.projectId = null
    patch.projectName = ''
  }

  const pendingDraft = recognitionDraft.value
  if (pendingDraft) {
    const ok = await confirm({
      variant: 'simple',
      title: '保存重新识别结果',
      message: invoiceRecognitionSaveMessage(recognitionChanges.value),
      confirmLabel: '确认保存',
    })
    if (!ok || recognitionDraft.value !== pendingDraft)
      return
  }
  else if (isArchived.value) {
    const ok = await confirm({
      variant: 'simple',
      title: '修改已归档发票',
      message: '该发票已归档入台账，保存将同步更新台账统计。确认保存本次修改？',
      confirmLabel: '确认修改',
    })
    if (!ok)
      return
  }

  // store.update 是全列覆写：必须以最新行为底合并 patch，否则未编辑列（accountStatus 等）会被冲掉
  try {
    // 识别草稿：先以识别操作人写识别结果，再把表单上的人工值以人工写一次（#500 审计区分）
    const saved = pendingDraft
      ? await store.saveRecognitionDraft(inv.id, pendingDraft.recognized, patch)
      : await store.update(inv.id, { ...store.byId(inv.id), ...patch })
    if (!saved) {
      error('保存失败：发票不存在或已删除')
      return
    }
    recognitionDraft.value = null
    success(pendingDraft ? '已保存重新识别结果' : '已保存修改')
    closeTabToLedger()
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '保存失败，请重试')
  }
}

// ── 删除：软删 + 10 秒撤回 + 自动关页签 ──
async function del() {
  const inv = invoice.value
  if (!inv)
    return
  const ok = await confirm({
    variant: 'simple',
    title: '删除发票',
    message: `确认删除发票「${tail8(inv.invoiceNumber)}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  const logId = await store.remove(inv.id)
  if (!logId) {
    error('删除失败：发票不存在或已删除')
    return
  }
  undoToast(`已删除发票「${tail8(inv.invoiceNumber)}」`, () => store.undo(logId))
  recognitionDraft.value = null
  closeTabToLedger()
}

function markId(key: string) {
  return `invoice-${id.value}-${key}-recognition-mark`
}

async function rerecognize() {
  const inv = invoice.value
  if (!inv)
    return
  if (inv.ocrStatus !== 'done') {
    const succeeded = await store.startRecognition(inv.id)
    if (inv.id !== id.value)
      return
    if (succeeded) {
      resetForm()
      success('识别完成，字段已刷新')
    }
    else {
      error(store.recognitionError(inv.id) || '未完成识别，已保留当前输入')
    }
    return
  }
  const before = recognitionDraft.value?.before ?? { ...form.value }
  const recognized = await store.recognizeDraft(inv.id)
  if (inv.id !== id.value)
    return
  if (!recognized) {
    error(store.recognitionError(inv.id) || '未完成重新识别，已保留当前输入')
    return
  }
  const applied = { ...form.value }
  for (const { key } of INVOICE_RECOGNITION_FIELDS)
    applied[key] = recognized[key as keyof RecognizedInvoiceFields] as string | number
  form.value = { ...applied }
  recognitionDraft.value = { before, recognized, applied, ownerKind: ownerKind.value }
  const count = recognitionChanges.value.length
  success(count ? `识别完成，${count} 项与识别前不同，未保存，请核对后保存` : '识别完成，字段与识别前一致，保存后回到待校对')
}

/** 放弃识别草稿：表单恢复识别前的值（含当时未保存的手工修改）。 */
function discardRecognition() {
  const pending = recognitionDraft.value
  if (!pending)
    return
  form.value = { ...pending.before }
  ownerKind.value = pending.ownerKind
  recognitionDraft.value = null
}

async function canLeave() {
  if (allowLeave || !recognitionDraft.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃识别结果',
    message: '重新识别结果尚未保存，确认放弃并离开？',
    confirmLabel: '放弃识别结果',
  })
}
useTabCloseGuard(canLeave)
onBeforeRouteLeave(canLeave)

onMounted(() => {
  if (!store.list.length)
    store.load().then(resetForm)
})
</script>

<template>
  <!-- 空态：不存在或已删除 -->
  <div v-if="!invoice" class="panel flex flex-col items-center gap-3 py-10 text-ink-soft">
    <span class="i-lucide-file-x h-8 w-8 text-ink-faint" aria-hidden="true" />
    <div>该发票不存在或已删除。</div>
    <NuxtLink to="/finance/ledger" class="btn-secondary">
      <span class="i-lucide-arrow-left mr-1 text-13px" aria-hidden="true" />返回台账
    </NuxtLink>
  </div>

  <div v-else class="invoice-edit-screen flex flex-col gap-3">
    <!-- 顶条：返回 + 号码/卖方 + 状态 -->
    <div class="panel flex flex-wrap items-center gap-3 p-3">
      <button class="btn-secondary" @click="backToLedger">
        <span class="i-lucide-arrow-left mr-1 text-13px" aria-hidden="true" />返回台账
      </button>
      <div class="min-w-0 flex flex-wrap items-baseline gap-2">
        <span class="font-mono text-15px font-800">{{ invoice.invoiceNumber || '—' }}</span>
        <span class="text-12px text-ink-soft">{{ invoice.seller }}</span>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span v-if="docChip" :class="docChip.cls">{{ docChip.label }}</span>
        <span v-if="isArchived" class="chip-ok">已在台账</span>
      </div>
    </div>

    <div class="invoice-edit-layout grid items-start gap-3">
      <!-- 左：原图 -->
      <div class="panel min-h-[420px] flex flex-col overflow-hidden">
        <div class="border-b border-line bg-surface-2 px-3 py-2 text-12px font-700 text-ink-soft">
          发票原件 · {{ invoice.fileName || '无扫描件' }}
        </div>
        <div v-if="originalFile" class="invoice-edit-regions flex flex-col bg-surface-sink p-3">
          <InvoiceRegionViewer
            class="min-h-0 flex-1"
            :file="originalFile"
            :mode="viewerRegions?.mode"
            :groups="viewerRegions?.groups"
            :unlocated="viewerRegions?.unlocated"
            :active-key="regionTarget.active.value"
          />
        </div>
        <div v-else class="grid flex-1 place-items-center bg-surface-sink p-6">
          <InvoiceOriginalMissing :invoice="invoice" />
        </div>
      </div>

      <!-- 右：字段（本地缓冲）+ 明细 + 动作 -->
      <div class="invoice-edit-form panel flex min-w-0 flex-col gap-3 p-4">
        <h2 class="text-15px font-800">
          发票字段
        </h2>

        <!-- 归属（与校对表单一致：项目 / 个人开支） -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-12px font-600 text-ink-soft">归属</span>
          <div class="inline-flex overflow-hidden border border-line rounded-[var(--radius-btn)]">
            <button
              v-for="k in (['project', 'personal'] as const)"
              :key="k"
              type="button"
              class="border-0 px-2.5 py-1 text-12px"
              :class="ownerKind === k ? 'bg-brand-soft font-800 text-brand-deep' : 'bg-panel font-600 text-ink-soft hover:bg-surface-3'"
              @click="ownerKind = k"
            >
              {{ k === 'project' ? '归属项目' : '个人开支' }}
            </button>
          </div>
          <span v-if="!ownerKind" class="chip-warn">未归属</span>
        </div>

        <div class="invoice-edit-fields grid gap-x-3 gap-y-2.5">
          <div v-for="d in FIELDS" :key="d.key" :class="{ 'invoice-edit-fields__full': d.full }">
            <div class="flex items-center gap-1">
              <label class="field-label" :for="`invoice-${id}-${d.key}`">{{ d.label }}</label>
              <InvoiceRecognitionFieldMark v-if="recognitionMarks[d.key]" :id="markId(d.key)" :mark="recognitionMarks[d.key]!" :located="draftLocatedKeys ? draftLocatedKeys.includes(d.key) : undefined" />
              <span v-if="focusUnlocated(d.key)" :id="regionHintId(d.key)" class="sr-only">原图未定位</span>
            </div>
            <select
              v-if="d.type === 'select'"
              :id="`invoice-${id}-${d.key}`"
              v-model="form[d.key]"
              :disabled="isRecognizing"
              class="field-input w-full"
              :class="recognitionMarks[d.key] ? 'border-warn! bg-warn-soft!' : ''"
              :aria-describedby="describedBy(d.key)"
              @focus="onFieldFocus(d.key)"
              @blur="onFieldBlur(d.key)"
              @mouseenter="onFieldHover(d.key, true)"
              @mouseleave="onFieldHover(d.key, false)"
            >
              <option v-for="o in d.options" :key="o" :value="o">
                {{ o }}
              </option>
            </select>
            <template v-else-if="d.projectList">
              <input
                :id="`invoice-${id}-${d.key}`"
                v-model="form[d.key]"
                class="field-input w-full"
                list="edit-project-options"
                placeholder="从项目主数据选择…"
                :disabled="ownerKind === 'personal' || isRecognizing"
              >
              <datalist id="edit-project-options">
                <option v-for="p in projectStore.list" :key="p.id" :value="p.name" />
              </datalist>
            </template>
            <input
              v-else
              :id="`invoice-${id}-${d.key}`"
              v-model="form[d.key]"
              :disabled="isRecognizing"
              class="field-input w-full"
              :class="[d.mono ? 'font-mono' : '', recognitionMarks[d.key] ? 'border-warn! bg-warn-soft!' : '']"
              :aria-describedby="describedBy(d.key)"
              :type="d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'"
              @focus="onFieldFocus(d.key)"
              @blur="onFieldBlur(d.key)"
              @mouseenter="onFieldHover(d.key, true)"
              @mouseleave="onFieldHover(d.key, false)"
            >
          </div>
        </div>

        <!-- 货物明细（只读折叠，与校对表单同口径） -->
        <div class="border-t border-line pt-2">
          <button
            type="button"
            class="flex items-center gap-1 border-0 bg-transparent p-0 text-12px font-700 text-ink-soft cursor-pointer hover:text-ink"
            @click="showItems = !showItems"
          >
            <span :class="showItems ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-[13px] w-[13px]" aria-hidden="true" />
            货物明细（{{ invoice.items.length }} 行）
          </button>
          <div
            v-if="showItems && invoice.items.length"
            class="mt-2 overflow-x-auto"
            data-testid="invoice-edit-items-scroll"
          >
            <table class="min-w-[620px] w-full border-collapse text-12px">
              <thead>
                <tr class="bg-surface-2 text-left text-ink-soft">
                  <th class="border-b border-line px-2 py-1.5 font-600">
                    名称
                  </th>
                  <th class="border-b border-line px-2 py-1.5 font-600">
                    规格
                  </th>
                  <th class="border-b border-line px-2 py-1.5 font-600">
                    单位
                  </th>
                  <th class="border-b border-line px-2 py-1.5 text-right font-600">
                    数量
                  </th>
                  <th class="border-b border-line px-2 py-1.5 text-right font-600">
                    单价
                  </th>
                  <th class="border-b border-line px-2 py-1.5 text-right font-600">
                    金额
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in invoice.items" :key="i" class="border-b border-line">
                  <td class="px-2 py-1.5">
                    {{ it.name }}
                  </td>
                  <td class="px-2 py-1.5 text-ink-soft">
                    {{ it.spec || '—' }}
                  </td>
                  <td class="px-2 py-1.5 text-ink-soft">
                    {{ it.unit || '—' }}
                  </td>
                  <td class="px-2 py-1.5 text-right font-mono">
                    {{ it.quantity }}
                  </td>
                  <td class="px-2 py-1.5 text-right font-mono">
                    {{ it.unitPrice }}
                  </td>
                  <td class="px-2 py-1.5 text-right font-mono">
                    {{ it.amount }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="showItems" class="mt-2 text-12px text-ink-faint">
            无明细行。
          </div>
        </div>

        <InvoiceRecognitionChanges
          v-if="recognitionDraft"
          class="mt-1"
          :changes="recognitionChanges"
          :unlocated-keys="draftUnlocatedKeys"
          @discard="discardRecognition"
          @locate="regionTarget.locate"
          @preview="regionTarget.preview"
        />

        <!-- 动作：删除 ｜ 重新识别 + 保存 -->
        <div class="mt-1 flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
          <button class="btn-danger" @click="del">
            <span class="i-lucide-trash-2 mr-1 text-13px" aria-hidden="true" />删除
          </button>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button class="btn-secondary" :disabled="isRecognizing || isArchived" @click="rerecognize">
              <span class="i-lucide-refresh-cw mr-1 text-13px" aria-hidden="true" />
              {{ isRecognizing ? '识别中…' : '重新识别' }}
            </button>
            <button class="btn-accent" :disabled="isRecognizing" @click="save">
              <span class="i-lucide-save mr-1 text-13px" aria-hidden="true" />保存
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.invoice-edit-screen,
.invoice-edit-form {
  container-type: inline-size;
}

.invoice-edit-layout {
  grid-template-columns: minmax(0, 1fr);
}

.invoice-edit-fields {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr));
}

.invoice-edit-fields__full {
  grid-column: 1 / -1;
}

/* 原件预览区给定高度，原图在自身区域内滚动，不撑高整页 */
.invoice-edit-regions {
  height: min(75vh, 880px);
}

@container (min-width: 64rem) {
  .invoice-edit-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
