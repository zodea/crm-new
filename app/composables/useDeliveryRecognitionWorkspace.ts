import type { ShallowRef } from 'vue'
import type { DeliveryReviewInput } from '~/stores/delivery'
import { matchProjectText, matchSupplierName } from '~/lib/delivery/match'
import { editDeliveryAmountLine, summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { generateId } from '~/lib/util/id'

type DraftPatch = Partial<Omit<DeliveryReviewInput, 'items'>>
type ItemTextPatch = Partial<Pick<DeliveryReviewInput['items'][number], 'name' | 'spec' | 'unit' | 'note'>>

function normalizedAlias(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function useDeliveryRecognitionWorkspace(pageRef: Readonly<ShallowRef<HTMLElement | null>>) {
  const store = useDeliveryStore()
  const projectStore = useProjectStore()
  const projectAliasStore = useProjectAliasStore()
  const supplierStore = useSupplierStore()
  const { confirm, promise, warning } = useKitUI()

  const selectedFileId = shallowRef<string | null>(null)
  const selectedDocumentId = shallowRef<string | null>(null)
  const reviewDraft = shallowRef<DeliveryReviewInput | null>(null)
  const saving = shallowRef(false)
  const previewFiles = shallowReactive(new Map<string, File>())

  const selectedFile = computed(() => selectedFileId.value ? store.byId(selectedFileId.value) : undefined)
  const selectedDocument = computed(() => selectedFile.value?.docs.find(doc => doc.id === selectedDocumentId.value))
  const selectedPreviewFile = computed(() => selectedFileId.value ? previewFiles.get(selectedFileId.value) : undefined)
  const previewUrl = useObjectUrl(selectedPreviewFile)
  const supplierText = computed(() => selectedDocument.value?.supplierText || selectedFile.value?.supplierText || '')

  const supplierSuggestion = computed(() => matchSupplierName(
    supplierText.value,
    supplierStore.list.map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      aliases: supplier.aliases,
    })),
  ))

  const projectCandidates = computed(() => projectStore.list.map(project => ({
    id: project.id,
    name: project.name,
    aliases: projectAliasStore.list
      .filter(alias => alias.projectId === project.id)
      .map(alias => alias.alias),
  })))
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
  const reviewProgress = computed(() => {
    const draft = reviewDraft.value
    const checks = [
      Boolean(draft?.projectId),
      Boolean(draft?.supplierId),
      Boolean(draft?.deliveryDate),
      Boolean(draft?.orderNo || draft?.docType === '收据'),
      Boolean(draft?.items.some(item => item.name.trim())),
      amountSummary.value.balanced && !draft?.items.some(item => /待复核|低置信/.test(item.note)),
    ]
    return { passed: checks.filter(Boolean).length, total: checks.length }
  })

  function selectFile(id: string) {
    selectedFileId.value = id
    selectedDocumentId.value = store.byId(id)?.docs[0]?.id ?? null
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
      note: document.note,
      items: document.items.map(item => ({ ...item })),
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
    const ids = store.uploadFiles(picked)
    ids.forEach((id, index) => {
      const file = picked[index]
      if (file)
        previewFiles.set(id, file)
    })
    selectFile(ids[0]!)
    await runRecognition(ids, `识别 ${ids.length} 个送货文件`)
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

  async function removeFile(id: string) {
    const file = store.byId(id)
    if (!file)
      return
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
        qty: 0,
        unitPrice: 0,
        amount: 0,
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

  async function rememberSupplierAlias(supplierId: string | null) {
    const raw = supplierText.value.trim()
    const supplier = supplierId ? supplierStore.byId(supplierId) : undefined
    if (!supplier || normalizedAlias(raw).length < 2)
      return
    const variants = [supplier.name, ...supplier.aliases].map(normalizedAlias)
    if (variants.includes(normalizedAlias(raw)))
      return
    await supplierStore.update(supplier.id, {
      ...supplier,
      aliases: [...supplier.aliases, raw],
    })
  }

  async function applySupplierSuggestion() {
    const suggestion = supplierSuggestion.value
    if (!suggestion || !reviewDraft.value)
      return
    patchDraft({ supplierId: suggestion.id })
    if (suggestion.kind !== 'fuzzy')
      return
    try {
      await promise(rememberSupplierAlias(suggestion.id), {
        loading: '正在记忆分供方别名…',
        success: '已采用建议并记为分供方别名',
        error: caught => caught instanceof Error ? caught.message : '分供方别名保存失败',
      })
    }
    catch {
      warning('已采用分供方建议，但别名未能保存')
    }
  }

  async function archiveSelected() {
    const file = selectedFile.value
    const document = selectedDocument.value
    const draft = reviewDraft.value
    if (!file || !document || !draft || saving.value)
      return
    if (!draft.projectId) {
      warning('核对完成前必须选择所属项目')
      return
    }
    const validItems = draft.items
      .map(item => ({ ...item, name: item.name.trim() }))
      .filter(item => item.name)
    if (!validItems.length) {
      warning('至少保留一条材料明细')
      return
    }

    const summary = summarizeDeliveryAmounts(validItems, document.statedTotal)
    const cautions: string[] = []
    if (!draft.supplierId)
      cautions.push('分供方将归到“未区分分供方”')
    if (!draft.deliveryDate)
      cautions.push('缺少送货日期')
    if (!draft.orderNo && draft.docType !== '收据')
      cautions.push('缺少送货单号')
    if (summary.mismatchedLineIds.length)
      cautions.push(`${summary.mismatchedLineIds.length} 行数量×单价与金额不符`)
    if (summary.statedBalanced === false)
      cautions.push('票面合计与当前材料金额合计不符')
    const lowConfidenceRows = validItems.filter(item => /待复核|低置信/.test(item.note)).length
    if (lowConfidenceRows)
      cautions.push(`${lowConfidenceRows} 行含 OCR 低置信字段`)
    if (cautions.length) {
      const ok = await confirm({
        variant: 'simple',
        title: '带提醒完成核对',
        message: `${cautions.map(item => `· ${item}`).join('\n')}\n\n仍要完成核对并自动归档吗？`,
        confirmLabel: '已核对，继续归档',
      })
      if (!ok)
        return
    }

    saving.value = true
    try {
      const input: DeliveryReviewInput = { ...draft, items: validItems }
      await promise((async () => {
        await projectAliasStore.remember(input.projectId, input.siteText)
        await rememberSupplierAlias(input.supplierId)
        return store.archiveDocument(file.id, document.id, input)
      })(), {
        loading: '正在归档送货单…',
        success: '已完成核对并进入归档库',
        error: caught => caught instanceof Error ? caught.message : '送货单归档失败',
      })
      ensureSelection()
    }
    catch {
      // promise toast 已展示具体失败原因；保留当前草稿继续修正。
    }
    finally {
      saving.value = false
    }
  }

  onMounted(() => {
    Promise.all([
      projectStore.load(),
      projectAliasStore.load(),
      supplierStore.load(),
    ])
  })

  return {
    store,
    projectStore,
    supplierStore,
    selectedFileId,
    selectedDocumentId,
    selectedFile,
    selectedDocument,
    previewUrl,
    reviewDraft,
    supplierSuggestion,
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
    patchDraft,
    patchItem,
    editItemAmount,
    addItem,
    removeItem,
    applySupplierSuggestion,
    archiveSelected,
  }
}
