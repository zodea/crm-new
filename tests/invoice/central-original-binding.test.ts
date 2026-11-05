import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const record = { id: 'synthetic-invoice', version: '1', original: { id: 'original-old', fileName: 'source.png', fileSize: 3, mimeType: 'image/png', sha256: sha('old') } } as CentralInvoiceRecord
const candidate = { source: 'local', fields: {}, textPages: [], unrecognizedPageIndexes: [], requiresReview: true }

it('旧记录遇到另一原件时，阻止识别前先核对实际字节', async () => {
  const recognizeLocal = vi.fn().mockResolvedValue(candidate)
  const workspace = createCentralInvoiceWorkspace({ identity: { workspaceId: 'w', actorId: 'a' }, context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }), client: { original: vi.fn().mockResolvedValue(new Blob(['new'])) } as never, recognizeLocal })
  await expect(workspace.prepareRerecognition(record, 'local')).rejects.toThrow('原件')
  expect(recognizeLocal).not.toHaveBeenCalled()
})

it('原件读取期间撤销权限时不进入本机识别', async () => {
  let allowed = true
  const recognizeLocal = vi.fn().mockResolvedValue(candidate)
  const workspace = createCentralInvoiceWorkspace({ identity: { workspaceId: 'w', actorId: 'a' }, context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: allowed ? ['finance-invoice:read', 'finance-invoice:write'] : [] }), client: { original: vi.fn(async () => {
    allowed = false
    return new Blob(['old'])
  }) } as never, recognizeLocal })
  await expect(workspace.prepareRerecognition(record, 'local')).rejects.toThrow('权限')
  expect(recognizeLocal).not.toHaveBeenCalled()
})

it('缺少原件不调用原件服务或本机识别', async () => {
  const original = vi.fn()
  const recognizeLocal = vi.fn()
  const workspace = createCentralInvoiceWorkspace({ identity: { workspaceId: 'w', actorId: 'a' }, context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }), client: { original } as never, recognizeLocal })
  await expect(workspace.prepareRerecognition({ ...record, original: null }, 'local')).rejects.toThrow('没有已保存原件')
  expect(original).not.toHaveBeenCalled()
  expect(recognizeLocal).not.toHaveBeenCalled()
})
