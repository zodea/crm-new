import type { BusinessSession } from '../../server/utils/business-session'
import type { PayrollIdentitySource, PayrollServiceOptions } from '../../server/utils/payroll-service'
import type { PayrollAAction, PayrollACommand, PayrollACommandRead, PayrollADraft, PayrollAQuantityFact, PayrollAQuantityFacts } from '~/lib/payroll/central-a-contract'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createMigratedMemoryDb } from './memory-db'

export function payrollAFact(overrides: Partial<PayrollAQuantityFact> = {}): PayrollAQuantityFact {
  return { ownershipKey: 'p:u:assignment:r:item', completionId: 'completed', assignmentId: 'assignment', stageId: 'stage', stageItemId: 'stage-item', unitId: 'u', floorId: 'floor', buildingId: 'building', templateId: 'template', templateLineId: 'template-line', roomId: 'r', itemId: 'item', completedAt: '2026-08-05', workerId: 'w', crewId: null, assignmentScopeIds: ['scope'], scopeKind: 'selected', scopeRows: [{ id: 'scope', roomId: 'r', itemId: 'item', deletedAt: null }], unit: '㎡', fieldQty: 8, fieldFormula: '2*4', buildingName: '一栋', floorName: '一层', unitName: '101', templateName: '甲户型', roomName: '客厅', itemName: '墙砖', workerName: '负责人', crewName: null, sourceFingerprint: 'cell-1', ...overrides }
}

/** 公共 service 的真实 SQL 夹具；Root 可修改 facts/identity/真实已发原行建立独立金额反例。 */
export async function createPayrollAServiceFixture(options: Pick<PayrollServiceOptions, 'quantityFacts' | 'managementScopeFacts'> = {}) {
  const db = await createMigratedMemoryDb()
  const coordinator = createDbCoordinator(async () => ({
    execute: (sql, params) => db.execute(sql, params),
    select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
    close: async () => db.close(),
  }))
  let session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] }
  const source: PayrollIdentitySource = { version: 'identity-1', projects: [{ id: 'p', name: '工资项目', code: 'P' }], crews: [{ id: 'crew', name: '现场班组', defaultPayRatio: null, ratioExplicitlyConfigured: false }], workers: [{ id: 'w', name: '负责人', crewId: 'crew' }, { id: 'zero', name: '零成员', crewId: 'crew' }, { id: 'other', name: '另簿负责人', crewId: 'crew' }] }
  const facts: PayrollAQuantityFacts = { sourceVersion: 'quantity-1', rows: [payrollAFact()], diagnostics: [] }
  let identityHook: (() => void | Promise<void>) | null = null
  const service = createPayrollService({ session: () => session, identities: async () => {
    await identityHook?.()
    return structuredClone(source)
  }, quantityFacts: options.quantityFacts ?? (async () => structuredClone(facts)), managementScopeFacts: options.managementScopeFacts, transaction: work => coordinator.withTransaction(tx => work(tx, session)) })
  let sequence = 0
  const draft: PayrollADraft = { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w', memberWorkerIds: ['w', 'zero'], month: '2026-08', periodKind: 'monthly', payRatio: 0.8, note: '' }
  const command = (read: PayrollACommandRead, action: PayrollAAction): PayrollACommand => ({ commandId: `cmd-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const form = (overrides: Partial<PayrollADraft> = {}, draftKey = 'new-a') => service.aForm({ origin: 'real' }, { statementId: null, draftKey, draft: { ...draft, ...overrides } })
  const config = () => service.aConfig({ origin: 'real' }, { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId: 'w' })
  return {
    db,
    service,
    source,
    facts,
    draft,
    form,
    config,
    command,
    close: () => coordinator.close(),
    setSession: (next: BusinessSession) => { session = next },
    setIdentityHook: (next: typeof identityHook) => { identityHook = next },
  }
}
