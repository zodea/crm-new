import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from '~/lib/invoice/central-contract'
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
