<script setup lang="ts">
import type { InvoicePrintRequest, InvoicePrintViewModel, PrintPerPage, PrintRotation } from '~/lib/invoice/print-layout'
import InvoicePreviewSvg from '~/components/invoice/InvoicePreviewSvg.vue'
import { buildPrintLayout, normalizePrintRotation, rotatePrintItems } from '~/lib/invoice/print-layout'
import { yuan } from '~/lib/util/money'

const props = withDefaults(defineProps<{
  invoices: readonly InvoicePrintViewModel[]
  printConfirmation: InvoicePrintRequest | null
  /** 台账入口使用双栏模式；工作台默认只显示排版面板。 */
  fullPage?: boolean
}>(), {
  fullPage: false,
})

const emit = defineEmits<{
  print: [payload: InvoicePrintRequest]
  confirmPrint: []
  cancelPrint: []
  back: []
}>()

const selectedInvoiceId = defineModel<string | null>('selectedId', { required: true })
const perPage = shallowRef<PrintPerPage>(2)
const currentPage = shallowRef(1)
const selectedIds = shallowRef(new Set<string>())
const rotations = shallowRef<Record<string, PrintRotation>>({})
const knownIds = new Set<string>()
const contextMenu = shallowRef<{ id: string, x: number, y: number } | null>(null)
const contextMenuRef = useTemplateRef<HTMLElement>('contextMenuRef')
const contextMenuTrigger = shallowRef<HTMLElement | null>(null)
const showZoom = shallowRef(false)

watch(() => props.invoices, (invoices) => {
  const currentIds = new Set(invoices.map(invoice => invoice.id))
  const nextSelected = new Set([...selectedIds.value].filter(id => currentIds.has(id)))
  const nextRotations = { ...rotations.value }
  for (const invoice of invoices) {
    if (!knownIds.has(invoice.id)) {
      nextSelected.add(invoice.id)
      nextRotations[invoice.id] = normalizePrintRotation(invoice.printRotation)
    }
    knownIds.add(invoice.id)
  }
  for (const id of [...knownIds]) {
    if (!currentIds.has(id)) {
      knownIds.delete(id)
      delete nextRotations[id]
    }
  }
  selectedIds.value = nextSelected
  rotations.value = nextRotations
}, { immediate: true })

const layout = computed(() => buildPrintLayout(
  props.invoices,
  selectedIds.value,
  perPage.value,
  rotations.value,
))

const previewLayout = computed(() => buildPrintLayout(
  props.invoices,
  new Set(props.invoices.map(invoice => invoice.id)),
  perPage.value,
  rotations.value,
))

watch(() => previewLayout.value.pageCount, (pageCount) => {
  currentPage.value = Math.max(1, Math.min(currentPage.value, pageCount || 1))
})

watch(
  [selectedInvoiceId, perPage, () => props.invoices],
  ([id]) => {
    if (!id)
      return
    const index = props.invoices.findIndex(invoice => invoice.id === id)
    if (index >= 0)
      currentPage.value = Math.floor(index / perPage.value) + 1
  },
  { immediate: true },
)

const currentSlots = computed(() => previewLayout.value.pages[currentPage.value - 1] ?? [])
/** 列表中不能打印的票及原因；打印时会被跳过，须在面板中明确列出。 */
const skippedInvoices = computed(() => previewLayout.value.skipped)
const unprintableReasons = computed(() => new Map(skippedInvoices.value.map(item => [item.invoice.id, item.reason])))
const allSelected = computed({
  get: () => previewLayout.value.selectedCount > 0 && layout.value.selectedCount === previewLayout.value.selectedCount,
  set: (checked: boolean) => {
    selectedIds.value = checked
      ? new Set(props.invoices.map(invoice => invoice.id))
      : new Set()
  },
})
const zoomInvoice = computed(() =>
  props.invoices.find(invoice => invoice.id === selectedInvoiceId.value)
  ?? currentSlots.value[0]?.invoice,
)
const gridClass = computed(() => ({
  1: 'grid-cols-1 grid-rows-1',
  2: 'grid-cols-1 grid-rows-2',
  4: 'grid-cols-2 grid-rows-2',
})[perPage.value])

function toggleInvoice(id: string, checked: boolean) {
  const next = new Set(selectedIds.value)
  if (checked)
    next.add(id)
  else
    next.delete(id)
  selectedIds.value = next
}

async function openContextMenu(event: MouseEvent, id: string) {
  const trigger = event.currentTarget as HTMLElement
  const rect = trigger.getBoundingClientRect()
  selectedInvoiceId.value = id
  contextMenuTrigger.value = trigger
  contextMenu.value = {
    id,
    x: event.clientX || rect.left,
    y: event.clientY || rect.bottom,
  }
  await nextTick()
  contextMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
}

function closeContextMenu(restoreFocus = false) {
  contextMenu.value = null
  if (restoreFocus)
    contextMenuTrigger.value?.focus()
}

function setRotation(id: string, rotation: number) {
  rotations.value = { ...rotations.value, [id]: normalizePrintRotation(rotation) }
  closeContextMenu(true)
}

function rotateCurrentPage() {
  rotations.value = rotatePrintItems(
    rotations.value,
    currentSlots.value.map(slot => slot.invoice.id),
  )
}

function requestPrint() {
  if (!layout.value.selectedCount)
    return
  emit('print', {
    ids: layout.value.pages.flat().map(slot => slot.invoice.id),
    rotations: Object.fromEntries(layout.value.pages.flat().map(slot => [slot.invoice.id, slot.rotation])),
    perPage: perPage.value,
    pageCount: layout.value.pageCount,
    totalAmount: layout.value.totalAmount,
  })
}

useEventListener(() => document, 'click', () => {
  closeContextMenu()
})
</script>

<template>
  <div :class="props.fullPage ? 'grid min-h-[min(760px,calc(100dvh-96px))] grid-cols-1 items-stretch gap-3 lg:grid-cols-[220px_minmax(0,1fr)]' : 'h-full min-w-0 w-full'">
    <aside v-if="props.fullPage" class="panel min-h-0 overflow-hidden flex flex-col" aria-label="待打印发票列表">
      <div class="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
        <strong class="text-12px text-ink">发票列表</strong>
        <span class="text-11px text-ink-faint">{{ props.invoices.length }} 张</span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <div
          v-for="invoice in props.invoices"
          :key="invoice.id"
          role="button"
          tabindex="0"
          class="w-full flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 text-left hover:bg-surface-2"
          :class="selectedInvoiceId === invoice.id ? 'bg-brand-soft' : ''"
          @click="selectedInvoiceId = invoice.id"
          @keydown.enter.self="selectedInvoiceId = invoice.id"
          @keydown.space.self.prevent="selectedInvoiceId = invoice.id"
        >
          <input
            type="checkbox"
            :checked="selectedIds.has(invoice.id) && !unprintableReasons.has(invoice.id)"
            :disabled="unprintableReasons.has(invoice.id)"
            :aria-label="`勾选发票 ${invoice.invoiceNumber || invoice.fileName}`"
            @click.stop
            @change="toggleInvoice(invoice.id, ($event.target as HTMLInputElement).checked)"
          >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-12px text-brand-deep">{{ invoice.invoiceNumber || invoice.fileName || '未编号发票' }}</span>
            <span v-if="unprintableReasons.has(invoice.id)" class="mt-0.5 block text-11px text-warn-ink">{{ unprintableReasons.get(invoice.id) }}</span>
            <span v-else class="mt-0.5 block truncate text-11px text-ink-soft">{{ invoice.seller || '未填写供应商' }}</span>
          </span>
          <span class="shrink-0 font-mono text-11px text-ink">{{ yuan(invoice.totalAmount) }}</span>
        </div>
        <p v-if="!props.invoices.length" class="p-4 text-center text-11px text-ink-faint">
          当前筛选下没有可打印发票。
        </p>
      </div>
    </aside>

    <section class="panel h-full min-w-0 w-full overflow-hidden flex flex-col" aria-label="发票打印排版">
      <div class="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
        <button v-if="props.fullPage && !printConfirmation" type="button" class="btn-ghost px-2 py-1" @click="emit('back')">
          <span class="i-lucide-arrow-left mr-1" aria-hidden="true" />返回台账
        </button>
        <strong class="mr-auto text-12px text-ink">打印排版</strong>
        <button type="button" class="btn-secondary px-2.5 py-1.5" :disabled="!zoomInvoice" @click="showZoom = true">
          <span class="i-lucide-zoom-in mr-1" aria-hidden="true" />放大
        </button>
        <button type="button" class="btn-secondary px-2.5 py-1.5" :disabled="!currentSlots.length" @click="rotateCurrentPage">
          <span class="i-lucide-rotate-cw mr-1" aria-hidden="true" />整页旋转 90°
        </button>
        <label class="inline-flex items-center gap-1.5 text-11px text-ink-soft">
          每页
          <select v-model.number="perPage" aria-label="每页张数" class="field-input h-8 w-20 text-11px">
            <option :value="1">1 张</option>
            <option :value="2">2 张</option>
            <option :value="4">4 张</option>
          </select>
        </label>
      </div>

      <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-11px text-ink-soft">
        <label class="inline-flex items-center gap-1.5">
          <input v-model="allSelected" type="checkbox" aria-label="全选发票" :disabled="!previewLayout.selectedCount">
          全选
        </label>
        <div class="inline-flex items-center gap-2">
          <button type="button" class="btn-ghost px-2 py-1" :disabled="currentPage <= 1" @click="currentPage--">
            上一页
          </button>
          <span>第 {{ previewLayout.pageCount ? currentPage : 0 }} / {{ previewLayout.pageCount }} 页</span>
          <button type="button" class="btn-ghost px-2 py-1" :disabled="currentPage >= previewLayout.pageCount" @click="currentPage++">
            下一页
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto bg-surface-sink p-3">
        <div
          data-testid="invoice-print-preview"
          :data-per-page="perPage"
          class="mx-auto grid gap-2 bg-white p-3 shadow-[var(--shadow-card)]"
          :class="gridClass"
          style="aspect-ratio: 1/1.4142; max-width: 540px"
        >
          <article
            v-for="slot in currentSlots"
            :key="slot.invoice.id"
            :data-print-invoice-id="slot.invoice.id"
            :data-rotation="slot.rotation"
            class="relative min-h-0 min-w-0 overflow-hidden border rounded-[var(--radius-card)] bg-panel p-2 text-left"
            :class="selectedInvoiceId === slot.invoice.id ? 'border-brand ring-2 ring-brand/20' : 'border-line'"
            @contextmenu.prevent="openContextMenu($event, slot.invoice.id)"
          >
            <button
              type="button"
              class="absolute inset-0 z-0"
              :aria-label="`查看发票 ${slot.invoice.invoiceNumber || slot.invoice.fileName}`"
              @click="selectedInvoiceId = slot.invoice.id"
            />
            <input
              type="checkbox"
              class="absolute left-2 top-2 z-10"
              :aria-label="`勾选发票 ${slot.invoice.invoiceNumber || slot.invoice.fileName}`"
              :checked="selectedIds.has(slot.invoice.id)"
              @click.stop
              @change="toggleInvoice(slot.invoice.id, ($event.target as HTMLInputElement).checked)"
            >
            <span class="absolute right-2 top-1.5 z-10 rounded-full bg-surface-3 px-1.5 py-0.5 text-9px text-ink-soft">
              打印 {{ slot.invoice.printCount }} 次
            </span>
            <button
              type="button"
              class="btn-ghost absolute bottom-2 right-2 z-10 h-7 w-7 p-0"
              :aria-label="`发票 ${slot.invoice.invoiceNumber || slot.invoice.fileName} 旋转选项`"
              aria-haspopup="menu"
              @click.stop="openContextMenu($event, slot.invoice.id)"
            >
              <span class="i-lucide-rotate-cw" aria-hidden="true" />
            </button>
            <div class="h-full flex items-center justify-center pt-4 pointer-events-none">
              <div
                class="w-full origin-center transition-transform"
                :style="{ transform: `rotate(${slot.rotation}deg) scale(${slot.rotation % 180 ? 0.7 : 1})` }"
              >
                <InvoicePreviewSvg :invoice="slot.invoice" />
              </div>
            </div>
          </article>
          <div v-if="!currentSlots.length" class="col-span-full flex items-center justify-center text-12px text-ink-faint">
            暂无可打印发票
          </div>
        </div>
      </div>

      <div class="border-t border-line bg-panel px-3 py-2.5">
        <div data-testid="invoice-print-summary" class="mb-2 text-center text-11px font-600 text-ink-soft">
          已勾 {{ layout.selectedCount }} 张 · {{ layout.pageCount }} 页 A4 · 金额合计 {{ yuan(layout.totalAmount) }}
        </div>
        <div
          v-if="skippedInvoices.length"
          data-testid="invoice-print-skipped"
          role="status"
          class="mb-2 border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-2 text-11px text-warn-ink"
        >
          <p class="font-700">
            {{ skippedInvoices.length }} 张发票不会打印：
          </p>
          <ul class="mt-1 max-h-24 overflow-auto">
            <li v-for="item in skippedInvoices" :key="item.invoice.id" class="truncate">
              {{ item.invoice.invoiceNumber || item.invoice.fileName || '未编号发票' }}：{{ item.reason }}
            </li>
          </ul>
        </div>
        <div
          v-if="printConfirmation"
          class="mb-2 border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-3 text-11px text-warn-ink"
          role="dialog"
          aria-label="确认打印结果"
        >
          <p class="font-700">
            系统打印窗口已关闭，确认打印机已经实际输出吗？
          </p>
          <p class="mt-1">
            本次打印：{{ printConfirmation.ids.length }} 张发票 · {{ printConfirmation.pageCount }} 页 A4 · 金额合计 {{ yuan(printConfirmation.totalAmount) }}
          </p>
          <p v-if="skippedInvoices.length" class="mt-1">
            另有 {{ skippedInvoices.length }} 张未打印，见上方清单；确认后只登记本次实际打印的发票。
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" class="btn-primary px-3 py-1.5" aria-label="已打印" @click="emit('confirmPrint')">
              已完成打印
            </button>
            <button type="button" class="btn-ghost px-3 py-1.5" aria-label="取消" @click="emit('cancelPrint')">
              未打印
            </button>
          </div>
        </div>
        <button type="button" class="btn-primary w-full" :disabled="!layout.selectedCount || printConfirmation !== null" @click="requestPrint">
          <span class="i-lucide-printer mr-1" aria-hidden="true" />打印选中
        </button>
      </div>

      <div
        v-if="contextMenu"
        ref="contextMenuRef"
        data-invoice-rotation-menu
        class="fixed z-60 w-32 border border-line rounded-[var(--radius-btn)] bg-panel p-1 shadow-[var(--shadow-float)]"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
        @click.stop
        @keydown.esc.stop="closeContextMenu(true)"
      >
        <button v-for="angle in [90, 180, 270]" :key="angle" type="button" role="menuitem" class="btn-ghost w-full justify-start" @click="setRotation(contextMenu!.id, angle)">
          旋转 {{ angle }}°
        </button>
        <button type="button" role="menuitem" class="btn-ghost w-full justify-start" @click="setRotation(contextMenu.id, 0)">
          重置旋转
        </button>
      </div>

      <Dialog v-model:open="showZoom">
        <DialogContent class="w-[min(900px,92vw)] p-5">
          <DialogHeader>
            <DialogTitle>发票大图预览</DialogTitle>
            <DialogDescription>{{ zoomInvoice?.invoiceNumber || zoomInvoice?.fileName }}</DialogDescription>
          </DialogHeader>
          <div v-if="zoomInvoice" class="max-h-[72vh] overflow-auto bg-surface-sink p-4">
            <div class="mx-auto max-w-3xl bg-white p-4">
              <InvoicePreviewSvg :invoice="zoomInvoice" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <!-- 浏览器打印降级：屏幕隐藏，@media print 时成为真正的 A4 多页输出。 -->
      <div class="invoice-print-output" aria-hidden="true">
        <section
          v-for="(printPage, pageIndex) in layout.pages"
          :key="pageIndex"
          class="invoice-print-sheet grid gap-[4mm] bg-white p-[8mm]"
          :class="gridClass"
        >
          <div
            v-for="slot in printPage"
            :key="slot.invoice.id"
            :data-print-invoice-id="slot.invoice.id"
            :data-rotation="slot.rotation"
            class="min-h-0 min-w-0 overflow-hidden border border-gray-300 p-[3mm]"
          >
            <div class="h-full flex items-center justify-center">
              <div
                class="w-full origin-center"
                :style="{ transform: `rotate(${slot.rotation}deg) scale(${slot.rotation % 180 ? 0.7 : 1})` }"
              >
                <InvoicePreviewSvg :invoice="slot.invoice" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
@page {
  size: A4;
  margin: 0;
}

.invoice-print-output {
  display: none;
}

@media print {
  :global(:where(body:has(.invoice-print-output)) *) {
    visibility: hidden !important;
  }

  :global(.invoice-print-output),
  :global(.invoice-print-output *) {
    visibility: visible !important;
  }

  :global(.invoice-print-output) {
    display: block !important;
    position: absolute;
    inset: 0;
    width: 210mm;
    background: white;
  }

  :global(.invoice-print-sheet) {
    width: 210mm;
    height: 297mm;
    break-after: page;
    page-break-after: always;
  }

  :global(.invoice-print-sheet:last-child) {
    break-after: auto;
    page-break-after: auto;
  }
}
</style>
