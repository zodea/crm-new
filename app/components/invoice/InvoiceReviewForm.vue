<script setup lang="ts">
import type { InvoiceRecognitionFieldMark } from '~/lib/invoice/recognition-changes'
import type { ConfidenceTier } from '~/lib/invoice/recognize'
import type { Invoice } from '~/stores/invoice'
import { resolveAttribution } from '~/lib/invoice/batch-pass'
import { confidenceTier } from '~/lib/invoice/recognize'
import { formatMoney } from '~/lib/util/money'
import { invoiceCorrectionPatch } from '~/stores/invoice'

// 字段校对表单（#60 反馈轮 7 定稿）：两列紧凑网格，置信度 = 输入框边框色 + 角标百分比
// （角标/确认按钮放 label 行右侧，不占整行）；绿字段不放确认按钮、仅黄/红出现「✓确认」；
// 黄/红字段被人工修正（编辑值）或点确认后置信度置满变绿。货物明细默认折叠。
// 重新识别草稿期间（draft）：invoice 是草稿值，所有修改只经 edit 交给父级合并进草稿，不写库；
// marks 标出识别前后不同的字段（警示边框 + 图标文字角标 + 读屏原值）。
const props = defineProps<{
  invoice: Invoice
  draft?: boolean
  marks?: Readonly<Record<string, InvoiceRecognitionFieldMark>>
  /** 原图比对可用时：已在原图框出的字段 key（角标读屏说明“原图已框出 / 原图未定位”） */
  locatedKeys?: readonly string[]
}>()

const emit = defineEmits<{
  confirm: []
  archive: []
  discard: []
  rerecognize: []
  edit: [patch: Partial<Invoice>]
  /** 聚焦有识别标记的字段：原图强调对应区域并保持 */
  locate: [key: string]
  /** 悬停有识别标记的字段：临时强调，离开为 null */
  preview: [key: string | null]
}>()

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { warning } = useKitUI()

interface FieldDef {
  key: keyof Invoice & string
  label: string
  type?: 'text' | 'date' | 'number' | 'select'
  mono?: boolean
  full?: boolean
  options?: string[]
  /** 对应项目走 datalist（combobox 取项目主数据） */
  projectList?: boolean
}

// 网格序 = 蓝本 §5.5：单据编号|开票日期 / 购买方|购买方税号 / 供应商|供应商税号 /
// 票据类型|价税合计 / 税额|税率 / 对应项目(full) / 票面备注(full)
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

/** 每字段档位一次求值（computed 缓存）：模板里角标 v-if/角标色/按钮 v-if/按钮色共 5 处引用同一档位。 */
const tiers = computed(() => {
  const map: Record<string, ConfidenceTier | null> = {}
  for (const f of FIELDS)
    map[f.key] = confidenceTier(props.invoice.fieldConfidence[f.key])
  return map
})

const TIER_INPUT: Record<ConfidenceTier, string> = {
  ok: '',
  warn: 'border-warn!',
  danger: 'border-danger!',
}
const TIER_BADGE: Record<ConfidenceTier, string> = {
  ok: 'text-ok-ink',
  warn: 'text-warn-ink',
  danger: 'text-danger-ink',
}

/**
 * 归属解析(#63 归档强制归属):项目须命中项目主数据规范名 / 个人开支直通;
 * null = 对应项目字段标红 + 「归档入账」按钮禁用的判定依据。
 */
const attribution = computed(() =>
  resolveAttribution(props.invoice, name => projectStore.list.find(p => p.name === name)),
)
const isPersonal = computed(() => props.invoice.ownerKind === 'personal')

/** 草稿期间修正只改草稿（同一域规则 invoiceCorrectionPatch），否则即时落库。 */
function correct(field: keyof Invoice & string, value: string | number) {
  if (props.draft) {
    emit('edit', invoiceCorrectionPatch(props.invoice, field, value))
    return
  }
  return store.correctField(props.invoice.id, field, value)
}

function setOwnerKind(kind: 'project' | 'personal') {
  if (props.invoice.ownerKind === kind)
    return
  correct('ownerKind', kind)
}

function markId(f: FieldDef) {
  return `${fieldInputId(f)}-recognition-mark`
}

function inputClass(f: FieldDef): string {
  if (props.marks?.[f.key])
    return 'border-warn! bg-warn-soft!'
  // 缺归属时对应项目标红(#63):归档强制归属的就地提示(选了个人开支则不标)
  if (f.key === 'projectName' && !isPersonal.value && !attribution.value)
    return 'border-danger!'
  const t = tiers.value[f.key]
  return t ? TIER_INPUT[t] : ''
}

/**
 * 修正字段：域规则（修正即变绿、金额铁律 amount=total−tax 派生、round2 舍入）收敛在
 * store.correctField 串行写队列里；组件只做输入解析——数字字段清空/非法时 input type=number
 * 会把 value 报成 ''，Number('')=0 会把价税合计清成 0 还伪装成人工确认过的绿字段，
 * 这类输入不落库：提示并恢复显示。
 */
async function onFieldChange(f: FieldDef, e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement
  const raw = el.value
  if (f.type === 'number') {
    const n = Number(raw)
    if (raw === '' || Number.isNaN(n)) {
      warning(`「${f.label}」需要有效金额，已恢复原值`)
      el.value = String(props.invoice[f.key] ?? '')
      return
    }
    await correct(f.key, n)
    return
  }
  await correct(f.key, raw)
}

/** ✓确认：不改值，仅人工判定该字段无误 → store 置满置信度变绿。 */
async function confirmField(key: string) {
  if (props.draft) {
    emit('edit', { fieldConfidence: { ...props.invoice.fieldConfidence, [key]: 1 } })
    return
  }
  await store.confirmField(props.invoice.id, key)
}

/** 已归档票在工作台只读：重识别会覆写金额破坏 §4.2 台账口径,废弃会移走已计入台账的票。 */
const isArchived = computed(() => props.invoice.accountStatus === 'archived')
/** 重复票排除在确认/归档之外(与文档页「重复已排除」同口径),只留 废弃/重新识别 两条出路。 */
const isDuplicate = computed(() => props.invoice.dupStatus === 'duplicate')

function fieldInputId(field: FieldDef) {
  return `invoice-review-${props.invoice.id}-${field.key}`
}

function onFieldFocus(f: FieldDef) {
  if (props.marks?.[f.key])
    emit('locate', f.key)
}

function onFieldHover(f: FieldDef, hovering: boolean) {
  if (props.marks?.[f.key])
    emit('preview', hovering ? f.key : null)
}

// 货物明细默认折叠
const showItems = shallowRef(false)
</script>

<template>
  <div class="invoice-review-form space-y-3">
    <div class="invoice-review-form__fields grid gap-x-3 gap-y-2.5">
      <div
        v-for="f in FIELDS"
        :key="f.key"
        :class="f.full ? 'invoice-review-form__field--full' : ''"
      >
        <label :for="fieldInputId(f)" class="field-label flex items-center gap-1">
          <span>{{ f.label }}</span>
          <InvoiceRecognitionFieldMark v-if="marks?.[f.key]" :id="markId(f)" :mark="marks[f.key]!" :located="locatedKeys ? locatedKeys.includes(f.key) : undefined" />
          <span class="flex-1" />
          <span
            v-if="tiers[f.key]"
            class="text-11px font-mono leading-none"
            :class="TIER_BADGE[tiers[f.key]!]"
          >{{ Math.round((invoice.fieldConfidence[f.key] ?? 0) * 100) }}%</span>
          <button
            v-if="tiers[f.key] === 'warn' || tiers[f.key] === 'danger'"
            type="button"
            class="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-11px leading-none transition-colors"
            :class="tiers[f.key] === 'warn'
              ? 'border-warn text-warn-ink hover:bg-warn-soft'
              : 'border-danger text-danger-ink hover:bg-danger-soft'"
            :title="`人工确认「${f.label}」识别无误`"
            @click="confirmField(f.key)"
          >
            <span class="i-lucide-check text-11px" />确认
          </button>
        </label>

        <select
          v-if="f.type === 'select'"
          :id="fieldInputId(f)"
          :aria-label="f.label"
          :aria-describedby="marks?.[f.key] ? markId(f) : undefined"
          :value="String(invoice[f.key] ?? '')"
          class="field-input w-full"
          :class="inputClass(f)"
          @change="onFieldChange(f, $event)"
          @focus="onFieldFocus(f)"
          @mouseenter="onFieldHover(f, true)"
          @mouseleave="onFieldHover(f, false)"
        >
          <option v-for="o in f.options" :key="o" :value="o">
            {{ o }}
          </option>
        </select>
        <input
          v-else
          :id="fieldInputId(f)"
          :aria-label="f.label"
          :aria-describedby="marks?.[f.key] ? markId(f) : undefined"
          :value="String(invoice[f.key] ?? '')"
          :type="f.type ?? 'text'"
          :list="f.projectList ? 'review-project-names' : undefined"
          class="field-input w-full"
          :class="[inputClass(f), f.mono ? 'font-mono' : '']"
          :step="f.type === 'number' ? '0.01' : undefined"
          @change="onFieldChange(f, $event)"
          @focus="onFieldFocus(f)"
          @mouseenter="onFieldHover(f, true)"
          @mouseleave="onFieldHover(f, false)"
        >
      </div>
      <datalist id="review-project-names">
        <option v-for="p in projectStore.list" :key="p.id" :value="p.name" />
      </datalist>
    </div>

    <!-- 货物明细（默认折叠，展开后独立滚动，不影响右栏整体滚动） -->
    <div class="border-t border-line pt-2">
      <button
        type="button"
        class="w-full flex items-center gap-1.5 text-12px font-700 text-ink-soft hover:text-ink transition-colors"
        @click="showItems = !showItems"
      >
        <span :class="showItems ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="text-12px" />
        货物明细 · {{ invoice.items.length }} 行
      </button>
      <div v-if="showItems" class="mt-2 max-h-40 overflow-y-auto overflow-x-auto border border-line">
        <table class="w-full text-11px">
          <thead class="sticky top-0 bg-surface-2">
            <tr class="text-left text-ink-faint">
              <th class="px-2 py-1 font-600">
                货物名称
              </th>
              <th class="px-2 py-1 font-600">
                规格
              </th>
              <th class="px-2 py-1 font-600">
                单位
              </th>
              <th class="px-2 py-1 font-600 text-right">
                数量
              </th>
              <th class="px-2 py-1 font-600 text-right">
                单价
              </th>
              <th class="px-2 py-1 font-600 text-right">
                金额
              </th>
              <th class="px-2 py-1 font-600">
                税率
              </th>
              <th class="px-2 py-1 font-600 text-right">
                税额
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in invoice.items" :key="i" class="border-t border-line">
              <td class="px-2 py-1">
                {{ item.name }}
              </td>
              <td class="px-2 py-1">
                {{ item.spec }}
              </td>
              <td class="px-2 py-1">
                {{ item.unit }}
              </td>
              <td class="px-2 py-1 font-mono text-right">
                {{ item.quantity }}
              </td>
              <td class="px-2 py-1 font-mono text-right">
                {{ formatMoney(item.unitPrice) }}
              </td>
              <td class="px-2 py-1 font-mono text-right">
                {{ formatMoney(item.amount) }}
              </td>
              <td class="px-2 py-1 font-mono">
                {{ item.taxRate }}
              </td>
              <td class="px-2 py-1 font-mono text-right">
                {{ formatMoney(item.taxAmount) }}
              </td>
            </tr>
            <tr v-if="!invoice.items.length">
              <td colspan="8" class="px-2 py-2 text-center text-ink-faint">
                无明细行
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- OCR 置信度（整票汇总） -->
    <div v-if="invoice.ocrConfidence != null" class="text-11px text-ink-faint">
      OCR 置信度: {{ (invoice.ocrConfidence * 100).toFixed(1) }}%（仅作参考，判决权在人）
    </div>

    <!-- 归属/归档状态提示：已归档票在工作台只读（不给废弃/重识别/确认入口） -->
    <div v-if="isArchived" class="text-11px text-ok-ink flex items-center gap-1">
      <span class="i-lucide-circle-check text-12px" />
      已归档{{ invoice.ownerKind === 'personal' ? '（个人开支）' : invoice.ownerKind === 'project' ? '（项目）' : '' }}，已计入台账（如需调整请到台账页操作）
    </div>

    <!-- 重复票提示：排除在确认/归档路径之外，与文档页「重复已排除」同口径 -->
    <div v-if="isDuplicate && !isArchived" class="text-11px text-danger-ink flex items-center gap-1">
      <span class="i-lucide-copy-x text-12px" />
      重复票已排除，不可确认/归档——可废弃，或重新识别后按新发票号重判
    </div>

    <!-- 归属(#63 归档强制归属)：项目(对应项目须命中主数据) 或 个人开支 两类出口 -->
    <div v-if="!isArchived && !isDuplicate" class="flex items-center gap-1.5 text-11px">
      <span class="text-ink-soft shrink-0">归属</span>
      <button
        type="button"
        class="chip cursor-pointer transition-colors"
        :class="!isPersonal ? 'chip-brand' : 'bg-surface-3 text-ink-soft'"
        @click="setOwnerKind('project')"
      >
        项目
      </button>
      <button
        type="button"
        class="chip cursor-pointer transition-colors"
        :class="isPersonal ? 'chip-brand' : 'bg-surface-3 text-ink-soft'"
        @click="setOwnerKind('personal')"
      >
        个人开支
      </button>
      <span v-if="!attribution" class="text-danger-ink truncate">
        未归属：填写对应项目（须为已有项目）或选个人开支
      </span>
    </div>

    <!-- 操作条：[废弃]←危险靠左 …… [重新识别][确认/归档入账]；已归档票整条隐藏 -->
    <div v-if="!isArchived" class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line">
      <button class="btn-danger" @click="emit('discard')">
        <span class="i-lucide-trash-2 text-12px mr-1" /> 废弃
      </button>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" @click="emit('rerecognize')">
          <span class="i-lucide-refresh-cw text-12px mr-1" /> 重新识别
        </button>
        <template v-if="!isDuplicate">
          <button
            v-if="invoice.reviewStatus === 'unreviewed'"
            class="btn-accent"
            @click="emit('confirm')"
          >
            <span class="i-lucide-file-check text-12px mr-1" /> 确认
          </button>
          <button
            v-else-if="invoice.accountStatus === 'none'"
            class="btn-accent"
            :disabled="!attribution"
            :title="attribution ? '归档并计入台账' : '缺归属：填写对应项目或选个人开支后方可归档'"
            @click="emit('archive')"
          >
            <span class="i-lucide-archive text-12px mr-1" /> 归档入账
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.invoice-review-form {
  container-type: inline-size;
}

.invoice-review-form__fields {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr));
}

.invoice-review-form__field--full {
  grid-column: 1 / -1;
}
</style>
