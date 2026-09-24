import { compareCanonicalText } from '../migration/core-contract'
import { decodeDeliveryOriginal } from './source-validation'

export interface DeliveryLegacySourceRecord {
  id: string
  printBatchId: string | null
}

export interface DeliveryLegacySourceFile {
  id: string
  recordId: string
  fileName: string
  fileSize: number
  mimeType: string
  payloadBase64: string | null
}

export interface DeliverySourceAsset {
  id: string
  uploadBatchId: string
  originalFileName: string
  fileSize: number
  mimeType: string
  payloadBase64: string
  sha256: string
  legacyFileRefIds: string[]
}

export interface DeliverySourceLink {
  recordId: string
  assetId: string | null
  sourceState: 'available' | 'missing'
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 只从显式旧打印批次和已验证正文重建物理身份；缺源记录不借用相邻原件。 */
export async function mapDeliverySourceAssets(
  records: readonly DeliveryLegacySourceRecord[],
  sources: readonly DeliveryLegacySourceFile[],
): Promise<{ assets: DeliverySourceAsset[], links: DeliverySourceLink[] }> {
  const recordById = new Map(records.map(record => [record.id, record]))
  if (recordById.size !== records.length || records.some(record => !record.id.trim()))
    throw new Error('送货记录身份重复或缺失')
  const sourceByRecord = new Map<string, DeliveryLegacySourceFile>()
  const fileIds = new Set<string>()
  for (const source of sources) {
    if (!recordById.has(source.recordId) || !source.id.trim() || fileIds.has(source.id))
      throw new Error('送货原件归属或身份无效')
    if (sourceByRecord.has(source.recordId))
      throw new Error('逻辑送货记录有多个当前原件，请先对账')
    fileIds.add(source.id)
    sourceByRecord.set(source.recordId, source)
  }
  const assetsByBatch = new Map<string, DeliverySourceAsset>()
  const links: DeliverySourceLink[] = []
  for (const record of [...records].sort((a, b) => compareCanonicalText(a.id, b.id))) {
    const source = sourceByRecord.get(record.id)
    if (!source || source.payloadBase64 === null) {
      links.push({ recordId: record.id, assetId: null, sourceState: 'missing' })
      continue
    }
    const bytes = decodeDeliveryOriginal({ ...source, payloadBase64: source.payloadBase64 })
    const sha256 = await digest(bytes)
    // 旧库没有打印批次时只保留单记录身份，不按文件名或相同字节推断共用。
    const batchKey = JSON.stringify(record.printBatchId ? ['batch', record.printBatchId] : ['record', record.id])
    let asset = assetsByBatch.get(batchKey)
    if (asset && (asset.sha256 !== sha256 || asset.mimeType !== source.mimeType))
      throw new Error('同一送货批次原件冲突，请先对账')
    if (!asset) {
      const encoder = new TextEncoder()
      asset = {
        id: `delivery-asset-${await digest(encoder.encode(JSON.stringify([batchKey, sha256])))}`,
        uploadBatchId: `delivery-upload-${await digest(encoder.encode(batchKey))}`,
        originalFileName: source.fileName,
        fileSize: bytes.byteLength,
        mimeType: source.mimeType,
        payloadBase64: source.payloadBase64,
        sha256,
        legacyFileRefIds: [],
      }
      assetsByBatch.set(batchKey, asset)
    }
    asset.legacyFileRefIds.push(source.id)
    asset.legacyFileRefIds.sort()
    links.push({ recordId: record.id, assetId: asset.id, sourceState: 'available' })
  }
  return { assets: [...assetsByBatch.values()].sort((a, b) => compareCanonicalText(a.id, b.id)), links }
}
