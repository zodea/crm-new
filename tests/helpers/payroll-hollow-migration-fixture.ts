import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource } from '../../server/utils/payroll-service'
import type { TestDb } from './memory-db'
import { loadPayrollMigratedHollow } from '../../server/utils/payroll-migrated-hollow'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollService } from '../../server/utils/payroll-service'
import { loadQuantityHollowFacts } from '../../server/utils/quantity-hollow-facts'
import { loadQuantityHollowMigratedProof } from '../../server/utils/quantity-hollow-migrated-proof'
import { createPayrollHollowFixture } from './payroll-hollow-fixture'
import { cloneQuantityHollowSnapshot, importQuantityHollowFixture } from './quantity-hollow-migration-fixture'

/** 原生库上造出已发放的空鼓 A 类工资（含扣款配置、开工、核算与发放回执）。 */
async function releasePayrollHollowOriginal() {
  const original = await createPayrollHollowFixture()
  try {
    const query = { scope: { projectId: original.draft.projectId, crewId: null, leaderWorkerId: original.draft.leaderWorkerId, formatFamily: 'A' as const, book: original.draft.book! }, month: original.draft.month }
    const config = await original.service.hollowConfig({ origin: 'real' }, query)
    await original.service.executeHollow({ commandId: 'migration-original-hollow-rate', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: original.draft.projectId, target: null, config: query, action: { kind: 'save-hollow-policies', policies: [{ policyId: null, baseRevisionId: null, itemId: original.target.itemId, enabled: true, unitAmount: 30, effectiveMonth: original.draft.month }] } })
    let read = await original.form()
    const saved = await original.service.execute(original.command(read, { kind: 'save-a-draft', draft: original.draft }))
    const statementId = saved.statementId!
    read = await original.service.aForm({ origin: 'real' }, { statementId })
    await original.service.executeHollow(original.startCommand(read.hollow!))
    read = await original.service.aForm({ origin: 'real' }, { statementId })
    await original.service.execute(original.command(read, { kind: 'check-a' }))
    read = await original.service.aForm({ origin: 'real' }, { statementId })
    await original.service.execute(original.command(read, { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: original.draft.leaderWorkerId, amount: 550 }] } }))
    return { original, statementId }
  }
  catch (cause) {
    await original.close()
    throw cause
  }
}
type ReleasedPayrollHollowOriginal = Awaited<ReturnType<typeof releasePayrollHollowOriginal>>

async function importReleasedPayrollHollow({ original, statementId }: ReleasedPayrollHollowOriginal, native: TestDb) {
  const f = await importPayrollHollowFixture(native, original.identities)
  return { ...f, original, statementId: f.id('wage_statements', statementId), originalStatementId: statementId }
}

export async function createReleasedPayrollHollowMigrationFixture() {
  const released = await releasePayrollHollowOriginal()
  try {
    const f = await importReleasedPayrollHollow(released, released.original.db)
    return { ...f, close: async () => {
      await f.close()
      await released.original.close()
    } }
  }
  catch (cause) {
    await released.original.close()
    throw cause
  }
}

/**
 * 原库只造一次（放在 beforeAll）；每次 migrate() 克隆原库字节，再走真实公开 preflight/import/confirm 迁入，
 * 各案例的目标库与来源副本互不共享。案例不得改动 original。
 */
export async function createReleasedPayrollHollowSource() {
  const released = await releasePayrollHollowOriginal()
  const bytes = released.original.db.raw.export()
  return {
    async migrate() {
      const native = await cloneQuantityHollowSnapshot(bytes)
      try {
        const f = await importReleasedPayrollHollow(released, native)
        return { ...f, close: async () => {
          await f.close()
          native.close()
        } }
      }
      catch (cause) {
        native.close()
        throw cause
      }
    },
    close: () => released.original.close(),
  }
}

/** 完整原生 SQL 来自公开检查与工资服务；迁入复用真实 preflight/import/confirm 事务。 */
export async function importPayrollHollowFixture(db: TestDb, identities: PayrollIdentitySource) {
  const quantity = await importQuantityHollowFixture(db)
  try {
    const [evidence] = await quantity.instance.withWorkspaceTransaction(tx => tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [quantity.scope.projectId]))
    if (!evidence)
      throw new Error('迁入没有工资原图证明')
    const mappings: PayrollIdentityMapping[] = JSON.parse(evidence.mapping_json)
    const id = (table: string, original: string) => {
      const value = mappings.find(row => row.tableName === table && row.legacyId === original)?.centralId
      if (!value)
        throw new Error(`迁入缺少 ${table}/${original} 映射`)
      return value
    }
    const mappedIdentities: PayrollIdentitySource = { ...identities, version: 'migrated-hollow-public-fixture', projects: identities.projects.map(row => ({ ...row, id: id('projects', row.id) })), crews: identities.crews.map(row => ({ ...row, id: id('crews', row.id) })), workers: identities.workers.map(row => ({ ...row, id: id('workers', row.id), crewId: row.crewId ? id('crews', row.crewId) : null, ...(row.currentProjectId ? { currentProjectId: id('projects', row.currentProjectId) } : {}) })) }
    const options = { session: () => quantity.session, identities: () => structuredClone(mappedIdentities), quantityFacts: loadPayrollAQuantityFacts, hollowProjection: loadPayrollMigratedHollow, hollowFacts: (tx: Parameters<typeof loadQuantityHollowFacts>[0], query: Parameters<typeof loadQuantityHollowFacts>[1]) => loadQuantityHollowFacts(tx, query, { migratedProof: loadQuantityHollowMigratedProof }), transaction: <T>(work: Parameters<typeof quantity.instance.withWorkspaceTransaction<T>>[0]) => quantity.instance.withWorkspaceTransaction(work) }
    return { ...quantity, quantityService: quantity.service, service: createPayrollService(options), reloadPayroll: () => createPayrollService(options), id, mappings, identities: mappedIdentities }
  }
  catch (cause) {
    await quantity.close()
    throw cause
  }
}
