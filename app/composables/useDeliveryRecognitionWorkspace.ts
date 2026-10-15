import type { DeepReadonly, ShallowRef } from 'vue'
import type { DeliveryReviewIssue, DeliveryReviewIssueKey } from '~/lib/delivery/review'
import type { DeliveryDoc, DeliveryDuplicate, DeliveryFile, DeliveryReviewInput } from '~/stores/delivery'
import { onActivated, onDeactivated } from 'vue'
import { useDeliveryReferences } from '~/composables/useDeliveryReferences'
import { matchProjectText, matchSupplierName } from '~/lib/delivery/match'
import { deliveryReviewIssueDetails, editDeliveryAmountLine, summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { generateId } from '~/lib/util/id'

type DraftPatch = Partial<Omit<DeliveryReviewInput, 'items'>>
type ItemTextPatch = Partial<Pick<DeliveryReviewInput['items'][number], 'name' | 'spec' | 'unit' | 'note'>>

export interface DeliveryQueueStatus {
  label: string
  cls: string
  tone: 'ok' | 'warn' | 'danger' | 'brand' | 'neutral'
}

export interface DeliveryDuplicatePreview {
  duplicateUrl: string
  duplicateKind: DeliveryFile['kind']
  representativeUrl: string
  representativeKind: DeliveryFile['kind']
}

export function useDeliveryRecognitionWorkspace(pageRef: Readonly<ShallowRef<HTMLElement | null>>) {
  const store = useDeliveryStore()
  const archive = useDeliveryRecordStore()
  const references = useDeliveryReferences()
  const { projects, suppliers, projectCandidates } = references
  const { confirm, promise, warning } = useKitUI()
  const pendingAliases = shallowRef<Array<{ supplierId: string, raw: string, origin: string }>>([])
  const aliasRetry = computed(() => pendingAliases.value.find(item => item.origin === archive.origin) ?? null)
  const aliasSaving = shallowRef(false)
  let active = true
  let scopeGeneration = 0
  let selectionRead: AbortController | null = null
  const printActions = new Set<string>()
  const printDisposers = new Set<() => void>()

  const selectedFileId = shallowRef<string | null>(null)
  const selectedDocumentId = shallowRef<string | null>(null)
  const reviewDraft = shallowRef<DeliveryReviewInput | null>(null)
  const saving = shallowRef(false)
  const previewFiles = shallowReactive(new Map<string, File>())
  const duplicateSelectedId = shallowRef<string | null>(null)
  const duplicateFiles = shallowRef<{ duplicate: File, representative: File, kind: DeliveryFile['kind'] } | null>(null)
  const duplicateUrl = useObjectUrl(() => duplicateFiles.value?.duplicate)
  const representativeUrl = useObjectUrl(() => duplicateFiles.value?.representative)
  const duplicatePreview = computed<DeliveryDuplicatePreview | null>(() => {
    if (!duplicateFiles.value || !duplicateUrl.value || !representativeUrl.value)
      return null
    return {
      duplicateUrl: duplicateUrl.value,
      duplicateKind: duplicateFiles.value.kind,
      representativeUrl: representativeUrl.value,
      representativeKind: /\.pdf$/i.test(duplicateFiles.value.representative.name) ? 'pdf' : 'image',
    }
  })
  const duplicateLoading = shallowRef(false)
  let duplicateSequence = 0

  // Pinia setup stores normally unwrap refs, but keeping this projection tolerant
  // of both forms also makes the queue stable during HMR and persisted-state restore.
  const duplicateList = computed<readonly DeliveryDuplicate[]>(() => {
    const value = store.duplicates as unknown as DeliveryDuplicate[] | { value?: DeliveryDuplicate[] } | undefined
    return Array.isArray(value) ? value : value?.value ?? []
  })

  const selectedFile = computed(() => selectedFileId.value ? store.byId(selectedFileId.value) : undefined)
  const selectedDocument = computed(() => selectedFile.value?.docs.find(doc => doc.id === selectedDocumentId.value))
  const selectedPreviewFile = computed(() => selectedFileId.value ? previewFiles.get(selectedFileId.value) : undefined)
  const previewUrl = useObjectUrl(selectedPreviewFile)
  const supplierText = computed(() => selectedDocument.value?.supplierText || selectedFile.value?.supplierText || '')

  const supplierSuggestion = computed(() => matchSupplierName(
    supplierText.value,
    suppliers.value.map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      aliases: supplier.aliases,
    })),
  ))

  const projectSuggestion = computed(() => {
    const document = selectedDocument.value
    const file = selectedFile.value
    if (!document || !file)
      return null
    return matchProjectText([document.siteText, file.name], projectCandidates.value)
  })

  const amountSummary = computed(() => summarizeDeliveryAmounts(
    reviewDraft.value?.items ?? [],
    selectedDocument.value?.statedTotal ?? null,
  ))
  const reviewIssues = computed<DeliveryReviewIssue[]>(() => {
    const file = selectedFile.value
    const document = selectedDocument.value
    const draft = reviewDraft.value
    if (!file || !document || !draft || file.intakeDecision !== 'material')
      return []
    const amountHasIssue = amountSummary.value.mismatchedLineIds.length > 0
      || amountSummary.value.statedBalanced === false
    const details = deliveryReviewIssueDetails(
      { ...draft, statedTotal: document.statedTotal, confirmations: {
        ...draft.confirmations,
        humanReviewed: true,
        amountReviewed: !amountHasIssue || Boolean(draft.note.trim()),
      } },
      {
        requiresAmountReview: amountHasIssue,
        requiresQualityReview: document.quality !== 'normal'
          || draft.items.some(item => /低置信|待复核/.test(item.note)),
      },
    )
    return details.filter(issue => issue.key !== 'human-reviewed')
  })
  const reviewProgress = computed(() => {
    const total = 6
    const blockingKeys = new Set<DeliveryReviewIssueKey>(['project', 'supplier', 'date', 'order-no', 'items', 'amount'])
    const blockingCount = reviewIssues.value.filter(issue => blockingKeys.has(issue.key)).length
    return { passed: total - Math.min(total, blockingCount), total }
  })
  const canArchive = computed(() => Boolean(
    selectedFile.value
    && selectedDocument.value
    && reviewDraft.value
    && references.canWrite.value
    && reviewIssues.value.every(issue => ['human-reviewed', 'quality'].includes(issue.key)),
  ))

  function policyFor(file: DeepReadonly<DeliveryFile>, document: DeepReadonly<DeliveryDoc>) {
    return {
      requiresAmountReview: summarizeDeliveryAmounts(document.items, document.statedTotal).mismatchedLineIds.length > 0
        || summarizeDeliveryAmounts(document.items, document.statedTotal).statedBalanced === false,
      requiresQualityReview: document.quality !== 'normal'
        || document.items.some(item => /低置信|待复核/.test(item.note)),
      nonMaterial: file.intakeDecision !== 'material',
    }
  }

  function draftForStatus(file: DeepReadonly<DeliveryFile>, document: DeepReadonly<DeliveryDoc>): DeliveryReviewInput {
    const project = matchProjectText([document.siteText, file.name], projectCandidates.value)
    const supplier = matchSupplierName(
      document.supplierText || file.supplierText,
      suppliers.value.map(item => ({ id: item.id, name: item.name, aliases: item.aliases })),
    )
    return {
      projectId: project?.id ?? '',
      supplierId: supplier?.kind === 'exact' ? supplier.id : null,
      orderNo: document.orderNo,
      deliveryDate: document.deliveryDate,
      siteText: document.siteText,
      docType: document.docType,
      note: '',
      items: document.items.map(item => ({ ...item })),
      confirmations: {
        humanReviewed: true,
        amountReviewed: false,
        noOrderNoConfirmed: false,
        qualityReviewed: false,
      },
    }
  }

  const queueStatuses = computed<Readonly<Record<string, DeliveryQueueStatus>>>(() => {
    const result: Record<string, DeliveryQueueStatus> = {}
    for (const file of store.files) {
      if (file.printDisposition === 'pending') {
        result[file.id] = { label: '已归档 · 待打印', cls: 'chip-warn', tone: 'warn' }
        continue
      }
      if (file.intakeDecision !== 'material') {
        result[file.id] = { label: '人工分流', cls: 'chip-danger', tone: 'danger' }
        continue
      }
      if (file.ocrStatus === 'processing') {
        result[file.id] = { label: '识别中', cls: 'chip-brand', tone: 'brand' }
        continue
      }
      if (file.ocrStatus === 'pending') {
        result[file.id] = { label: '待识别', cls: 'chip-brand', tone: 'brand' }
        continue
      }
      if (file.ocrStatus === 'failed') {
        result[file.id] = { label: '识别失败', cls: 'chip-danger', tone: 'danger' }
        continue
      }
      const document = file.docs[0]
      if (!document) {
        result[file.id] = { label: '待复核', cls: 'chip-warn', tone: 'warn' }
        continue
      }
      const isSelected = file.id === selectedFileId.value && document.id === selectedDocumentId.value
      const issues = isSelected
        ? reviewIssues.value
        : deliveryReviewIssueDetails(draftForStatus(file, document), policyFor(file, document))
            .filter(issue => issue.key !== 'human-reviewed')
      result[file.id] = issues.length
        ? { label: '待复核', cls: 'chip-warn', tone: 'warn' }
        : { label: '待人工归档', cls: 'chip-ok', tone: 'ok' }
    }
    return result
  })
  const queueStatusCounts = computed(() => {
    const counts = { archive: 0, review: 0, triage: 0, duplicate: duplicateList.value.length }
    Object.values(queueStatuses.value).forEach((status) => {
      if (status.label === '待人工归档')
        counts.archive += 1
      else if (status.label === '待复核')
        counts.review += 1
      else if (status.label === '人工分流')
        counts.triage += 1
    })
    return counts
  })

  async function selectFile(id: string) {
    selectionRead?.abort()
    selectedFileId.value = id
    selectedDocumentId.value = store.byId(id)?.docs[0]?.id ?? null
    const file = store.byId(id)
    if (file?.printDisposition === 'pending') {
      previewFiles.delete(id)
      const controller = new AbortController()
      selectionRead = controller
      const generation = scopeGeneration
      try {
        const source = await store.loadFileForPrint(id, { signal: controller.signal })
        if (active && !controller.signal.aborted && generation === scopeGeneration)
          previewFiles.set(id, source)
      }
      catch (cause) {
        if (active && !controller.signal.aborted && generation === scopeGeneration)
          warning(cause instanceof Error ? cause.message : '原件读取失败，请重试')
      }
      finally {
        if (selectionRead === controller)
          selectionRead = null
      }
    }
  }

  function selectDocument(id: string) {
    selectedDocumentId.value = id
  }

  function ensureSelection() {
    const currentFile = selectedFileId.value ? store.byId(selectedFileId.value) : undefined
    if (!currentFile) {
      selectedFileId.value = store.files[0]?.id ?? null
      selectedDocumentId.value = store.files[0]?.docs[0]?.id ?? null
      return
    }
    if (!currentFile.docs.some(doc => doc.id === selectedDocumentId.value))
      selectedDocumentId.value = currentFile.docs[0]?.id ?? null
  }

  function initializeDraft() {
    const document = selectedDocument.value
    if (!document) {
      reviewDraft.value = null
      return
    }
    reviewDraft.value = {
      projectId: projectSuggestion.value?.id ?? '',
      supplierId: supplierSuggestion.value?.kind === 'exact' ? supplierSuggestion.value.id : null,
      orderNo: document.orderNo,
      deliveryDate: document.deliveryDate,
      siteText: document.siteText,
      docType: document.docType,
      note: '',
      items: document.items.map(item => ({ ...item })),
      confirmations: {
        humanReviewed: false,
        amountReviewed: false,
        noOrderNoConfirmed: false,
        qualityReviewed: false,
      },
    }
  }

  watch(() => store.files, ensureSelection, { immediate: true })
  watch(() => selectedDocument.value?.id, initializeDraft, { immediate: true })
  watch(projectSuggestion, (suggestion) => {
    if (reviewDraft.value && !reviewDraft.value.projectId && suggestion)
      reviewDraft.value = { ...reviewDraft.value, projectId: suggestion.id }
  })
  watch(supplierSuggestion, (suggestion) => {
    if (reviewDraft.value && !reviewDraft.value.supplierId && suggestion?.kind === 'exact')
      reviewDraft.value = { ...reviewDraft.value, supplierId: suggestion.id }
  })
  watch(() => store.files.map(file => file.id), (liveIds) => {
    const live = new Set(liveIds)
    for (const id of previewFiles.keys()) {
      if (!live.has(id))
        previewFiles.delete(id)
    }
  })

  const { open: openFilePicker, onChange: onFilesPicked } = useFileDialog({
    multiple: true,
    accept: RECOGNIZABLE_FILE_ACCEPT,
    reset: true,
  })
  onFilesPicked(files => handleUpload(files))

  async function runRecognition(ids: string[], label: string) {
    const result = await promise(store.recognizeMany(ids), {
      loading: `${label}…`,
      success: ({ done }) => `已识别 ${done} 个文件`,
      error: caught => caught instanceof Error ? caught.message : '送货单识别失败',
    })
    if (result.failed) {
      const reason = ids.map(id => store.byId(id)?.ocrError).find(Boolean)
      warning(`${result.failed} 个文件未完成识别${reason ? `：${reason}` : ''}`)
    }
  }

  async function handleUpload(files: File[] | FileList | null) {
    const picked = Array.from(files ?? []).filter(file => isRecognizableFile(file.name))
    if (!picked.length) {
      warning('请选择 PDF、PNG、JPG 或 JPEG 文件')
      return
    }
    const result = await store.uploadFilesDetailed(picked)
    result.ids.forEach((id, index) => {
      const file = result.acceptedFiles[index]
      if (file)
        previewFiles.set(id, file)
    })
    if (result.ids[0]) {
      await selectFile(result.ids[0])
      await runRecognition(result.ids, `识别 ${result.ids.length} 个送货文件`)
    }
    if (result.duplicates.length)
      warning(`已跳过 ${result.duplicates.length} 份完全重复文件，可在“重复核查区”查看原件对照`)
  }

  const { isOverDropZone } = useDropZone(pageRef, {
    onDrop: files => handleUpload(files),
  })

  async function recognizeOne(id?: string) {
    const fileId = id ?? selectedFileId.value
    if (!fileId)
      return
    const ok = await promise(store.recognizeFile(fileId), {
      loading: 'PaddleOCR-VL 识别中…',
      success: result => result ? '识别完成，请核对' : '识别未完成',
      error: caught => caught instanceof Error ? caught.message : '识别失败',
    })
    if (!ok)
      warning(store.byId(fileId)?.ocrError || '识别未完成，请稍后重试')
  }

  async function recognizeAll() {
    const ids = store.pendingFiles.map(file => file.id)
    if (!ids.length) {
      warning('没有待识别文件')
      return
    }
    await runRecognition(ids, `批量识别 ${ids.length} 个文件`)
  }

  function classifySelected(decision: 'material' | 'non-material') {
    const id = selectedFileId.value
    if (!id)
      return
    store.setIntakeDecision(id, decision)
    if (decision === 'material')
      warning('已改判为材料送货单，请单独点击“开始 OCR”')
  }

  async function openSupplierForm(initialName: string) {
    const name = initialName.trim()
    await navigateTo({
      path: '/base/supplier/form',
      query: {
        category: '材料供应商',
        ...(name ? { name } : {}),
      },
    })
  }

  function confirmNoOrderNo() {
    if (!reviewDraft.value)
      return
    reviewDraft.value = {
      ...reviewDraft.value,
      confirmations: {
        ...reviewDraft.value.confirmations,
        noOrderNoConfirmed: true,
      },
    }
  }

  function clearDuplicatePreview() {
    duplicateSequence += 1
    duplicateFiles.value = null
    duplicateLoading.value = false
  }

  async function selectDuplicate(id: string) {
    clearDuplicatePreview()
    const sequence = duplicateSequence
    duplicateSelectedId.value = id
    duplicateLoading.value = true
    try {
      const duplicate = duplicateList.value.find(item => item.id === id)
      if (!duplicate)
        return
      const [duplicateFile, representativeFile] = await Promise.all([
        store.loadDuplicateFile(id),
        store.loadDuplicateRepresentativeFile(id),
      ])
      if (sequence !== duplicateSequence || !duplicateFile || !representativeFile)
        return
      duplicateFiles.value = { duplicate: duplicateFile, representative: representativeFile, kind: duplicate.kind }
    }
    catch (cause) {
      if (active && sequence === duplicateSequence)
        warning(cause instanceof Error ? cause.message : '重复原件读取失败，请重新选择')
    }
    finally {
      if (sequence === duplicateSequence)
        duplicateLoading.value = false
    }
  }

  function reviewDuplicate(id: string) {
    store.confirmDuplicate(id)
  }

  async function removeFile(id: string) {
    const file = store.byId(id)
    if (!file)
      return
    if (file.printDisposition === 'pending') {
      warning('待打印文件只能在打印成功或明确排除后移出队列')
      return
    }
    const ok = await confirm({
      variant: 'simple',
      title: '移出识别队列',
      message: `确认移出「${file.name}」？尚未归档的识别结果会丢失。`,
      confirmLabel: '移出',
    })
    if (ok) {
      previewFiles.delete(id)
      store.removeFile(id)
    }
  }

  function patchDraft(patch: DraftPatch) {
    if (reviewDraft.value)
      reviewDraft.value = { ...reviewDraft.value, ...patch }
  }

  function patchItem(index: number, patch: ItemTextPatch) {
    const draft = reviewDraft.value
    const current = draft?.items[index]
    if (!draft || !current)
      return
    const items = draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    reviewDraft.value = { ...draft, items }
  }

  function editItemAmount(index: number, field: 'qty' | 'unitPrice' | 'amount', value: number) {
    const draft = reviewDraft.value
    const current = draft?.items[index]
    if (!draft || !current)
      return
    const items = draft.items.map((item, itemIndex) => itemIndex === index
      ? editDeliveryAmountLine(item, field, value)
      : item)
    reviewDraft.value = { ...draft, items }
  }

  function addItem() {
    const draft = reviewDraft.value
    if (!draft)
      return
    reviewDraft.value = {
      ...draft,
      items: [...draft.items, {
        id: generateId('ditem'),
        name: '',
        spec: '',
        unit: '',
        qty: null,
        unitPrice: null,
        amount: null,
        amountSource: 'calculated',
        note: '',
      }],
    }
  }

  function removeItem(index: number) {
    const draft = reviewDraft.value
    if (draft)
      reviewDraft.value = { ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }
  }

  async function retrySupplierAlias() {
    const pending = aliasRetry.value
    if (!pending || aliasSaving.value || !active || pending.origin !== archive.origin)
      return
    aliasSaving.value = true
    try {
      await references.rememberSupplierAlias(pending.supplierId, pending.raw)
      pendingAliases.value = pendingAliases.value.filter(item => item !== pending)
    }
    catch (cause) {
      if (active && aliasRetry.value === pending)
        warning(`分供方别名尚未保存：${cause instanceof Error ? cause.message : '请稍后重试'}。送货归档结果不受影响。`)
    }
    finally {
      aliasSaving.value = false
    }
  }

  function queueSupplierAlias(supplierId: string, raw: string, origin: string) {
    if (!pendingAliases.value.some(item => item.supplierId === supplierId && item.raw === raw && item.origin === origin))
      pendingAliases.value = [...pendingAliases.value, { supplierId, raw, origin }]
  }

  async function applySupplierSuggestion() {
    const suggestion = supplierSuggestion.value
    if (!suggestion || !reviewDraft.value)
      return
    patchDraft({ supplierId: suggestion.id })
    if (suggestion.kind !== 'fuzzy')
      return
    queueSupplierAlias(suggestion.id, supplierText.value, archive.origin)
    await retrySupplierAlias()
  }

  async function archiveSelected() {
    const file = selectedFile.value
    const document = selectedDocument.value
    const draft = reviewDraft.value
    if (!file || !document || !draft || saving.value || !references.canWrite.value)
      return
    const generation = scopeGeneration
    const aliasText = supplierText.value
    const origin = archive.origin
    const validItems = draft.items.map(item => ({ ...item, name: item.name.trim() }))
    const blockingIssues = reviewIssues.value.filter(issue =>
      !['human-reviewed', 'quality'].includes(issue.key),
    )
    if (blockingIssues.length) {
      warning(`请先处理右侧标记的问题：${blockingIssues.map(issue => issue.label).join('；')}`)
      return
    }

    saving.value = true
    try {
      const qualityNeedsConfirmation = reviewIssues.value.some(issue => issue.key === 'quality')
      const ok = await confirm({
        variant: 'simple',
        title: '确认人工归档',
        message: qualityNeedsConfirmation
          ? '请确认已查看原件，并已人工复核手写、模糊或低置信内容。确认后才会归档。'
          : '请确认已查看原件，并确认右侧 OCR 草稿与原件一致。系统不会自动归档。',
        confirmLabel: '确认人工归档',
        cancelLabel: '继续修改',
      })
      if (!ok || !active || generation !== scopeGeneration || !references.canWrite.value)
        return
      const input: DeliveryReviewInput = {
        ...draft,
        items: validItems,
        confirmations: {
          ...draft.confirmations,
          humanReviewed: true,
          qualityReviewed: true,
          amountReviewed: true,
        },
      }
      await promise(store.archiveDocument(file.id, document.id, input), {
        loading: '正在归档送货单…',
        success: '已完成核对并进入归档库',
        error: caught => caught instanceof Error ? caught.message : '送货单归档失败',
      })
      if (!active || generation !== scopeGeneration)
        return
      // 归档先完成；别名是可独立重试的主数据写入，不宣称与归档原子提交。
      if (input.supplierId) {
        queueSupplierAlias(input.supplierId, aliasText, origin)
        await retrySupplierAlias()
      }
      if (!active || generation !== scopeGeneration)
        return
      ensureSelection()
    }
    catch {
      // promise toast 已展示具体失败原因；保留当前草稿继续修正。
    }
    finally {
      saving.value = false
    }
  }

  async function openPrint(id: string) {
    if (!active || !store.byId(id))
      return
    const generation = scopeGeneration
    const controller = new AbortController()
    let printWindow: Window | null = null
    let printUrl = ''
    const timers: number[] = []
    const dispose = (close = true) => {
      controller.abort()
      timers.forEach(timer => window.clearTimeout(timer))
      if (printUrl) {
        URL.revokeObjectURL(printUrl)
        printUrl = ''
      }
      if (close)
        printWindow?.close()
      printDisposers.delete(dispose)
    }
    try {
      printWindow = window.open('about:blank', '_blank')
      if (!printWindow) {
        warning('浏览器拦截了原件窗口，请允许弹出窗口后重试')
        return
      }
      printWindow.opener = null
      printDisposers.add(dispose)
      const source = await store.loadFileForPrint(id, { signal: controller.signal })
      if (!active || generation !== scopeGeneration || controller.signal.aborted || printWindow.closed) {
        dispose()
        return
      }
      previewFiles.set(id, source)
      printUrl = URL.createObjectURL(source)
      let printRequested = false
      const requestSystemPrint = () => {
        if (printRequested || controller.signal.aborted || !printWindow || printWindow.closed)
          return
        printRequested = true
        try {
          printWindow.focus()
          printWindow.print()
        }
        catch {
          // 某些内置 PDF 查看器不允许脚本调起打印；原件窗口仍保留供用户手动打印。
        }
      }
      printWindow.addEventListener('load', requestSystemPrint, { once: true })
      printWindow.location.href = printUrl
      timers.push(window.setTimeout(requestSystemPrint, 800))
      timers.push(window.setTimeout(dispose, 5 * 60 * 1000, false))
    }
    catch (caught) {
      const report = active && generation === scopeGeneration && !controller.signal.aborted
      dispose()
      if (report)
        warning(caught instanceof Error ? caught.message : '送货单原件打开失败')
    }
  }

  async function confirmPrint(id: string) {
    const file = store.byId(id)
    if (!file || !active || !references.canWrite.value || printActions.has(id))
      return
    const generation = scopeGeneration
    printActions.add(id)
    try {
      const didPrint = await confirm({
        variant: 'simple',
        title: '登记实际打印回执',
        message: `确认打印机已经实际输出「${file.name}」？登记后文件才会移出待打印范围；只打开过预览或取消打印时不要确认。`,
        confirmLabel: '确认已实际打印',
        cancelLabel: '暂不登记',
      })
      if (!didPrint || !active || generation !== scopeGeneration || !references.canWrite.value)
        return
      await promise(store.confirmFilePrintReceipt(id), {
        loading: '正在登记打印回执…',
        success: '已登记打印成功，文件已移出待打印范围',
        error: caught => caught instanceof Error ? caught.message : '打印回执登记失败',
      })
      ensureSelection()
    }
    catch {
      // promise toast 已展示失败原因；保留在待打印范围，避免误判为已打印。
    }
    finally { printActions.delete(id) }
  }

  async function excludePrint(id: string) {
    const file = store.byId(id)
    if (!file || !active || !references.canWrite.value || printActions.has(id))
      return
    const generation = scopeGeneration
    printActions.add(id)
    try {
      const excluded = await confirm({
        variant: 'simple',
        title: '排除打印范围',
        message: `确认本次不打印「${file.name}」？这只会标记为“已排除”，不会冒充已打印。`,
        confirmLabel: '排除打印',
      })
      if (!excluded || !active || generation !== scopeGeneration || !references.canWrite.value)
        return
      await promise(store.excludeFileFromPrint(id), {
        loading: '正在排除打印范围…',
        success: '已排除打印，未记录为已打印',
        error: caught => caught instanceof Error ? caught.message : '排除打印失败',
      })
      ensureSelection()
    }
    catch {
      // promise toast 已展示失败原因；保留当前待打印任务继续处理。
    }
    finally { printActions.delete(id) }
  }

  async function refreshPrintQueue() {
    const generation = scopeGeneration
    try {
      await store.loadPendingPrintQueue()
      if (active && generation === scopeGeneration && selectedFileId.value)
        await selectFile(selectedFileId.value)
    }
    catch (cause) {
      if (active && generation === scopeGeneration)
        warning(cause instanceof Error ? cause.message : '待打印队列读取失败')
    }
  }

  function invalidatePreviews() {
    scopeGeneration++
    selectionRead?.abort()
    printDisposers.forEach(dispose => dispose())
    previewFiles.clear()
    clearDuplicatePreview()
  }

  onMounted(() => {
    void refreshPrintQueue()
  })
  watch(() => archive.origin, () => {
    invalidatePreviews()
    if (active)
      void refreshPrintQueue()
  }, { flush: 'sync' })
  onDeactivated(() => {
    active = false
    invalidatePreviews()
  })
  onActivated(() => {
    const returning = !active
    active = true
    if (returning)
      void refreshPrintQueue()
  })

  watch(() => duplicateList.value.map(item => item.id), (ids) => {
    if (!duplicateSelectedId.value && ids[0]) {
      void selectDuplicate(ids[0])
    }
    else if (duplicateSelectedId.value && !ids.includes(duplicateSelectedId.value)) {
      duplicateSelectedId.value = ids[0] ?? null
      if (ids[0]) {
        void selectDuplicate(ids[0])
      }
      else {
        clearDuplicatePreview()
      }
    }
  }, { immediate: true })

  onScopeDispose(() => {
    active = false
    invalidatePreviews()
  })

  return {
    store,
    projects,
    suppliers,
    referenceError: references.readError,
    referenceLoading: references.loading,
    reloadReferences: references.reload,
    aliasRetry,
    aliasSaving,
    retrySupplierAlias,
    selectedFileId,
    selectedFile,
    selectedDocument,
    previewUrl,
    reviewDraft,
    supplierSuggestion,
    reviewIssues,
    canArchive,
    queueStatuses,
    queueStatusCounts,
    duplicates: duplicateList,
    duplicateSelectedId,
    duplicatePreview,
    duplicateLoading,
    amountSummary,
    reviewProgress,
    saving,
    isOverDropZone,
    openFilePicker,
    selectFile,
    selectDocument,
    recognizeOne,
    recognizeAll,
    removeFile,
    classifySelected,
    openSupplierForm,
    confirmNoOrderNo,
    selectDuplicate,
    reviewDuplicate,
    patchDraft,
    patchItem,
    editItemAmount,
    addItem,
    removeItem,
    applySupplierSuggestion,
    archiveSelected,
    openPrint,
    confirmPrint,
    excludePrint,
  }
}
