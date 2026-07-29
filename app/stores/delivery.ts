import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { ParsedDeliveryItem } from '~/lib/recognize/delivery-parse'
import type { DeliveryPrintDisposition } from '~/stores/delivery-record'
import { defineStore } from 'pinia'
import { computed, reactive, readonly, shallowRef } from 'vue'
import { parseDeliveryMarkdown } from '~/lib/recognize/delivery-parse'
import { OcrRecognitionError, recognizeDocument } from '~/lib/recognize/engine'
import { prepareDeliveryOcrImage } from '~/lib/recognize/image-preprocess'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'
import { useDeliveryRecordStore } from '~/stores/delivery-record'

export type DeliveryOcrStatus = 'pending' | 'processing' | 'done' | 'failed'

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
  docType: '送货单' | '销售单' | '出货单' | '收据' | ''
  items: DeliveryItem[]
  statedTotal: number | null
  calculatedTotal: number
  balanced: boolean
  note: string
}

export interface DeliveryFile {
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
  archivedRecordIds: string[]
  printDisposition: DeliveryPrintDisposition | null
}

export interface DeliveryReviewInput {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  siteText: string
  docType: DeliveryDoc['docType']
  note: string
  items: DeliveryItem[]
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

export const useDeliveryStore = defineStore('delivery', () => {
  const files = shallowRef<DeliveryFile[]>([])
  const recognitionProgress = reactive<Record<string, number>>({})
  const sourceFiles = new Map<string, File>()

  function byId(id: string): DeliveryFile | undefined {
    return files.value.find(file => file.id === id)
  }

  function replaceFile(id: string, patch: Partial<DeliveryFile>) {
    files.value = files.value.map(file => file.id === id ? { ...file, ...patch } : file)
  }

  function uploadFiles(uploadedFiles: File[]): string[] {
    const ids: string[] = []
    const next: DeliveryFile[] = []
    for (const file of uploadedFiles) {
      const id = generateId('dfile')
      sourceFiles.set(id, file)
      ids.push(id)
      next.push({
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
        archivedRecordIds: [],
        printDisposition: null,
      })
    }
    files.value = [...files.value, ...next]
    return ids
  }

  async function recognizeFile(id: string): Promise<boolean> {
    const current = byId(id)
    if (!current || current.ocrStatus === 'processing')
      return false
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
      const result = await recognizeDocument(prepared.file, {
        useDocOrientationClassify: prepared.useDocOrientationClassify,
        onProgress: (progress) => {
          recognitionProgress[id] = progress
        },
      })
      const parsed = parseDeliveryMarkdown(result.markdownPages)
      const usable = parsed.docs.some(doc => doc.items.length
        || doc.orderNo
        || doc.date
        || doc.supplier)
      if (!usable)
        throw new OcrRecognitionError('invalid-result', '未从文件中识别出可用的送货单字段')

      const docs: DeliveryDoc[] = parsed.docs.map(doc => ({
        id: generateId('ddoc'),
        supplierText: doc.supplier || parsed.supplier,
        deliveryDate: doc.date,
        orderNo: doc.orderNo,
        siteText: doc.siteText,
        docType: doc.docType,
        items: doc.items.map(itemFromParsed),
        statedTotal: doc.statedTotal,
        calculatedTotal: doc.calculatedTotal,
        balanced: doc.balanced,
        note: doc.note,
      }))
      replaceFile(id, {
        supplierText: parsed.supplier,
        docs,
        ocrStatus: 'done',
        ocrError: '',
        rawText: parsed.rawText,
        engine: result.engine,
        model: result.model,
        preprocessed: prepared.transformed,
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
    if (!input.projectId)
      throw new Error('核对完成前必须选择项目')

    const items = input.items
      .map(item => ({ ...item, name: item.name.trim() }))
      .filter(item => item.name)
    if (!items.length)
      throw new Error('至少保留一条材料明细')
    const sourceFile = sourceFiles.get(fileId)
    if (!sourceFile)
      throw new Error('原文件已不在当前会话，请重新上传')

    const recordStore = useDeliveryRecordStore()
    const recordId = await recordStore.add({
      projectId: input.projectId,
      supplierId: input.supplierId,
      orderNo: input.orderNo,
      deliveryDate: input.deliveryDate,
      rawSiteText: input.siteText,
      fileName: file.name,
      note: input.note,
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

  const pendingFiles = computed(() => files.value.filter(file => file.ocrStatus === 'pending' || file.ocrStatus === 'failed'))
  const pendingPrintFiles = computed(() => files.value.filter(file => file.printDisposition === 'pending'))
  const stats = computed(() => ({
    total: files.value.length,
    pending: files.value.filter(file => file.ocrStatus === 'pending').length,
    processing: files.value.filter(file => file.ocrStatus === 'processing').length,
    done: files.value.filter(file => file.ocrStatus === 'done' && file.docs.length > 0).length,
    failed: files.value.filter(file => file.ocrStatus === 'failed').length,
    awaitingPrint: pendingPrintFiles.value.length,
  }))

  async function loadPendingPrintQueue(): Promise<void> {
    const recordStore = useDeliveryRecordStore()
    await recordStore.load()
    const representedRecordIds = new Set(files.value.flatMap(file => file.archivedRecordIds))
    const restored: DeliveryFile[] = recordStore.pendingPrintRecords
      .filter(record => !representedRecordIds.has(record.id))
      .map(record => ({
        id: `print:${record.id}`,
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
        archivedRecordIds: [record.id],
        printDisposition: 'pending',
      }))
    if (restored.length)
      files.value = [...files.value, ...restored]
  }

  async function loadFileForPrint(fileId: string): Promise<File> {
    const file = byId(fileId)
    if (!file || file.printDisposition !== 'pending')
      throw new Error('待打印送货单不存在')
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
    if (file.ocrStatus === 'failed')
      reasons.push('识别失败')
    if (file.ocrStatus === 'done' && !file.supplierText)
      reasons.push('缺分供方')
    if (file.ocrStatus === 'done' && !file.docs.length)
      reasons.push('无可核对单据')
    for (const doc of file.docs) {
      if (!doc.deliveryDate)
        reasons.push('缺日期')
      if (!doc.orderNo && doc.docType !== '收据')
        reasons.push('缺单号')
      if (!doc.items.length)
        reasons.push('0 明细行')
      if (doc.note)
        reasons.push('金额待复核')
    }
    return [...new Set(reasons)]
  }

  return {
    files: readonly(files),
    recognitionProgress: readonly(recognitionProgress),
    pendingFiles,
    pendingPrintFiles,
    stats,
    byId,
    uploadFiles,
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
