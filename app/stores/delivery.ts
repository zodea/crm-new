import type { ParsedDeliveryItem } from '~/lib/recognize/delivery-parse'
import { defineStore } from 'pinia'
import { computed, readonly, ref, shallowRef } from 'vue'
import { parseDeliveryMarkdown } from '~/lib/recognize/delivery-parse'
import { OcrRecognitionError, recognizeDocument } from '~/lib/recognize/engine'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'
import { useDeliveryRecordStore } from '~/stores/delivery-record'

export type DeliveryOcrStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface DeliveryItem {
  id: string
  name: string
  spec: string
  unit: string
  qty: number
  unitPrice: number
  amount: number
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

function editableNumber(value: number | null, fallback = 0): number {
  return value == null || !Number.isFinite(value) ? fallback : value
}

function itemFromParsed(item: ParsedDeliveryItem): DeliveryItem {
  const qty = editableNumber(item.quantity, item.total != null ? 1 : 0)
  const unitPrice = editableNumber(
    item.unitPrice,
    item.total != null && qty !== 0 ? round2(item.total / qty) : 0,
  )
  return {
    id: generateId('ditem'),
    name: item.name,
    spec: item.spec,
    unit: item.unit,
    qty,
    unitPrice,
    amount: editableNumber(item.total, round2(qty * unitPrice)),
    note: item.note,
  }
}

function fileKind(fileName: string): DeliveryFile['kind'] {
  return /\.pdf$/i.test(fileName) ? 'pdf' : 'image'
}

export const useDeliveryStore = defineStore('delivery', () => {
  const files = shallowRef<DeliveryFile[]>([])
  const recognitionProgress = ref<Record<string, number>>({})
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
    recognitionProgress.value[id] = 0
    try {
      const result = await recognizeDocument(source, {
        onProgress: (progress) => {
          recognitionProgress.value[id] = progress
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
      delete recognitionProgress.value[id]
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
    delete recognitionProgress.value[id]
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
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        note: item.note,
      })),
    })

    const remainingDocs = file.docs.filter(doc => doc.id !== documentId)
    if (remainingDocs.length)
      replaceFile(fileId, { docs: remainingDocs })
    else
      removeFile(fileId)
    return recordId
  }

  const pendingFiles = computed(() => files.value.filter(file => file.ocrStatus === 'pending' || file.ocrStatus === 'failed'))
  const stats = computed(() => ({
    total: files.value.length,
    pending: files.value.filter(file => file.ocrStatus === 'pending').length,
    processing: files.value.filter(file => file.ocrStatus === 'processing').length,
    done: files.value.filter(file => file.ocrStatus === 'done').length,
    failed: files.value.filter(file => file.ocrStatus === 'failed').length,
  }))

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
    stats,
    byId,
    uploadFiles,
    recognizeFile,
    recognizeMany,
    removeFile,
    archiveDocument,
    incompleteReasons,
  }
})
