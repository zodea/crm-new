<script setup lang="ts">
// 发票编辑页签（#71）：左原图 + 右完整字段集（与识别校对一致）+ 货物明细 +
// 重新识别（桩）+ 删除（软删 + 10 秒撤回 + 关页签）/ 保存（关页签回台账）。
// 字段走本地缓冲、保存一次提交（区别于工作台 correctField 即时落库）——
// 归档后保存前的 simple 二次确认（ADR 0003）在提交口拦截。
// 同票复用页签由 tab-machine 同路由同参数复用保证；页签标题「发票·尾8位」useTabTitle 回填。
import type { InvoiceDocStatus } from '~/lib/invoice/status'
import type { Invoice } from '~/stores/invoice'
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

// 重新识别完成（processing → done）后刷新缓冲区；不在用户编辑中途随意重置
watch(() => invoice.value?.ocrStatus, (next, prev) => {
  if (prev === 'processing' && next === 'done') {
    resetForm()
    success('识别完成，字段已刷新')
  }
})

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

// ── 关页签回台账（设计稿行为：删/存后回台账）──
function closeTabToLedger() {
  tabsStore.close(deriveKey(route.fullPath))
  router.push('/finance/ledger')
}

// ── 保存：diff 缓冲 → 一次提交；归档后先 simple 二次确认 ──
async function save() {
  const inv = invoice.value
  if (!inv)
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

  if (isArchived.value) {
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
  await store.update(inv.id, { ...inv, ...patch })
  success('已保存修改')
  closeTabToLedger()
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
  closeTabToLedger()
}

// ── 重新识别（桩识别引擎，#60 缝）──
async function rerecognize() {
  const inv = invoice.value
  if (!inv)
    return
  success('已重新排队 OCR 识别')
  await store.startRecognition(inv.id)
}

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

  <div v-else class="flex flex-col gap-3">
    <!-- 顶条：返回 + 号码/卖方 + 状态 -->
    <div class="panel flex flex-wrap items-center gap-3 p-3">
      <button class="btn-secondary" @click="closeTabToLedger">
        <span class="i-lucide-arrow-left mr-1 text-13px" aria-hidden="true" />返回台账
      </button>
      <div class="flex items-baseline gap-2">
        <span class="font-mono text-15px font-800">{{ invoice.invoiceNumber || '—' }}</span>
        <span class="text-12px text-ink-soft">{{ invoice.seller }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="docChip" :class="docChip.cls">{{ docChip.label }}</span>
        <span v-if="isArchived" class="chip-ok">已在台账</span>
      </div>
    </div>

    <div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <!-- 左：原图 -->
      <div class="panel min-h-[420px] flex flex-col overflow-hidden">
        <div class="border-b border-line bg-surface-2 px-3 py-2 text-12px font-700 text-ink-soft">
          发票原件 · {{ invoice.fileName || '无扫描件' }}
        </div>
        <div class="grid flex-1 place-items-center bg-surface-sink p-6">
          <div class="w-full max-w-[560px]">
            <InvoicePreviewSvg :invoice="invoice" />
          </div>
        </div>
      </div>

      <!-- 右：字段（本地缓冲）+ 明细 + 动作 -->
      <div class="panel flex flex-col gap-3 p-4">
        <h2 class="text-15px font-800">
          发票字段
        </h2>

        <!-- 归属（与校对表单一致：项目 / 个人开支） -->
        <div class="flex items-center gap-2">
          <span class="text-12px font-600 text-ink-soft">归属</span>
          <div class="inline-flex overflow-hidden border border-line rounded-[6px]">
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

        <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div v-for="d in FIELDS" :key="d.key" :class="d.full ? 'col-span-2' : ''">
            <label class="field-label">{{ d.label }}</label>
            <select
              v-if="d.type === 'select'"
              v-model="form[d.key]"
              class="field-input w-full"
            >
              <option v-for="o in d.options" :key="o" :value="o">
                {{ o }}
              </option>
            </select>
            <template v-else-if="d.projectList">
              <input
                v-model="form[d.key]"
                class="field-input w-full"
                list="edit-project-options"
                placeholder="从项目主数据选择…"
                :disabled="ownerKind === 'personal'"
              >
              <datalist id="edit-project-options">
                <option v-for="p in projectStore.list" :key="p.id" :value="p.name" />
              </datalist>
            </template>
            <input
              v-else
              v-model="form[d.key]"
              class="field-input w-full"
              :class="d.mono ? 'font-mono' : ''"
              :type="d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'"
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
          <table v-if="showItems && invoice.items.length" class="mt-2 w-full border-collapse text-12px">
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
          <div v-else-if="showItems" class="mt-2 text-12px text-ink-faint">
            无明细行。
          </div>
        </div>

        <!-- 动作：删除 ｜ 重新识别 + 保存 -->
        <div class="mt-1 flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
          <button class="btn-danger" @click="del">
            <span class="i-lucide-trash-2 mr-1 text-13px" aria-hidden="true" />删除
          </button>
          <div class="flex items-center gap-2">
            <button class="btn-secondary" :disabled="invoice.ocrStatus === 'processing'" @click="rerecognize">
              <span class="i-lucide-refresh-cw mr-1 text-13px" aria-hidden="true" />
              {{ invoice.ocrStatus === 'processing' ? '识别中…' : '重新识别' }}
            </button>
            <button class="btn-accent" @click="save">
              <span class="i-lucide-save mr-1 text-13px" aria-hidden="true" />保存
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
