import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, RECORD_ORIGINAL_VERIFICATION } from '~/lib/invoice/central-contract'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

it('重新识别完成后再次核验身份和权限，撤权时不返回票面候选', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one' }
  const content = 'synthetic'
  const original = new Blob([content], { type: 'application/pdf' })
  let capabilities: string[] = [INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY]
  let finish!: (value: never) => void
  const workspace = createCentralInvoiceWorkspace({
    identity,
    client: { original: async () => original } as never,
    context: async () => ({ ...identity, capabilities }),
    recognizeLocal: () => new Promise((resolve) => {
      finish = resolve
    }),
  })
  const invoice = { id: 'invoice-one', version: '1', original: { id: 'original-one', fileName: 'synthetic.pdf', fileSize: original.size, mimeType: 'application/pdf', sha256: createHash('sha256').update(content).digest('hex') } } as CentralInvoiceRecord
  const result = workspace.prepareRerecognition(invoice)
  await vi.waitFor(() => expect(finish).toBeDefined())
  capabilities = [INVOICE_READ_CAPABILITY]
  finish({ source: 'local', requiresReview: true } as never)
  await expect(result).rejects.toThrow('发票工作区身份或权限已变化')
  expect(workspace.readState.value).toBe('unavailable')
})

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

it('核验只将授权原件的逐页证据送入中央命令，取消后的迟到识别不提交', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one' }
  const sha256 = createHash('sha256').update('synthetic').digest('hex')
  const blob = new Blob(['synthetic'], { type: 'image/png' })
  const invoice = { id: 'invoice-one', version: '2', original: { id: 'original-one', fileName: 'synthetic.png', fileSize: blob.size, mimeType: blob.type, sha256 } } as CentralInvoiceRecord
  const textPages = ['发票号码：26000000000000000011']
  let finish: (() => void) | undefined
  const execute = vi.fn(async () => ({ invoiceId: invoice.id, commandId: 'verification-command', originalId: invoice.original?.id, version: '3', verificationSha256: 'a'.repeat(64) }))
  const storage = new Map<string, string>()
  const workspace = createCentralInvoiceWorkspace({
    identity,
    client: {
      original: async () => blob,
      execute,
      get: async () => ({ record: { ...invoice, version: '3' }, verification: { candidateId: 'verification-command' } }),
    } as never,
    context: async () => ({ ...identity, capabilities: [INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY] }),
    recognizeLocal: file => new Promise((resolve) => {
      expect(file.name).toBe('synthetic.png')
      finish = () => resolve({ source: 'local', requiresReview: true, textPages, unrecognizedPageIndexes: [], fields: { ignored: true } } as never)
    }),
    storage: () => ({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }),
    commandId: () => 'verification-command',
  })
  let current = true
  const discarded = workspace.recordOriginalVerification(invoice, 'local', false, () => current)
  await vi.waitFor(() => expect(finish).toBeDefined())
  current = false
  finish!()
  await expect(discarded).rejects.toThrow('已取消核验')
  expect(execute).not.toHaveBeenCalled()
  finish = undefined
  const result = workspace.recordOriginalVerification(invoice, 'local', false, () => true)
  await vi.waitFor(() => expect(finish).toBeDefined())
  finish!()
  await expect(result).resolves.toMatchObject({ version: '3' })
  expect(execute).toHaveBeenCalledExactlyOnceWith({ ...identity, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'verification-command', action: RECORD_ORIGINAL_VERIFICATION, invoiceId: invoice.id, baseVersion: '2', originalId: 'original-one', originalSha256: sha256, source: 'local', textPages, unrecognizedPageIndexes: [] })
})
