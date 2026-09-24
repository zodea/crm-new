import type { PayrollDetailRead, PayrollListRead, PayrollSourcesRead } from '~/lib/payroll/central-contract'

/** 组件状态夹具；真实来源迁入与快照由 payroll-migration-source 覆盖。 */
export function payrollDetailFixture(id = 'wage-a'): PayrollDetailRead {
  return {
    context: { workspaceId: 'workspace-a', actorId: 'actor-a', origin: 'real', sourceVersion: 'read-1', capabilities: ['payroll:read'], readonly: true },
    statement: {
      id,
      recordKind: 'central',
      legacyId: null,
      projectId: 'project-a',
      projectName: '来源项目',
      crewId: 'crew-a',
      crewName: '原班组',
      leaderWorkerId: 'worker-a',
      leaderName: '快照原姓名',
      subjectConfigId: 'config-a',
      month: '2026-08',
      formatFamily: 'C2',
      periodKind: 'monthly',
      purpose: 'advance',
      quantitySource: 'field',
      status: 'released',
      needsRecheck: false,
      payRatio: 1,
      cumulativeAmount: 0,
      previouslyPaid: null,
      grossAmount: 0,
      actualAmount: null,
      checkedAt: null,
      releasedAt: null,
      submittedAt: null,
      updatedAt: null,
      deletedAt: null,
      hidden: false,
      sourceVersion: 'wage-v1',
      note: null,
      snapshot: { state: 'complete', raw: '{"futureEvidence":{"value":"原扩展"}}', originalRaw: null, data: { futureEvidence: { value: '原扩展' } }, issues: [] },
      lines: [{ id: 'line-a', statementId: id, workerId: 'worker-a', workerName: '快照原姓名', itemId: null, itemName: '原分项', unit: '工', quantity: 0, unitPrice: null, amount: 0, sortOrder: 0, deletedAt: null }],
      members: [{ id: 'member-a', statementId: id, workerId: 'worker-zero', workerName: '零金额成员', isLeader: false, deletedAt: null }],
      allocations: [{ id: 'allocation-a', statementId: id, workerId: 'worker-zero', workerName: '零金额成员', isLeader: false, amount: 0, allocatedAmountFen: 0, deletedAt: null }],
      daywork: [],
      dayworkLinks: [],
      locks: [],
      stored: { head: { actual_amount: 100, status: 'released' }, lines: [{ id: 'line-deleted', statementId: id, workerId: 'worker-a', workerName: '当前关系姓名', itemId: null, itemName: '后来删除分项', unit: null, quantity: null, unitPrice: null, amount: null, sortOrder: 0, deletedAt: '2026-09-01' }], members: [], allocations: [], dayworkLinks: [] },
      diagnostics: [],
    },
    history: [{ id: 'log-a', tableName: 'wage_statements', recordId: id, operation: 'update', operatedAt: null, operator: null, beforeData: { actual_amount: null }, afterData: { actual_amount: 0 }, beforeRaw: '{"actual_amount":null}', afterRaw: '{"actual_amount":0}' }],
    evidence: [{ entityId: 'legacy-project', source: { schemaVersion: 1, statements: [{ id: 'isolated-original', actual_amount: null, unknownField: '完整原列' }] }, mappings: [] }],
  }
}
export function payrollListFixture(): PayrollListRead {
  const detail = payrollDetailFixture()
  return { context: detail.context, rows: [detail.statement], projects: [{ id: 'project-a', name: '来源项目', code: 'A' }, { id: 'source-only', name: '只有独立来源的项目', code: 'B' }], diagnostics: [] }
}
export function payrollSourcesFixture(projectId = 'source-only'): PayrollSourcesRead {
  return { context: payrollDetailFixture().context, projectId, configs: [{ id: 'config-only', projectId, crewId: null, leaderWorkerId: 'worker-a', formatFamily: 'C2', unitRate: null, ruleText: '已确认的完整来源规则', enabled: null, updatedAt: null, deletedAt: null }], attendance: [{ id: 'attendance-only', projectId, crewId: null, workerId: 'worker-a', workerName: '来源工人', workDate: '2026-08-01', hours: 0, overtimeHours: null, workContent: '独立考勤', note: null, deletedAt: null }], daywork: [{ id: 'daywork-only', projectId, crewId: null, workerId: 'worker-a', workerName: '来源工人', workDate: '2026-08-01', workContent: '尚未领用签工', startTime: null, endTime: null, laborUnits: 0, witness: null, confirmedOn: null, status: 'confirmed', note: null, deletedAt: null }], locks: [], diagnostics: [], history: [], evidence: [] }
}
