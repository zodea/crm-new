import type { ProductionStorage } from '../../server/utils/production-storage'
import { expect, it } from 'vitest'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'

it.each([0, 1, 2, 3, 4, 5, 6])('财务读取对发票参与者版本 %i 明确报告可读性', async (version) => {
  const actor = { workspaceId: 'workspace-synthetic', actorId: 'actor-synthetic', capabilities: ['finance-payment-application:read', 'finance-invoice:read', 'project:list:read'] }
  const tx = {
    select: async (sql: string) => {
      if (sql.includes('FROM finance_revision'))
        return [{ revision: 7 }]
      if (sql.includes('FROM production_participants'))
        return [{ domain: 'invoices', schema_version: version }, { domain: 'project', schema_version: 2 }]
      if (sql.includes('FROM sqlite_master'))
        return [{ name: 'invoice_revision' }, { name: 'project_revision' }]
      if (sql.includes('FROM invoice_revision'))
        return [{ revision: 5 }]
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const storage = { identity: actor, withTransaction: async (work: (value: typeof tx) => unknown) => work(tx) } as unknown as ProductionStorage
  const context = await createProductionFinanceService(storage).context('payment_application', () => actor)
  expect(context.meta.sources.find(source => source.key === 'invoices')).toMatchObject(version >= 1 && version <= 5
    ? { state: 'readable', sourceVersion: 'invoices-5' }
    : { state: 'unavailable', sourceVersion: null })
  expect(context.meta.sources.find(source => source.key === 'projects')).toMatchObject({ state: 'unavailable', sourceVersion: null })
})
