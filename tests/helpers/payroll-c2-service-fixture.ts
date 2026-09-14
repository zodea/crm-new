import type { PayrollC2Action, PayrollC2Command, PayrollC2CommandRead, PayrollC2Draft } from '~/lib/payroll/central-c2-contract'
import type { PayrollDayworkAction, PayrollDayworkCommand, PayrollDayworkFormRead, PayrollDayworkRecordDraft } from '~/lib/payroll/central-daywork-contract'
import { createPayrollC1ServiceFixture } from './payroll-c1-service-fixture'

export async function createPayrollC2ServiceFixture() {
  const f = await createPayrollC1ServiceFixture()
  let sequence = 0
  const scope = { projectId: 'p', month: '2026-08', crewId: 'crew', dayworkStatuses: [] }
  const draft: PayrollC2Draft = { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId: 'w', memberWorkerIds: ['w', 'member', 'zero'], note: '' }
  const record: PayrollDayworkRecordDraft = { projectId: 'p', crewId: 'crew', workerId: 'w', workDate: '2026-08-01', workContent: '现场零星施工', startTime: '08:00', endTime: '17:00', laborUnits: 1, witness: '', confirmedOn: null, status: 'draft', note: '' }
  const dayworkCommand = (read: PayrollDayworkFormRead, action: PayrollDayworkAction): PayrollDayworkCommand => ({ commandId: `daywork-command-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: read.record?.projectId ?? read.draft.projectId!, recordId: read.recordId, draftKey: read.draftKey, originalScope: read.record ? { projectId: read.record.projectId, crewId: read.record.crewId, workerId: read.record.workerId, workDate: read.record.workDate } : null, action })
  const c2Command = (read: PayrollC2CommandRead, action: PayrollC2Action): PayrollC2Command => ({ commandId: `c2-command-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action })
  const dayworkForm = (overrides: Partial<PayrollDayworkRecordDraft> = {}, draftKey = `new-daywork-${++sequence}`) => f.service.dayworkForm({ origin: 'real' }, { recordId: null, draftKey, draft: { ...record, ...overrides } })
  const daywork = async (overrides: Partial<PayrollDayworkRecordDraft> = {}) => f.service.executeDaywork(dayworkCommand(await dayworkForm(overrides), { kind: 'save-daywork', record: { ...record, ...overrides } }))
  const c2Form = (overrides: Partial<PayrollC2Draft> = {}, draftKey = 'new-c2') => f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey, draft: { ...draft, ...overrides } })
  const c2Config = () => f.service.c2Config({ origin: 'real' }, { projectId: 'p', leaderWorkerId: 'w' })
  return { ...f, scope, draft, record, dayworkCommand, c2Command, dayworkForm, daywork, c2Form, c2Config, ledger: () => f.service.dayworkList({ origin: 'real' }, scope) }
}

export async function createCheckedPayrollC2(f: Awaited<ReturnType<typeof createPayrollC2ServiceFixture>>) {
  await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
  await f.daywork({ status: 'confirmed', witness: '证明甲', confirmedOn: '2026-08-02' })
  await f.daywork({ workerId: 'member', laborUnits: 0.5, endTime: '12:00', status: 'confirmed', witness: '证明乙', confirmedOn: '2026-08-02' })
  const saved = await f.service.executeC2(f.c2Command(await f.c2Form(), { kind: 'save-c2-draft', draft: f.draft }))
  const read = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
  await f.service.executeC2(f.c2Command(read, { kind: 'check-c2' }))
  return f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
}
