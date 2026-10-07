import { expect, it } from 'vitest'
import { readPayrollProjectMigrationGraphs } from '../../app/lib/migration/payroll-source'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createPayrollWorkbookFixture } from '../helpers/payroll-workbook-fixture'

it('工资来源无私密权限时只读原名册引用和明确受限态，原完整JSON和照片保存不变', async () => {
  const f = await createPayrollWorkbookFixture()
  try {
    await f.prepareRoster()
    const sources = await readPayrollProjectMigrationGraphs(f.db)
    const original = String(sources.find(row => row.legacyId === 'p')!.attributes.payrollGraphJson)
    expect(original).toContain('6222000000000001')
    await f.db.execute('INSERT INTO payroll_migration_evidence VALUES (?,?,?,?,?,?)', ['source-private-history', 'p', 'original-private-batch', original, '[]', '[]'])
    let sensitive = false
    const service = createPayrollService({ session: () => ({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', ...(sensitive ? ['worker:sensitive:read'] : [])] }), identities: () => structuredClone(f.source), transaction: work => f.withTransaction(db => work(db, { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })) })
    const publicRead = await service.sources({ origin: 'real', projectId: 'p' })
    const encoded = JSON.stringify(publicRead)
    expect(encoded).not.toContain('6222000000000001')
    expect(encoded).not.toContain('440000199001010001')
    expect(encoded).toContain('privateRosterState')
    expect(encoded).toContain('forbidden')
    expect((await f.db.select<{ source_graph_json: string }>('SELECT source_graph_json FROM payroll_migration_evidence WHERE entity_id=?', ['source-private-history']))[0]!.source_graph_json).toBe(original)
    sensitive = true
    expect(JSON.stringify((await service.sources({ origin: 'real', projectId: 'p' })).evidence)).toContain('6222000000000001')
  }
  finally { await f.close() }
})
