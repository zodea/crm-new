import type { DeliveryRecord } from '../../stores/delivery-record'
import type { DeliveryArchiveExportOptions, DeliveryArchiveSource, DeliveryExportSourceInfo } from '../delivery/export'

export function assertDeliveryExportActive(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('送货原件包导出已取消', 'AbortError')
}

/** 中央记录逐 owner 核验；只有稳定资产身份和完整字节均相同才去重。 */
export async function loadCentralDeliveryExportSources(records: readonly DeliveryRecord[], loadSource: DeliveryArchiveExportOptions['loadSource'], signal?: AbortSignal) {
  const sources = new Map<string, DeliveryArchiveSource>()
  const sourceByRecord = new Map<string, DeliveryExportSourceInfo>()
  const missingRecordIds: string[] = []
  const owners = new Map<string, string[]>()
  for (const record of records) {
    assertDeliveryExportActive(signal)
    const original = await loadSource(record)
    assertDeliveryExportActive(signal)
    if (!record.hasSourceFile || !record.assetId || !original) {
      missingRecordIds.push(record.id)
      sourceByRecord.set(record.id, { fileName: record.fileName || '原件', shared: false, available: false })
      continue
    }
    const key = JSON.stringify([record.dataOrigin, record.assetId])
    const previous = sources.get(key)
    if (previous && (previous.mimeType !== original.mimeType || previous.fileName !== original.fileName || previous.fileSize !== original.fileSize || previous.bytes.length !== original.bytes.length || previous.bytes.some((byte, index) => byte !== original.bytes[index])))
      throw new Error('同一中央送货资产的原件发生冲突，请重新读取并核验')
    if (!previous)
      sources.set(key, { ...original, recordId: record.id, sourceKey: key, shared: false })
    owners.set(key, [...owners.get(key) ?? [], record.id])
  }
  for (const [key, source] of sources) {
    const ids = owners.get(key)!
    source.shared = ids.length > 1
    for (const id of ids)
      sourceByRecord.set(id, { fileName: source.fileName, shared: source.shared, available: true, sourceKey: key })
  }
  return { sources: [...sources.values()], sourceByRecord, missingRecordIds }
}
