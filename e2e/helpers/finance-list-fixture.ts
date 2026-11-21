import type { Page } from '@playwright/test'
import type { FinanceReadScope } from '../../app/lib/finance/central-contract'
import { CENTRAL_FINANCE_KINDS, FINANCE_FAMILIES, FINANCE_READ_SCHEMA } from '../../app/lib/finance/central-contract'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

export async function installFinanceListFixtures(page: Page, writable = false) {
  // The dev service reports the formal finance source as unavailable. Supply a
  // complete synthetic read so the real table and both filter controls mount.
  for (const kind of CENTRAL_FINANCE_KINDS) {
    const session = { workspaceId: 'document-list-fixture', actorId: 'test-reader', capabilities: [`${FINANCE_FAMILIES[kind]}:read`, ...(writable ? [`${FINANCE_FAMILIES[kind]}:write`] : [])] }
    const asOf = '2026-10-05T01:00:00.000Z'
    const row = { id: 'synthetic-list-row', no: 'LIST-419', name: '合成财务单据', projectName: '验收项目', partyName: '验收对象', amount: '0', date: '', status: 'draft', customerId: null, dataOrigin: 'real' }
    for (const operation of ['context', 'list'] as const) {
      const scope: FinanceReadScope = { kind, operation }
      const meta = createReadMeta({
        session,
        schemaVersion: FINANCE_READ_SCHEMA,
        operation: `finance:${operation}`,
        dataOrigin: 'real',
        asOf,
        sources: [{ key: 'finance', state: 'readable', sourceVersion: 'finance-list-fixture', asOf }],
        coverage: 'complete',
        scope,
      })
      await page.route(`**/api/read/finance/${kind}/${operation}`, route => route.fulfill({
        json: withReadMeta({ ...session, dataOrigin: 'real', scope, ...(operation === 'list' ? { items: [row] } : {}) }, meta),
      }))
    }
  }
}
