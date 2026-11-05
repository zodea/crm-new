import { expect, it } from 'vitest'
import { createInvoiceMigrationPreview } from '../../app/lib/invoice/central-migration-preview'

it('预检只接受选中来源的完整结果和未变化的权限', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:import'] }
  const source = { sha256: 'a'.repeat(64), payloadBase64: 'AA==' }
  const preview = { sourceSha256: source.sha256, schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'recorded', ambiguousZeroFields: ['amount'], historicalAllocationCount: 1, originalCount: 1, originalBodyStates: ['embedded'] }], references: [{ table: 'projects', legacyId: 'project-old', label: '旧项目', deleted: false }], orphanLogCount: 0 }
  let reply: unknown = preview
  let revoked = false
  const client = createInvoiceMigrationPreview({ identity: actor, context: async () => revoked ? { ...actor, capabilities: [] } : actor, fetcher: async () => reply })
  expect(await client.source(source)).toEqual(preview)
  reply = { ...preview, sourceSha256: 'b'.repeat(64) }
  await expect(client.source(source)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  reply = { ...preview, invoices: [{ ...preview.invoices[0], originalBodyStates: [] }] }
  await expect(client.source(source)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  reply = { sourceSha256: source.sha256, invoiceCount: 1, missingAllocationIds: ['allocation-one'], orphanLogCount: 0 }
  expect((await client.mappings(source, { projects: [], suppliers: [], contracts: [] })).missingAllocationIds).toEqual(['allocation-one'])
  revoked = true
  await expect(client.source(source)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
})
