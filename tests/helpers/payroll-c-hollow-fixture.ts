import type { PayrollC1Action, PayrollC1Command, PayrollC1CommandRead, PayrollC1Draft } from '~/lib/payroll/central-c1-contract'
import type { PayrollC2Action, PayrollC2Command, PayrollC2CommandRead } from '~/lib/payroll/central-c2-contract'
import { createPayrollHollowFixture } from './payroll-hollow-fixture'

/** 同库原检查/整改与公开考勤或已确认签工，各格式独立建立真实工资。 */
export async function createPayrollCHollowFixture(format: 'C1' | 'C2') {
  const f = await createPayrollHollowFixture()
  try {
    const worker = f.identities.workers[0]!
    worker.currentProjectId = f.draft.projectId
    worker.dailyWage = 1000
    worker.dailyWageState = 'value'
    let sequence = 0
    const draft: PayrollC1Draft = { projectId: f.draft.projectId, crewId: null, leaderWorkerId: worker.id, memberWorkerIds: [worker.id], month: '2026-08', note: '原空鼓不自动扣款' }
    const c1Command = (read: PayrollC1CommandRead, action: PayrollC1Action): PayrollC1Command => ({ commandId: `hollow-c1-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: draft.projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
    const c2Command = (read: PayrollC2CommandRead, action: PayrollC2Action): PayrollC2Command => ({ commandId: `hollow-c2-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: draft.projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action })
    if (format === 'C1') {
      const read = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: draft.projectId, month: draft.month, crewId: null })
      await f.service.executeAttendance({ commandId: 'hollow-c-attendance', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: draft.projectId, scope: read.scope, action: { kind: 'upsert-attendance', record: { workerId: worker.id, crewId: null, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '现场真实施工', note: '' } } })
    }
    else {
      const config = await f.service.c2Config({ origin: 'real' }, { projectId: draft.projectId, leaderWorkerId: worker.id })
      await f.service.executeC2(c2Command(config, { kind: 'save-c2-config', config: { crewId: null, unitRate: 1000, ruleText: '每工1000元' } }))
      const record = { projectId: draft.projectId, crewId: null, workerId: worker.id, workDate: '2026-08-01', workContent: '已确认现场零星施工', startTime: '08:00', endTime: '17:00', laborUnits: 1, witness: '现场证明人', confirmedOn: '2026-08-02', status: 'confirmed' as const, note: '' }
      const read = await f.service.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'hollow-c-daywork', draft: record })
      await f.service.executeDaywork({ commandId: 'hollow-c-daywork', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: draft.projectId, recordId: null, draftKey: read.draftKey, originalScope: null, action: { kind: 'save-daywork', record } })
    }
    return { ...f, draft, c1Command, c2Command }
  }
  catch (cause) {
    await f.close()
    throw cause
  }
}
