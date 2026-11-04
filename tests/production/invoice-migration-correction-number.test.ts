import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

it('旧票迁入与普通发票是不同命令族，同号仍各自恢复原回执', async () => {
  const native = await createMigratedMemoryDb()
  let bytes: Uint8Array
  try {
    await native.execute('INSERT INTO invoices(id,source,items) VALUES(\'legacy-invoice\',\'scan\',\'[]\')')
    bytes = native.raw.export()
  }
  finally { native.close() }
  const base = testTempRoot('invoice-command-families')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'family-workspace', ownerId: 'family-owner', purpose: 'verification' })
  const actor = { ...storage.identity, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const session = () => actor
  try {
    const service = createProductionInvoiceService(storage)
    const fields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
    const ordinary = { ...storage.identity, requiredCapability: 'finance-invoice:write', action: 'manual', commandId: 'same-family-number', baseVersion: null, fields, items: [] }
    const ordinaryResult = await service.execute(ordinary, session)
    const migration = createProductionInvoiceMigration(storage)
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const request = { ...storage.identity, commandId: ordinary.commandId, source, mappings: { projects: [], suppliers: [], contracts: [] }, confirmed: true }
    const migrated = await migration.publish(request, session)
    expect(await service.resolve(ordinary.commandId, session)).toEqual({ outcome: 'applied', result: ordinaryResult })
    expect(await migration.resolve({ ...storage.identity, commandId: ordinary.commandId }, session)).toEqual({ outcome: 'applied', result: migrated })
    expect(await service.execute(ordinary, session)).toEqual(ordinaryResult)
    expect(await migration.publish(request, session)).toEqual(migrated)
    expect(migrated.invoiceIds).toEqual(['legacy-invoice'])
  }
  finally { await storage.close() }
})
