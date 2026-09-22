import type { DeliveryAmountSource, DeliveryReviewConfirmations } from '~/lib/delivery/review'
import type { ParsedDeliveryItem } from '~/lib/recognize/delivery-parse'
import type { DeliveryPrintDisposition, DeliveryRecordSourceFile } from '~/stores/delivery-record'
import { defineStore } from 'pinia'
import { computed, reactive, readonly, shallowRef } from 'vue'
import { deliveryNaturalKey, deliveryReviewIssues, normalizeDeliveryOrderNo, summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { parseDeliveryMarkdown } from '~/lib/recognize/delivery-parse'
import { recognizeDocument } from '~/lib/recognize/engine'
import { prepareDeliveryOcrImage } from '~/lib/recognize/image-preprocess'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { useOcrSettingsStore } from '~/stores/ocr-settings'

export type DeliveryOcrStatus = 'pending' | 'processing' | 'done' | 'failed'
export type DeliveryIntakeDecision = 'material' | 'non-material' | 'pending'
export type DeliveryQualityFlag = 'normal' | 'low-quality' | 'handwritten' | 'unreadable'
export type DeliveryDocType = '送货单' | '销售单' | '出货单' | '收据' | '协议' | '付款申请' | ''

const NON_MATERIAL_DOC_TYPES = new Set<DeliveryDocType>(['收据', '协议', '付款申请'])
const NON_MATERIAL_FILE_HINTS: Array<[RegExp, string]> = [
  [/付款申请|付款单|报销|借款/, '文件名疑似付款/报销材料'],
  [/协议|合同/, '文件名疑似协议/合同'],
  [/收据|凭证|发票|对账单|结算/, '文件名疑似收据/凭证/结算材料'],
  [/工资|考勤/, '文件名疑似工资/考勤材料'],
]

export interface DeliveryItem {
  id: string
  name: string
  spec: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount: number | null
  amountSource: DeliveryAmountSource
  note: string
}

export interface DeliveryDoc {
  id: string
  supplierText: string
  deliveryDate: string
  orderNo: string
  siteText: string
  docType: DeliveryDocType
  items: DeliveryItem[]
  statedTotal: number | null
  calculatedTotal: number
  balanced: boolean
  note: string
  quality: DeliveryQualityFlag
}

export interface DeliveryFile {
  dataOrigin?: 'real' | 'demo'
  id: string
  name: string
  kind: 'pdf' | 'image'
  size: number
  supplierText: string
  docs: DeliveryDoc[]
  ocrStatus: DeliveryOcrStatus
  ocrError: string
  rawText: string
  engine: string
  model: string
  preprocessed: boolean
  sourceHash: string
  intakeDecision: DeliveryIntakeDecision
  intakeReason: string
  printBatchId: string
  archivedRecordIds: readonly string[]
  printDisposition: DeliveryPrintDisposition | null
}

export interface DeliveryDuplicate {
  dataOrigin?: 'real' | 'demo'
  id: string
  name: string
  kind: DeliveryFile['kind']
  size: number
  sourceHash: string
  representativeFileId: string
  representativeName: string
  archivedRecordIds: readonly string[]
  orderNo: string
  supplierText: string
  siteText: string
  reviewStatus: 'pending' | 'reviewed'
}

export interface DeliveryUploadResult {
  ids: string[]
  acceptedFiles: File[]
  duplicates: DeliveryDuplicate[]
}

interface DeliveryDuplicateRepresentative {
  id: string
  name: string
  archivedRecordIds: readonly string[]
  orderNo: string
  supplierText: string
  siteText: string
}

export interface DeliveryReviewInput {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  siteText: string
  docType: DeliveryDocType
  note: string
  items: DeliveryItem[]
  confirmations: DeliveryReviewConfirmations
}

function editableNumber(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : value
}

function itemFromParsed(item: ParsedDeliveryItem): DeliveryItem {
  const qty = editableNumber(item.quantity)
  const unitPrice = editableNumber(item.unitPrice)
  const calculatedAmount = qty != null && unitPrice != null ? round2(qty * unitPrice) : null
  return {
    id: generateId('ditem'),
    name: item.name,
    spec: item.spec,
    unit: item.unit,
    qty,
    unitPrice,
    amount: editableNumber(item.total) ?? calculatedAmount,
    amountSource: item.total == null ? 'calculated' : 'ocr',
    note: item.note,
  }
}

function fileKind(fileName: string): DeliveryFile['kind'] {
  return /\.pdf$/i.test(fileName) ? 'pdf' : 'image'
}

async function fileHash(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  // 仅用于不支持 Web Crypto 的开发宿主；正常浏览器和 Tauri 均走 SHA-256。
  const view = new Uint8Array(bytes)
  let hash = 2166136261
  for (const byte of view)
    hash = Math.imul(hash ^ byte, 16777619)
  return `fallback-${view.byteLength}-${(hash >>> 0).toString(16)}`
}

function nonMaterialHint(fileName: string): string {
  return NON_MATERIAL_FILE_HINTS.find(([pattern]) => pattern.test(fileName))?.[1] ?? ''
}

function qualityOf(fileName: string, note: string, items: readonly DeliveryItem[]): DeliveryQualityFlag {
  if (/手写/.test(fileName) || /手写/.test(note))
    return 'handwritten'
  if (/无法提取有效字段/.test(note))
    return 'unreadable'
  if (/低置信|待复核/.test(note) || items.some(item => /低置信|待复核/.test(item.note)))
    return 'low-quality'
  return 'normal'
}

export const useDeliveryStore = defineStore('delivery', () => {
  const ocrSettingsStore = useOcrSettingsStore()
  const archiveScope = useDeliveryRecordStore()
  const files = shallowRef<DeliveryFile[]>([])
  const duplicates = shallowRef<DeliveryDuplicate[]>([])
  const visibleFiles = computed(() => files.value.filter(file => archiveScope.mode !== 'central' || file.dataOrigin === archiveScope.origin))
  const visibleDuplicates = computed(() => duplicates.value.filter(file => archiveScope.mode !== 'central' || file.dataOrigin === archiveScope.origin))
  const recognitionProgress = reactive<Record<string, number>>({})
  const sourceFiles = new Map<string, File>()
  const duplicateSourceFiles = new Map<string, File>()

  function byId(id: string): DeliveryFile | undefined {
    return visibleFiles.value.find(file => file.id === id)
  }

  function replaceFile(id: string, patch: Partial<DeliveryFile>) {
    files.value = files.value.map(file => file.id === id ? { ...file, ...patch } : file)
  }

  async function uploadFilesDetailed(uploadedFiles: File[]): Promise<DeliveryUploadResult> {
    const origin = archiveScope.origin
    const assertOrigin = () => {
      if (origin !== archiveScope.origin)
        throw new DOMException('送货来源已变化，请在当前来源重新选择文件', 'AbortError')
    }
    const ids: string[] = []
    const acceptedFiles: File[] = []
    const next: DeliveryFile[] = []
    const skipped: DeliveryDuplicate[] = []
    const uploadedSources = new Map<string, File>()
    const duplicateSources = new Map<string, File>()
    const existingHashes = new Set(visibleFiles.value.map(file => file.sourceHash).filter(Boolean))
    const representatives = new Map<string, DeliveryDuplicateRepresentative>(
      visibleFiles.value
        .filter(file => file.sourceHash)
        .map(file => [file.sourceHash, {
          id: file.id,
          name: file.name,
          archivedRecordIds: file.archivedRecordIds,
          orderNo: file.docs[0]?.orderNo ?? '',
          supplierText: file.docs[0]?.supplierText || file.supplierText,
          siteText: file.docs[0]?.siteText ?? '',
        }]),
    )

    // 页面刷新后识别队列只恢复待打印记录；这里补查归档库原件，避免已打印归档
    // 的原件再次进入主处理队列。原件正文只在上传时读取并计算一次哈希。
    const recordStore = useDeliveryRecordStore()
    try {
      await recordStore.load()
      assertOrigin()
      for (const record of recordStore.list) {
        if (!record.hasSourceFile)
          continue
        const source = await recordStore.loadSourceFile(record.id)
        assertOrigin()
        if (!source)
          continue
        const sourceBytes = Uint8Array.from(source.bytes)
        const sourceFile = new File([sourceBytes.buffer as ArrayBuffer], source.fileName || record.fileName, {
          type: source.mimeType || 'application/octet-stream',
        })
        const sourceHash = await fileHash(sourceFile)
        assertOrigin()
        if (existingHashes.has(sourceHash))
          continue
        existingHashes.add(sourceHash)
        representatives.set(sourceHash, {
          id: record.id,
          name: record.fileName || source.fileName,
          archivedRecordIds: [record.id],
          orderNo: record.orderNo,
          supplierText: '',
          siteText: record.rawSiteText,
        })
      }
    }
    catch (cause) {
      assertOrigin()
      if (recordStore.mode === 'central')
        throw cause
      // 未接管的本机适配保留会话内上传；中央必须完成当前归档读取。
    }

    for (const file of uploadedFiles) {
      const sourceHash = await fileHash(file)
      assertOrigin()
      if (existingHashes.has(sourceHash)) {
        const representative = representatives.get(sourceHash)
        if (representative) {
          const duplicateId = generateId('ddup')
          const duplicate: DeliveryDuplicate = {
            dataOrigin: origin,
            id: duplicateId,
            name: file.name,
            kind: fileKind(file.name),
            size: file.size,
            sourceHash,
            representativeFileId: representative.id,
            representativeName: representative.name,
            archivedRecordIds: [...representative.archivedRecordIds],
            orderNo: representative.orderNo,
            supplierText: representative.supplierText,
            siteText: representative.siteText,
            reviewStatus: 'pending',
          }
          duplicateSources.set(duplicateId, file)
          skipped.push(duplicate)
        }
        continue
      }
      existingHashes.add(sourceHash)
      const id = generateId('dfile')
      const printBatchId = generateId('delivery_print_batch')
      const intakeReason = nonMaterialHint(file.name)
      uploadedSources.set(id, file)
      ids.push(id)
      acceptedFiles.push(file)
      next.push({
        dataOrigin: origin,
        id,
        name: file.name,
        kind: fileKind(file.name),
        size: file.size,
        supplierText: '',
        docs: [],
        ocrStatus: 'pending',
        ocrError: '',
        rawText: '',
        engine: '',
        model: '',
        preprocessed: false,
        sourceHash,
        intakeDecision: intakeReason ? 'pending' : 'material',
        intakeReason,
        printBatchId,
        archivedRecordIds: [],
        printDisposition: null,
      })
      representatives.set(sourceHash, {
        id,
        name: file.name,
        archivedRecordIds: [],
        orderNo: '',
        supplierText: '',
        siteText: '',
      })
    }
    assertOrigin()
    uploadedSources.forEach((file, id) => sourceFiles.set(id, file))
    duplicateSources.forEach((file, id) => duplicateSourceFiles.set(id, file))
    files.value = [...files.value, ...next]
    if (skipped.length)
      duplicates.value = [...duplicates.value, ...skipped]
    return { ids, acceptedFiles, duplicates: skipped }
  }

  async function uploadFiles(uploadedFiles: File[]): Promise<string[]> {
    return (await uploadFilesDetailed(uploadedFiles)).ids
  }

  function confirmDuplicate(id: string): boolean {
    const duplicate = visibleDuplicates.value.find(item => item.id === id)
    if (!duplicate)
      return false
    duplicates.value = duplicates.value.map(item => item.id === id ? { ...item, reviewStatus: 'reviewed' } : item)
    return true
  }

  async function loadDuplicateFile(id: string): Promise<File | null> {
    if (!visibleDuplicates.value.some(item => item.id === id))
      return null
    return duplicateSourceFiles.get(id) ?? null
  }

  async function loadDuplicateRepresentativeFile(id: string): Promise<File | null> {
    const duplicate = visibleDuplicates.value.find(item => item.id === id)
    if (!duplicate)
      return null
    const representative = byId(duplicate.representativeFileId)
    const recordIds = duplicate.archivedRecordIds.length ? duplicate.archivedRecordIds : representative?.archivedRecordIds ?? []
    if (archiveScope.mode === 'central' && recordIds.length) {
      const origin = archiveScope.origin
      const assertCurrent = () => {
        if (origin !== archiveScope.origin || !visibleDuplicates.value.some(item => item.id === id))
          throw new DOMException('重复文件来源已变化，请重新选择', 'AbortError')
      }
      await archiveScope.load()
      assertCurrent()
      let original: DeliveryRecordSourceFile | null = null
      let assetId: string | null = null
      for (const recordId of recordIds) {
        const record = archiveScope.list.find(item => item.id === recordId && item.dataOrigin === origin)
        if (!record?.assetId || !record.hasSourceFile)
          throw new Error('重复文件对应的归档原件已变化，请重新读取')
        const source = await archiveScope.loadSourceFile(recordId, { assetId: record.assetId })
        assertCurrent()
        if (!source || (original && (assetId !== record.assetId || original.bytes.length !== source.bytes.length || original.bytes.some((byte, index) => byte !== source.bytes[index]))))
          throw new Error('重复文件对应的归档原件已变化，请重新读取')
        original = source
        assetId = record.assetId
      }
      return original ? new File([Uint8Array.from(original.bytes)], original.fileName, { type: original.mimeType }) : null
    }
    const sessionSource = representative ? sourceFiles.get(representative.id) : undefined
    if (sessionSource)
      return sessionSource
    const recordId = duplicate.archivedRecordIds[0] ?? representative?.archivedRecordIds[0]
    if (!recordId)
      return null
    const source = await useDeliveryRecordStore().loadSourceFile(recordId)
    if (!source)
      return null
    return new File([Uint8Array.from(source.bytes)], source.fileName || duplicate.representativeName, {
      type: source.mimeType || 'application/octet-stream',
    })
  }

  function setIntakeDecision(id: string, decision: Exclude<DeliveryIntakeDecision, 'pending'>): boolean {
    const file = byId(id)
    if (!file)
      return false
    replaceFile(id, {
      intakeDecision: decision,
      ocrError: decision === 'material' ? '' : file.ocrError,
    })
    return true
  }

  async function recognizeFile(id: string): Promise<boolean> {
    const current = byId(id)
    if (!current || current.ocrStatus === 'processing')
      return false
    if (current.intakeDecision !== 'material') {
      replaceFile(id, {
        ocrError: '请先人工选择“按材料送货单处理”，非材料文件不会自动 OCR',
      })
      return false
    }
    const source = sourceFiles.get(id)
    if (!source) {
      replaceFile(id, {
        ocrStatus: 'failed',
        ocrError: '原文件已不在当前会话，请重新上传',
      })
      return false
    }

    replaceFile(id, { ocrStatus: 'processing', ocrError: '' })
    recognitionProgress[id] = 0
    try {
      const prepared = await prepareDeliveryOcrImage(source)
      if (!ocrSettingsStore.loaded)
        await ocrSettingsStore.load()
      const result = await recognizeDocument(prepared.file, {
        runtimeOptions: {
          ...ocrSettingsStore.recognitionOptions,
          useDocOrientationClassify: ocrSettingsStore.recognitionOptions.useDocOrientationClassify
            && prepared.useDocOrientationClassify,
        },
        onProgress: (progress) => {
          recognitionProgress[id] = progress
        },
      })
      const parsed = parseDeliveryMarkdown(result.markdownPages)
      const parsedDocs = parsed.docs.length
        ? parsed.docs
        : [{
            supplier: parsed.supplier,
            date: '',
            orderNo: '',
            siteText: '',
            docType: '' as const,
            items: [],
            statedTotal: null,
            calculatedTotal: 0,
            balanced: false,
            note: '无法提取有效字段，已进入人工录入队列',
            headText: parsed.rawText,
          }]
      const docs: DeliveryDoc[] = parsedDocs.map((doc) => {
        const items = doc.items.map(itemFromParsed)
        return {
          id: generateId('ddoc'),
          supplierText: doc.supplier || parsed.supplier,
          deliveryDate: doc.date,
          orderNo: doc.orderNo,
          siteText: doc.siteText,
          docType: doc.docType,
          items,
          statedTotal: doc.statedTotal,
          calculatedTotal: doc.calculatedTotal,
          balanced: doc.balanced,
          note: doc.note,
          quality: qualityOf(source.name, doc.note, items),
        }
      })
      const onlyNonMaterial = docs.length > 0
        && docs.every(doc => NON_MATERIAL_DOC_TYPES.has(doc.docType))
      replaceFile(id, {
        supplierText: parsed.supplier,
        docs,
        ocrStatus: 'done',
        ocrError: '',
        rawText: parsed.rawText,
        engine: result.engine,
        model: result.model,
        preprocessed: prepared.transformed,
        intakeDecision: onlyNonMaterial ? 'pending' : 'material',
        intakeReason: onlyNonMaterial ? 'OCR 判定为收据/协议/付款申请等非材料文件' : current.intakeReason,
      })
      return true
    }
    catch (error) {
      replaceFile(id, {
        ocrStatus: 'failed',
        ocrError: error instanceof Error ? error.message : 'OCR 识别失败，请稍后重试',
      })
      return false
    }
    finally {
      delete recognitionProgress[id]
    }
  }

  async function recognizeMany(ids: string[]): Promise<{ done: number, failed: number }> {
    let done = 0
    for (const id of ids) {
      if (await recognizeFile(id))
        done += 1
    }
    return { done, failed: ids.length - done }
  }

  function removeFile(id: string): boolean {
    if (!byId(id))
      return false
    sourceFiles.delete(id)
    delete recognitionProgress[id]
    files.value = files.value.filter(file => file.id !== id)
    return true
  }

  async function archiveDocument(fileId: string, documentId: string, input: DeliveryReviewInput): Promise<string> {
    const file = byId(fileId)
    const document = file?.docs.find(doc => doc.id === documentId)
    if (!file || !document)
      throw new Error('待核对送货单不存在')
    const orderNo = normalizeDeliveryOrderNo(input.orderNo)
    const normalizedInput = { ...input, orderNo }
    const items = normalizedInput.items
      .map(item => ({ ...item, name: item.name.trim() }))
    const recordStore = useDeliveryRecordStore()
    await recordStore.load()
    const naturalKey = deliveryNaturalKey(normalizedInput)
    const naturalKeyDuplicate = Boolean(
      naturalKey
      && recordStore.list.some(record => deliveryNaturalKey(record) === naturalKey),
    )
    const amountSummary = summarizeDeliveryAmounts(items, document.statedTotal)
    const issues = deliveryReviewIssues(
      {
        ...normalizedInput,
        items,
        statedTotal: document.statedTotal,
        ocrStatus: file.ocrStatus,
        naturalKeyDuplicate,
        currentValuesConfirmed: normalizedInput.confirmations?.humanReviewed === true,
      },
      {
        nonMaterial: file.intakeDecision !== 'material'
          || NON_MATERIAL_DOC_TYPES.has(input.docType),
        requiresAmountReview: amountSummary.mismatchedLineIds.length > 0
          || amountSummary.statedBalanced === false,
        requiresQualityReview: document.quality !== 'normal'
          || items.some(item => /低置信|待复核/.test(item.note)),
      },
    )
    if (issues.length)
      throw new Error(`送货单归档前校验未通过：${issues.join('；')}`)
    const sourceFile = sourceFiles.get(fileId)
    if (!sourceFile)
      throw new Error('原文件已不在当前会话，请重新上传')

    const reviewFlags = [
      document.quality !== 'normal' ? `${document.quality}已人工复核` : '',
      amountSummary.mismatchedLineIds.length || amountSummary.statedBalanced === false
        ? '金额已人工复核'
        : '',
    ].filter(Boolean).join('；')
    const recordId = await recordStore.add({
      projectId: normalizedInput.projectId,
      supplierId: normalizedInput.supplierId,
      orderNo,
      deliveryDate: normalizedInput.deliveryDate,
      rawSiteText: normalizedInput.siteText,
      fileName: file.name,
      printBatchId: file.printBatchId,
      note: normalizedInput.note,
      reviewFlag: reviewFlags,
      confirmations: {
        noOrderNoConfirmed: normalizedInput.confirmations?.noOrderNoConfirmed === true,
        pricePendingConfirmed: normalizedInput.confirmations?.humanReviewed === true,
        amountReviewed: normalizedInput.confirmations?.humanReviewed === true,
      },
      lines: items.map(item => ({
        materialName: item.name,
        spec: item.spec,
        unit: item.unit,
        qty: item.qty,
        unitPrice: item.unitPrice,
        amount: item.amount,
        amountSource: item.amountSource,
        note: item.note,
      })),
    }, sourceFile)

    const remainingDocs = file.docs.filter(doc => doc.id !== documentId)
    const archivedRecordIds = [...file.archivedRecordIds, recordId]
    replaceFile(fileId, {
      docs: remainingDocs,
      archivedRecordIds,
      printDisposition: remainingDocs.length ? null : 'pending',
    })
    return recordId
  }

  const pendingFiles = computed(() => visibleFiles.value.filter(file => file.intakeDecision === 'material'
    && (file.ocrStatus === 'pending' || file.ocrStatus === 'failed')))
  const pendingIntakeFiles = computed(() => visibleFiles.value.filter(file => file.intakeDecision === 'pending'))
  const pendingPrintFiles = computed(() => visibleFiles.value.filter(file => file.printDisposition === 'pending'))
  const stats = computed(() => ({
    total: visibleFiles.value.length,
    pending: visibleFiles.value.filter(file => file.intakeDecision === 'material' && file.ocrStatus === 'pending').length,
    pendingIntake: pendingIntakeFiles.value.length,
    processing: visibleFiles.value.filter(file => file.ocrStatus === 'processing').length,
    done: visibleFiles.value.filter(file => file.ocrStatus === 'done' && file.docs.length > 0).length,
    failed: visibleFiles.value.filter(file => file.ocrStatus === 'failed').length,
    awaitingPrint: pendingPrintFiles.value.length,
  }))

  async function loadPendingPrintQueue(): Promise<void> {
    const recordStore = useDeliveryRecordStore()
    const origin = recordStore.origin
    const central = recordStore.mode === 'central'
    if (central) {
      for (const file of visibleFiles.value) {
        if (!file.docs.length && file.archivedRecordIds.length)
          sourceFiles.delete(file.id)
      }
      files.value = files.value.filter(file => file.dataOrigin !== origin || file.docs.length > 0 || !file.archivedRecordIds.length)
    }
    await recordStore.load()
    if (origin !== recordStore.origin)
      throw new DOMException('送货来源已变化，待打印读取已取消', 'AbortError')
    const representedRecordIds = new Set(visibleFiles.value.flatMap(file => file.archivedRecordIds))
    const groups = new Map<string, typeof recordStore.pendingPrintRecords>()
    for (const record of recordStore.pendingPrintRecords) {
      if (representedRecordIds.has(record.id))
        continue
      const groupKey = central ? JSON.stringify([origin, record.assetId ? 'asset' : 'missing', record.assetId ?? record.id]) : record.printBatchId
      const group = groups.get(groupKey) ?? []
      group.push(record)
      groups.set(groupKey, group)
    }
    const restored: DeliveryFile[] = [...groups.entries()].map(([printBatchId, records]) => {
      const record = records[0]!
      return {
        dataOrigin: origin,
        id: `print:${printBatchId}`,
        name: record.fileName || `送货单 ${record.orderNo || record.id}`,
        kind: fileKind(record.fileName),
        size: 0,
        supplierText: '',
        docs: [],
        ocrStatus: 'done',
        ocrError: '',
        rawText: '',
        engine: '',
        model: '',
        preprocessed: false,
        sourceHash: '',
        intakeDecision: 'material',
        intakeReason: '',
        printBatchId: record.printBatchId,
        archivedRecordIds: records.map(item => item.id),
        printDisposition: 'pending',
      }
    })
    if (restored.length)
      files.value = [...files.value, ...restored]
  }

  async function loadFileForPrint(fileId: string, options?: { signal?: AbortSignal }): Promise<File> {
    const file = byId(fileId)
    if (!file || file.printDisposition !== 'pending')
      throw new Error('待打印送货单不存在')
    const recordStore = useDeliveryRecordStore()
    if (recordStore.mode === 'central') {
      const origin = recordStore.origin
      const assertActive = () => {
        if (origin !== recordStore.origin || options?.signal?.aborted)
          throw new DOMException('送货来源已变化或原件读取已取消', 'AbortError')
      }
      assertActive()
      await recordStore.load()
      assertActive()
      let original: DeliveryRecordSourceFile | null = null
      let assetId: string | null = null
      for (const id of file.archivedRecordIds) {
        const record = recordStore.list.find(row => row.id === id && row.dataOrigin === origin)
        if (!record || record.printDisposition !== 'pending')
          throw new Error('待打印记录已变化，请重新读取队列')
        if (!record.assetId || !record.hasSourceFile)
          throw new Error('该送货单未保存原件，无法打开打印')
        const source = await recordStore.loadSourceFile(id, { ...options, assetId: record.assetId })
        assertActive()
        if (!source)
          throw new Error('该送货单缺少原件，请重新读取')
        if (original && (assetId !== record.assetId || original.fileName !== source.fileName || original.mimeType !== source.mimeType || original.bytes.length !== source.bytes.length || original.bytes.some((byte, index) => byte !== source.bytes[index])))
          throw new Error('待打印记录的原件已分开或发生冲突，请重新读取队列')
        original = source
        assetId = record.assetId
      }
      if (!original)
        throw new Error('待打印送货单缺少归档原件')
      return new File([Uint8Array.from(original.bytes)], original.fileName, { type: original.mimeType })
    }
    const sessionSource = sourceFiles.get(fileId)
    if (sessionSource)
      return sessionSource
    const recordId = file.archivedRecordIds[0]
    if (!recordId)
      throw new Error('待打印送货单缺少归档记录')
    const source = await useDeliveryRecordStore().loadSourceFile(recordId)
    if (!source)
      throw new Error('该送货单未保存原件，无法打开打印')
    const restored = new File([Uint8Array.from(source.bytes)], source.fileName || file.name, {
      type: source.mimeType || 'application/octet-stream',
    })
    sourceFiles.set(fileId, restored)
    return restored
  }

  async function excludeFileFromPrint(fileId: string): Promise<void> {
    const file = byId(fileId)
    if (!file || file.printDisposition !== 'pending')
      throw new Error('待打印送货单不存在')
    await useDeliveryRecordStore().excludeManyFromPrint(file.archivedRecordIds)
    removeFile(fileId)
  }

  async function confirmFilePrintReceipt(fileId: string): Promise<void> {
    const file = byId(fileId)
    if (!file || file.printDisposition !== 'pending')
      throw new Error('待打印送货单不存在')
    await useDeliveryRecordStore().confirmManyPrintReceipts(file.archivedRecordIds)
    removeFile(fileId)
  }

  function incompleteReasons(file: DeliveryFile): string[] {
    const reasons: string[] = []
    if (file.intakeDecision === 'pending')
      reasons.push(file.intakeReason || '待人工判断是否为材料送货单')
    if (file.intakeDecision === 'non-material')
      reasons.push('非材料/待处理')
    if (file.ocrStatus === 'failed')
      reasons.push('识别失败')
    if (file.ocrStatus === 'done' && !file.supplierText)
      reasons.push('缺 OCR 分供方，归档前必须人工选择或新增')
    if (file.ocrStatus === 'done' && !file.docs.length)
      reasons.push('无可核对单据')
    for (const doc of file.docs) {
      if (!doc.deliveryDate)
        reasons.push('缺日期')
      if (!doc.orderNo && doc.docType !== '收据')
        reasons.push('缺单号')
      if (!doc.items.length)
        reasons.push('0 明细行')
      if (doc.items.some(item => !item.name.trim() || !item.unit.trim() || item.qty == null || item.qty <= 0))
        reasons.push('明细需确认名称、单位和非零数量')
      if (doc.items.some(item => item.unitPrice == null || item.amount == null))
        reasons.push('价格待补录')
      if (doc.quality !== 'normal')
        reasons.push('手写/低质量，待人工核对')
      if (doc.note.includes('金额') || doc.note.includes('合计'))
        reasons.push('金额待复核')
    }
    return [...new Set(reasons)]
  }

  return {
    files: visibleFiles,
    recognitionProgress: readonly(recognitionProgress),
    pendingFiles,
    duplicates: visibleDuplicates,
    pendingIntakeFiles,
    pendingPrintFiles,
    stats,
    byId,
    uploadFiles,
    uploadFilesDetailed,
    confirmDuplicate,
    loadDuplicateFile,
    loadDuplicateRepresentativeFile,
    setIntakeDecision,
    recognizeFile,
    recognizeMany,
    removeFile,
    archiveDocument,
    loadPendingPrintQueue,
    loadFileForPrint,
    excludeFileFromPrint,
    confirmFilePrintReceipt,
    incompleteReasons,
  }
})
