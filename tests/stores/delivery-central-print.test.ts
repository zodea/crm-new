import type { DeliveryRecord } from '~/stores/delivery-record'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useDeliveryStore } from '~/stores/delivery'

const runtime = vi.hoisted(() => ({ archive: {} as Record<string, any> }))
vi.mock('~/stores/delivery-record', () => ({ useDeliveryRecordStore: () => runtime.archive }))
vi.mock('~/stores/ocr-settings', () => ({ useOcrSettingsStore: () => ({ loaded: true }) }))

function record(id: string, assetId: string | null = 'asset'): DeliveryRecord {
  return { id, assetId, dataOrigin: 'real', projectId: 'p', supplierId: 's', fileName: '完整原件.pdf', orderNo: id, printBatchId: 'upload', printDisposition: 'pending', hasSourceFile: !!assetId, archived: true, lines: [] } as unknown as DeliveryRecord
}
const bytes = new TextEncoder().encode('%PDF-1.7\ncomplete original\n%%EOF')
const original = { assetId: 'asset', fileName: '完整原件.pdf', mimeType: 'application/pdf', fileSize: bytes.length, sha256: 'hash', bytes }
beforeEach(() => {
  setActivePinia(createPinia())
  runtime.archive = reactive({ origin: 'real', list: [record('a'), record('b')], pendingPrintRecords: [record('a'), record('b')], load: vi.fn().mockResolvedValue(undefined), loadSourceFile: vi.fn().mockResolvedValue(original) })
})

describe('中央送货打印原件', () => {
  it('中央归档无法读取时不伪称已完成去重，也不留下本次上传队列', async () => {
    const store = useDeliveryStore()
    runtime.archive.load.mockRejectedValueOnce(new Error('当前无送货读取权限'))
    await expect(store.uploadFilesDetailed([new File([bytes], '新文件.pdf')])).rejects.toThrow('读取权限')
    expect(store.files).toEqual([])
    expect(store.duplicates).toEqual([])
  })

  it('切换来源后不能通过先前重复文件 ID 取得缓存原件或改变核对状态', async () => {
    const store = useDeliveryStore()
    const result = await store.uploadFilesDetailed([new File([bytes], '重复.pdf', { type: 'application/pdf' })])
    const id = result.duplicates[0]!.id
    expect(await store.loadDuplicateFile(id)).toBeInstanceOf(File)
    runtime.archive.origin = 'demo'
    expect(await store.loadDuplicateFile(id)).toBeNull()
    expect(await store.loadDuplicateRepresentativeFile(id)).toBeNull()
    expect(store.confirmDuplicate(id)).toBe(false)
  })

  it('共用原件每个逻辑 owner 都重验，第二次打开不借第一次缓存绕过撤权', async () => {
    const store = useDeliveryStore()
    await store.loadPendingPrintQueue()
    expect(store.files.filter(file => file.printDisposition === 'pending')).toHaveLength(1)
    const id = store.files.filter(file => file.printDisposition === 'pending')[0]!.id
    expect([...new Uint8Array(await (await store.loadFileForPrint(id)).arrayBuffer())]).toEqual([...bytes])
    expect(runtime.archive.loadSourceFile).toHaveBeenCalledTimes(2)
    runtime.archive.loadSourceFile.mockRejectedValueOnce(new Error('权限已撤销'))
    await expect(store.loadFileForPrint(id)).rejects.toThrow('权限已撤销')
  })

  it('同上传批次引用不同资产或缺原件时分别进入队列，不借相邻原件打印', async () => {
    runtime.archive.pendingPrintRecords = [record('a', 'asset-a'), record('b', 'asset-b'), record('missing', null)]
    runtime.archive.list = runtime.archive.pendingPrintRecords
    const store = useDeliveryStore()
    await store.loadPendingPrintQueue()
    expect(store.files.filter(file => file.printDisposition === 'pending')).toHaveLength(3)
    const missing = store.files.filter(file => file.printDisposition === 'pending').find(file => file.archivedRecordIds.includes('missing'))!
    await expect(store.loadFileForPrint(missing.id)).rejects.toThrow('原件')
  })

  it('刷新移除已排除的队列，来源切换立即隐藏旧事实，迟到正文不得返回', async () => {
    const store = useDeliveryStore()
    await store.loadPendingPrintQueue()
    const id = store.files.filter(file => file.printDisposition === 'pending')[0]!.id
    let finish!: (value: typeof original) => void
    runtime.archive.loadSourceFile.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const opening = store.loadFileForPrint(id)
    await vi.waitFor(() => expect(runtime.archive.loadSourceFile).toHaveBeenCalled())
    runtime.archive.origin = 'demo'
    expect(store.files).toEqual([])
    finish(original)
    await expect(opening).rejects.toThrow('来源')
    runtime.archive.origin = 'real'
    runtime.archive.pendingPrintRecords = []
    await store.loadPendingPrintQueue()
    expect(store.files.filter(file => file.printDisposition === 'pending')).toEqual([])
  })
})
