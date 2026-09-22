import type { DeliveryFetcher } from '~/lib/delivery-record/repository'
import { describe, expect, it, vi } from 'vitest'
import { createDeliveryRepository } from '~/lib/delivery-record/repository'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'

const session = { workspaceId: 'w', actorId: 'a', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read'] }
const payloadBase64 = btoa('%PDF-1.7\nPDF repository boundary\n%%EOF')
function setup() {
  let next = 0
  const service = createDeliveryCommandService({ references: () => ({ projects: [{ id: 'p', name: '项目', dataOrigin: 'real' }], suppliers: [{ id: 's', name: '分供方', dataOrigin: 'real' }] }), createId: () => `delivery-${++next}` })
  const saved = service.execute({ action: 'archive', workspaceId: 'w', actorId: 'a', requiredCapability: 'delivery:write', commandId: 'command', baseVersion: null, origin: 'real', uploadBatchId: 'upload', source: { fileName: '完整.pdf', mimeType: 'application/pdf', fileSize: atob(payloadBase64).length, payloadBase64 }, draft: { projectId: 'p', supplierId: 's', orderNo: 'DH', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 2, amount: 2, amountSource: 'calculated', note: '' }] } }, session)
  const record = service.detail(saved.id, session)
  const content = { ...service.fileContent(saved.id, record.assetId!, session), recordId: record.id, projectId: record.projectId, supplierId: record.supplierId, origin: 'real', ownerType: 'delivery_record', sourceVersion: record.version }
  return { service, record, content }
}
describe('送货 HTTP Repository 边界', () => {
  it('校验归属、完整字节和摘要，不让不同owner的同名原件冒充返回', async () => {
    const { record, content } = setup()
    const fetcher = vi.fn().mockResolvedValue(content)
    const repository = createDeliveryRepository(fetcher)
    const query = { id: record.id, assetId: record.assetId!, origin: 'real' as const, projectId: 'p', supplierId: 's' }
    expect((await repository.fileContent(query)).bytes).toEqual(Uint8Array.from(atob(payloadBase64), character => character.charCodeAt(0)))
    for (const patch of [{ recordId: 'other-owner' }, { projectId: 'other-project' }, { origin: 'demo' }, { fileSize: 1 }, { sha256: '0'.repeat(64) }]) {
      fetcher.mockResolvedValue({ ...content, ...patch })
      await expect(repository.fileContent(query)).rejects.toThrow('原件')
    }
  })

  it('取消后到达的正文不生成可应用结果，且把signal交给传输层', async () => {
    const { record, content } = setup()
    let resolve!: (value: unknown) => void
    const fetcher = vi.fn<DeliveryFetcher>(() => new Promise(resolveContent => resolve = resolveContent))
    const repository = createDeliveryRepository(fetcher)
    const controller = new AbortController()
    const pending = repository.fileContent({ id: record.id, assetId: record.assetId!, origin: 'real', projectId: 'p', supplierId: 's' }, { signal: controller.signal })
    controller.abort()
    resolve(content)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ signal: controller.signal })
  })

  it('列表/详情拒绝含正文和错误记录身份的响应，不回退本机', async () => {
    const { record } = setup()
    const fetcher = vi.fn().mockResolvedValue({ ...record, payloadBase64 })
    const repository = createDeliveryRepository(fetcher)
    await expect(repository.detail(record.id, 'real')).rejects.toThrow('响应')
    fetcher.mockResolvedValue({ ...record, id: 'other' })
    await expect(repository.detail(record.id, 'real')).rejects.toThrow('响应')
    fetcher.mockRejectedValue(new Error('offline'))
    await expect(repository.detail(record.id, 'real')).rejects.toThrow('暂时不可用')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
