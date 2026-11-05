import type { InvoiceCorrectionSaveCommand } from '../../app/lib/invoice/correction-contract'
import { expect, it } from 'vitest'
import { createInvoiceCorrectionHttp } from '../../app/lib/invoice/correction-http'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

it('空更正目录仍须绑定可信身份、权限和两个真实来源版本', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  let actor = structuredClone(identity)
  const asOf = '2026-11-05T00:00:00.000Z'
  const meta = createReadMeta({ session: identity, schemaVersion: 'invoice-correction-read-v1', operation: 'invoice-correction:list', dataOrigin: 'real', asOf, sources: [{ key: 'invoice-corrections', state: 'readable', sourceVersion: 'invoice-corrections:0', asOf }, { key: 'invoices', state: 'readable', sourceVersion: 'invoices:4', asOf }], coverage: 'complete', scope: { invoiceId: 'invoice-one' } })
  let response: unknown = withReadMeta({ dataOrigin: 'real' as const, items: [] }, meta)
  const client = createInvoiceCorrectionHttp({ identity, context: async () => actor, fetcher: async () => response })
  expect(await client.list('invoice-one')).toEqual([])
  response = { ...response as object, meta: { ...meta, sources: [{ ...meta.sources[0]!, sourceVersion: null }, meta.sources[1]] } }
  await expect(client.list('invoice-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  response = withReadMeta({ dataOrigin: 'real' as const, items: [] }, meta)
  actor = { ...identity, capabilities: ['finance-invoice:read'] }
  await expect(client.list('invoice-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
})

it('更正保存回执必须属于原命令并从基准版本递增', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  let result = { commandId: 'command-one', correctionId: 'correction-one', invoiceId: 'invoice-one', version: '2', updatedAt: '2026-11-05T00:00:00.000Z' }
  const client = createInvoiceCorrectionHttp({ identity, context: async () => identity, fetcher: async () => result })
  const command = { action: 'save-draft', commandId: 'command-one', invoiceId: 'invoice-one', correctionId: null, baseCorrectionVersion: null } as InvoiceCorrectionSaveCommand
  await expect(client.save(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  result = { ...result, version: '1' }
  expect(await client.save(command)).toEqual(result)
})
