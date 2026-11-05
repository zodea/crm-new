import { expect, it } from 'vitest'
import { createInvoiceMigrationSession } from '../../app/lib/invoice/central-migration'

it('拒绝与所选旧库摘要不一致的回执并保留原命令编号', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const pending = new Map<string, string>()
  const receipt = { commandId: 'command-one', batchId: 'batch-one', sourceSha256: 'b'.repeat(64), invoiceIds: ['invoice-one'], createdAt: '2026-01-01T00:00:00.000Z' }
  const asOf = '2026-01-01T00:00:00.000Z'
  const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities: actor.capabilities }
  const session = createInvoiceMigrationSession({
    identity: actor,
    context: async () => actor,
    commandId: () => receipt.commandId,
    storage: () => ({
      getItem: key => pending.get(key) ?? null,
      setItem: (key, value) => { pending.set(key, value) },
      removeItem: (key) => { pending.delete(key) },
    }),
    fetcher: async (url) => {
      if (url.endsWith('/migration-publish'))
        return receipt
      if (url.endsWith('/migration-resolve'))
        return { outcome: 'applied', result: receipt }
      return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities: actor.capabilities, meta, batches: [{ ...receipt, retiredAt: null }] }
    },
  })
  await expect(session.publish({ sha256: 'a'.repeat(64), payloadBase64: 'AA==' }, { projects: [], suppliers: [], contracts: [] })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(session.pending(null)?.commandId).toBe('command-one')
  await expect(session.recover(null)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(session.pending(null)?.commandId).toBe('command-one')
  receipt.sourceSha256 = 'a'.repeat(64)
  expect(await session.recover(null)).toEqual({ outcome: 'applied', result: receipt })
  expect(session.pending(null)).toBeNull()
})
