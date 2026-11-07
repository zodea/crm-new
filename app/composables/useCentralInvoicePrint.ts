import type { Ref } from 'vue'
import type { CentralInvoicePrintCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import type { InvoicePrintRequest, InvoicePrintViewModel } from '~/lib/invoice/print-layout'
import { computed, nextTick, shallowRef } from 'vue'
import { centralInvoicePrintReason } from '~/lib/invoice/central-print'

type Workspace = ReturnType<typeof createCentralInvoiceWorkspace>

/** 复用中央打印流程；宿主负责来源、路由守卫和运行生命周期。 */
export function useCentralInvoicePrint(options: {
  workspace: () => Workspace
  records: Readonly<Ref<CentralInvoiceRecord[]>>
  busy: Ref<boolean>
  error: Ref<string>
  rootRef: Readonly<Ref<HTMLElement | null>>
  generation: () => number
  active: () => boolean
  run: (operation: () => Promise<void>) => Promise<void>
  canPrepare: () => boolean
  confirmLeave: () => Promise<boolean>
}) {
  const { records, busy, error, rootRef, run } = options
  const printMode = shallowRef(false)
  const printSelectedId = shallowRef<string | null>(null)
  const printSource = shallowRef<CentralInvoiceRecord[]>([])
  const originalFailures = shallowRef<Record<string, string>>({})
  const pendingPrint = shallowRef<InvoicePrintRequest | null>(null)
  const printTargets = shallowRef<CentralInvoicePrintCommand['targets']>([])

  const recoveryPending = shallowRef(false)
  const recoveryReadError = shallowRef(false)
  const printAuthorized = shallowRef(false)

  let focusMedia: MediaQueryList | null = null

  const printSkipped = computed(() => printSource.value.flatMap((record) => {
    const reason = centralInvoicePrintReason(record) ?? originalFailures.value[record.id]
    return reason ? [{ record, reason }] : []
  }))
  const printModels = computed<InvoicePrintViewModel[]>(() => printSource.value.filter(record => !centralInvoicePrintReason(record) && !originalFailures.value[record.id]).map(record => ({
    id: record.id,
    fileName: record.original?.fileName ?? '',
    invoiceNumber: record.fields.invoiceNumber,
    invoiceType: record.fields.invoiceType,
    buyer: record.fields.buyer,
    seller: record.fields.seller,
    remark: record.fields.remark,
    totalAmount: record.fields.totalAmount!,
    printRotation: record.printRotation,
    printCount: record.printCount,
    ocrStatus: record.ocrStatus,
    reviewStatus: record.reviewStatus,
    dupStatus: record.duplicateStatus,
    source: record.sourceKind,
  })))

  function refreshPending() {
    if (options.workspace().readState.value !== 'ready')
      return false
    try {
      const wasUnreadable = recoveryReadError.value
      recoveryPending.value = !!options.workspace().pendingPrint()
      recoveryReadError.value = false
      if (wasUnreadable && error.value === '打印记录存储暂不可核验，请重试核对。')
        error.value = ''
    }
    catch {
      recoveryPending.value = true
      recoveryReadError.value = true
      error.value = '打印记录存储暂不可核验，请重试核对。'
    }
    return !recoveryPending.value
  }
  function clearConfirmationFocus() {
    focusMedia?.removeEventListener('change', onPrintMediaChange)
    focusMedia = null
  }
  function onPrintMediaChange() {
    if (!focusMedia || focusMedia.matches)
      return
    const generation = options.generation()
    clearConfirmationFocus()
    void nextTick(() => {
      if (generation === options.generation())
        focusPrintConfirmation()
    })
  }
  function focusPrintConfirmation() {
    clearConfirmationFocus()
    if (!options.active() || busy.value || !pendingPrint.value || !printMode.value || options.workspace().readState.value !== 'ready')
      return
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null
    if (media?.matches) {
      focusMedia = media
      media.addEventListener('change', onPrintMediaChange)
      if (!media.matches)
        onPrintMediaChange()
      return
    }
    rootRef.value?.querySelector<HTMLButtonElement>('button[aria-label="已打印"]')?.focus()
  }
  async function mayLeave() {
    if (printMode.value && busy.value)
      return false
    if (!pendingPrint.value)
      return true
    return options.confirmLeave()
  }

  function preparePrint(selected: CentralInvoiceRecord[]) {
    if (busy.value || recoveryPending.value || !options.canPrepare() || !selected.length || options.workspace().readState.value !== 'ready')
      return
    printSource.value = selected.map(record => ({ ...record, fields: { ...record.fields }, items: record.items.map(item => ({ ...item })) }))
    originalFailures.value = {}
    printSelectedId.value = selected.find(record => !centralInvoicePrintReason(record))?.id ?? null
    pendingPrint.value = null
    printTargets.value = []
    printMode.value = true
  }

  async function print(payload: InvoicePrintRequest) {
    if (busy.value || pendingPrint.value || recoveryPending.value || !printMode.value || options.workspace().readState.value !== 'ready')
      return
    if (!refreshPending())
      return
    const sourceWorkspace = options.workspace()
    const generation = options.generation()
    const currentSession = () => options.active() && printMode.value && generation === options.generation() && options.workspace() === sourceWorkspace
    await run(async () => {
      if (!payload.ids.length || new Set(payload.ids).size !== payload.ids.length)
        throw new Error('打印票据身份无效，请重新选择。')
      await sourceWorkspace.load()
      if (!currentSession())
        return
      if (options.workspace().readState.value !== 'ready')
        throw new Error('发票来源尚不可用，请重新读取。')
      const validatedTargets = (): CentralInvoicePrintCommand['targets'] => payload.ids.map((id) => {
        const source = printSource.value.find(record => record.id === id)
        const current = records.value.find(record => record.id === id)
        const rotation = payload.rotations[id]
        if (!source || !current || current.version !== source.version || centralInvoicePrintReason(source) || centralInvoicePrintReason(current) || originalFailures.value[id] || rotation === undefined)
          throw new Error('打印票据已变化或不再满足打印条件，请返回台账重新选择。')
        return { invoiceId: id, baseVersion: source.version, rotation }
      })
      validatedTargets()
      for (const id of payload.ids) {
        const record = records.value.find(item => item.id === id)!
        try {
          await sourceWorkspace.verifiedOriginal(record, true)
        }
        catch {
          if (!currentSession())
            return
          originalFailures.value = { ...originalFailures.value, [id]: '原件读取或核验未完成，请确认访问权限后重试' }
          throw new Error(`发票 ${record.fields.invoiceNumber || record.id} 的原件读取或核验失败，不能打印。`)
        }
        if (!currentSession())
          return
      }
      await sourceWorkspace.load()
      if (!currentSession())
        return
      if (options.workspace().readState.value !== 'ready')
        throw new Error('发票来源尚不可用，请重新读取。')
      const targets = validatedTargets()
      if (!refreshPending())
        return
      printAuthorized.value = true
      await nextTick()
      if (!currentSession() || options.workspace().readState.value !== 'ready') {
        printAuthorized.value = false
        return
      }
      let completed = false
      const afterPrint = () => {
        completed = true
      }
      window.addEventListener('afterprint', afterPrint, { once: true })
      try {
        window.print()
      }
      catch {
        error.value = '系统打印窗口打开失败，请重试。'
        return
      }
      finally {
        printAuthorized.value = false
        window.removeEventListener('afterprint', afterPrint)
      }
      if (!currentSession() || options.workspace().readState.value !== 'ready')
        return
      if (!completed)
        throw new Error('无法确认系统打印窗口是否结束，纸张可能已经输出，请先人工核对后再操作。')
      pendingPrint.value = payload
      printTargets.value = targets
    })
  }
  function retryOriginal(id: string) {
    const next = { ...originalFailures.value }
    delete next[id]
    originalFailures.value = next
    error.value = ''
  }
  async function cancelPrint() {
    clearConfirmationFocus()
    pendingPrint.value = null
    printTargets.value = []
    await nextTick()
    const buttons = rootRef.value?.querySelectorAll<HTMLButtonElement>('button') ?? []
    Array.from(buttons).find(button => button.textContent?.trim() === '打印选中')?.focus()
  }
  async function confirmPrinted() {
    if (!pendingPrint.value || !printTargets.value.length || recoveryPending.value || options.workspace().readState.value !== 'ready')
      return
    const sourceWorkspace = options.workspace()
    const generation = options.generation()
    const submittedPrint = pendingPrint.value
    const submittedTargets = printTargets.value
    const currentSession = () => options.active() && options.workspace() === sourceWorkspace && generation === options.generation()
      && sourceWorkspace.readState.value === 'ready' && printMode.value
      && pendingPrint.value === submittedPrint && printTargets.value === submittedTargets
    await run(async () => {
      await sourceWorkspace.recordPrinted(submittedTargets, () => currentSession() && refreshPending(), currentSession)
      if (!currentSession())
        return
      clearConfirmationFocus()
      pendingPrint.value = null
      printTargets.value = []
    })
    if (currentSession() && recoveryReadError.value)
      error.value = '打印记录存储暂不可核验，请重试核对。'
  }
  async function recoverPrint() {
    await run(async () => {
      const result = await options.workspace().recoverPrint()
      if (result?.outcome === 'applied') {
        pendingPrint.value = null
        printTargets.value = []
      }
    })
  }
  async function leavePrint() {
    if (!await mayLeave())
      return
    clearConfirmationFocus()
    pendingPrint.value = null
    printTargets.value = []
    printMode.value = false
  }

  function resetPrint() {
    clearConfirmationFocus()
    printSource.value = []
    printSelectedId.value = null
    originalFailures.value = {}
    pendingPrint.value = null
    printTargets.value = []
    printAuthorized.value = false
    printMode.value = false
    recoveryPending.value = false
    recoveryReadError.value = false
  }
  return {
    printMode,
    printSelectedId,
    originalFailures,
    pendingPrint,
    recoveryPending,
    recoveryReadError,
    printAuthorized,
    printSkipped,
    printModels,
    refreshPending,
    clearConfirmationFocus,
    focusPrintConfirmation,
    mayLeave,
    preparePrint,
    print,
    retryOriginal,
    cancelPrint,
    confirmPrinted,
    recoverPrint,
    leavePrint,
    resetPrint,
  }
}
