import type { BusinessSession } from '../../server/utils/business-session'
import type { PayrollIdentitySource, PayrollServiceOptions } from '../../server/utils/payroll-service'
import type { PayrollAttendanceCommand, PayrollAttendanceMatrixRead, PayrollAttendanceRecordDraft } from '~/lib/payroll/central-attendance-contract'
import type { PayrollC1Action, PayrollC1Command, PayrollC1CommandRead, PayrollC1Draft } from '~/lib/payroll/central-c1-contract'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { runMigrations } from '~/lib/db/migrations'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createMemoryDb } from './memory-db'

export async function createPayrollC1ServiceFixture(readOptions: Pick<PayrollServiceOptions, 'attendanceFacts'> = {}) {
  const db = await createMemoryDb()
  await runMigrations(db)
  const coordinator = createDbCoordinator(async () => db)
  let session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] }
  const source: PayrollIdentitySource = { version: 'identity-1', projects: [{ id: 'p', name: '纯时工项目', code: 'P' }, { id: 'other-project', name: '其他项目', code: 'Q' }], crews: [{ id: 'crew', name: '时工班组' }, { id: 'next-crew', name: '新班组' }], workers: [
    { id: 'w', name: '负责人', crewId: 'crew', currentProjectId: 'p', dailyWage: 481, dailyWageState: 'value', sourceVersion: 'w1' },
    { id: 'member', name: '组员', crewId: 'crew', currentProjectId: 'p', dailyWage: 480, dailyWageState: 'value', sourceVersion: 'm1' },
    { id: 'zero', name: '零成员', crewId: 'crew', currentProjectId: 'p', dailyWage: 0, dailyWageState: 'value', sourceVersion: 'z1' },
    { id: 'unknown', name: '未配置', crewId: 'crew', currentProjectId: 'p', dailyWage: null, dailyWageState: 'missing', sourceVersion: 'u1' },
    { id: 'outside', name: '负责人', crewId: 'crew', currentProjectId: 'other-project', dailyWage: 480, dailyWageState: 'value', sourceVersion: 'o1' },
  ] }
  let hook: (() => void | Promise<void>) | null = null
  const service = createPayrollService({ ...readOptions, session: () => session, identities: async () => {
    await hook?.()
    return structuredClone(source)
  }, transaction: work => coordinator.withTransaction(tx => work(tx, session)) })
  let sequence = 0
  const scope = { projectId: 'p', month: '2026-08', crewId: 'crew' }
  const draft: PayrollC1Draft = { ...scope, leaderWorkerId: 'w', memberWorkerIds: ['w', 'member', 'zero'], note: '' }
  const command = (read: PayrollC1CommandRead, action: PayrollC1Action): PayrollC1Command => ({ commandId: `c1-cmd-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, sourceVersion: read.context.sourceVersion, requiredCapability: 'payroll:write', projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const attendanceCommand = (read: PayrollAttendanceMatrixRead, record: PayrollAttendanceRecordDraft): PayrollAttendanceCommand => ({ commandId: `attendance-cmd-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: read.scope.projectId, scope: read.scope, action: { kind: 'upsert-attendance', record } })
  const matrix = () => service.attendanceMatrix({ origin: 'real' }, scope)
  const form = (overrides: Partial<PayrollC1Draft> = {}, draftKey = 'new-c1') => service.c1Form({ origin: 'real' }, { statementId: null, draftKey, draft: { ...draft, ...overrides } })
  const attendance = async (overrides: Partial<PayrollAttendanceRecordDraft> = {}) => {
    const record = { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 8, overtimeHours: 2, workContent: '真实施工', note: '', ...overrides }
    return service.executeAttendance(attendanceCommand(await matrix(), record))
  }
  return { db, service, source, scope, draft, command, attendanceCommand, matrix, form, attendance, config: () => service.c1Config({ origin: 'real' }, scope), close: () => coordinator.close(), setSession: (next: BusinessSession) => {
    session = next
  }, setIdentityHook: (next: typeof hook) => {
    hook = next
  } }
}
