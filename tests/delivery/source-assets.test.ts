import { describe, expect, it } from 'vitest'
import { mapDeliverySourceAssets } from '~/lib/delivery-record/source-assets'

const original = btoa('%PDF-1.7\nimmutable physical original\n%%EOF')
const records = [{ id: 'delivery-1', printBatchId: 'batch-1' }, { id: 'delivery-2', printBatchId: 'batch-1' }]
function source(recordId: string, id = `file-${recordId}`, payloadBase64: string | null = original) {
  return { id, recordId, fileName: '送货原件.pdf', fileSize: atob(payloadBase64 ?? original).length, mimeType: 'application/pdf', payloadBase64 }
}

describe('送货旧原件到不可变中央资产映射', () => {
  it('明确同一物理打印批次且字节一致的两张逻辑记录共享一个资产', async () => {
    const result = await mapDeliverySourceAssets(records, [source('delivery-1'), source('delivery-2')])
    expect(result.assets).toHaveLength(1)
    expect(result.links.map(link => link.assetId)).toEqual([result.assets[0]!.id, result.assets[0]!.id])
    expect(result.assets[0]).toMatchObject({ payloadBase64: original, fileSize: atob(original).length })
    expect(result.assets[0]!.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await mapDeliverySourceAssets([...records].reverse(), [source('delivery-2'), source('delivery-1')])).toEqual(result)
  })

  it('同名但不同批次、不同字节的文件保留独立资产', async () => {
    const result = await mapDeliverySourceAssets([{ ...records[0]! }, { ...records[1]!, printBatchId: 'batch-2' }], [source('delivery-1'), source('delivery-2', 'file-two', btoa('%PDF-1.7\ndifferent original\n%%EOF'))])
    expect(result.assets).toHaveLength(2)
    expect(new Set(result.links.map(link => link.assetId)).size).toBe(2)
  })

  it('缺正文的逻辑记录保持缺失，不借同批次同名文件补齐', async () => {
    const result = await mapDeliverySourceAssets(records, [source('delivery-1'), source('delivery-2', 'missing-file', null)])
    expect(result.links).toContainEqual({ recordId: 'delivery-2', assetId: null, sourceState: 'missing' })
    expect(result.assets).toHaveLength(1)
  })

  it('同一明确物理批次的正文冲突阻止迁移，不按文件名取首条', async () => {
    await expect(mapDeliverySourceAssets(records, [source('delivery-1'), source('delivery-2', 'file-two', btoa('%PDF-1.7\nconflicting original\n%%EOF'))])).rejects.toThrow('批次原件冲突')
  })

  it.each([
    { ...source('delivery-1'), fileSize: 999 },
    { ...source('delivery-1'), payloadBase64: 'not canonical base64' },
    { ...source('delivery-1'), payloadBase64: '', fileSize: 0 },
    { ...source('delivery-1'), fileName: ' ' },
    { ...source('delivery-1'), mimeType: 'text/html' },
    source('delivery-1', 'file-html', btoa('<html>not a PDF</html>')),
    { ...source('delivery-1'), mimeType: 'image/png' },
  ])('正文或长度异常阻止生成资产', async (invalid) => {
    await expect(mapDeliverySourceAssets([records[0]!], [invalid])).rejects.toThrow('原件校验失败')
  })

  it('孤儿来源和同一逻辑记录多原件都需先对账', async () => {
    await expect(mapDeliverySourceAssets(records, [source('other-record')])).rejects.toThrow('原件归属')
    await expect(mapDeliverySourceAssets(records, [source('delivery-1'), source('delivery-1', 'duplicate-ref')])).rejects.toThrow('多个当前原件')
  })
})
