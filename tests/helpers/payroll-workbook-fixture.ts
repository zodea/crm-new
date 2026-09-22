import type { WorkerSourceRow } from '../../app/lib/crew-worker/read-contract'
import type { PayrollWorkbookCommand, PayrollWorkbookInput, PayrollWorkbookPreview } from '../../app/lib/payroll/central-workbook-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import type { PayrollWorkbookServiceOptions } from '../../server/utils/payroll-workbook-service'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { readPayrollStatement } from '../../app/lib/payroll/central-read'
import { EMPTY_WORKER_PRIVATE } from '../../app/lib/worker-roster/contract'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createPayrollWorkbookService } from '../../server/utils/payroll-workbook-service'
import { createWorkerRosterService } from '../../server/utils/worker-roster-service'
import { rosterHash } from '../../server/utils/worker-roster-storage'
import { createPayrollNumberingFixture } from './payroll-numbering-fixture'

export async function createPayrollWorkbookFixture() {
  const f = await createPayrollNumberingFixture()
  await f.initialize()
  await f.issue()
  let session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'worker:write', 'worker:sensitive:read'] }
  const coordinator = createDbCoordinator(async () => f.db)
  let afterOperation: (() => void) | undefined
  const rosterSource = { projects: [{ id: 'p', name: '测试项目' }], workers: ['w', 'member', 'zero'].map((id): WorkerSourceRow => ({
    id,
    dataOrigin: 'real',
    name: id,
    crewId: 'crew',
    currentProjectId: 'p',
    phone: '13800000000',
    idCard: '440000199001010001',
    gender: '男',
    hometown: '广东',
    trade: '铺贴',
    projectStatus: '在场',
    entryDate: '2026-08-01',
    exitDate: id === 'zero' ? '2026-09-01' : null,
    safetyEducation: true,
    bankName: '某银行',
    bankAccount: '6222000000000001',
    status: 'submitted',
    updatedAt: '2026-08-01T00:00:00Z',
  })) }
  const rosterOptions = {
    session: () => session,
    source: () => rosterSource,
    statements: async (db: Parameters<PayrollWorkbookServiceOptions['roster']>[0], scope: { statementIds: string[] }) => {
      const rows = []
      for (const id of scope.statementIds) {
        const row = await readPayrollStatement(db, id)
        rows.push({ id, projectId: row.projectId, status: row.status, formatFamily: row.formatFamily, members: row.members.map(m => ({ workerId: m.workerId!, workerName: m.workerName!, isLeader: m.isLeader })), proof: rosterHash({ snapshot: row.snapshot.originalRaw, members: row.members }) })
      }
      return rows
    },
  }
  const options: PayrollWorkbookServiceOptions = {
    session: () => session,
    transaction: work => coordinator.withTransaction(work),
    payroll: db => createPayrollService({ session: () => session, identities: () => structuredClone(f.source), transaction: work => work(db, session) }),
    roster: db => createWorkerRosterService({ ...rosterOptions, transaction: work => work(db) }),
  }
  const archive = createPayrollWorkbookService({ ...options, transaction: work => coordinator.withTransaction(async (db) => {
    const result = await work({ ...db, select: db.select.bind(db), execute: async (sql, args) => {
      const result = await db.execute(sql, args)
      if (sql.startsWith('INSERT INTO payroll_workbook_receipts'))
        afterOperation?.()
      return result
    } })
    return result
  }) })
  const input: PayrollWorkbookInput = { projectId: 'p', mode: 'project-month', statementIds: [f.input.statementId], rosterArchiveId: null }
  const preview = () => archive.workbookPreview({ origin: 'real' }, input)
  const command = (read: PayrollWorkbookPreview, commandId = 'workbook-save'): PayrollWorkbookCommand => ({ schemaVersion: 1, commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.sourceVersion, input: read.input, action: 'archive' })
  const roster = createWorkerRosterService({ ...rosterOptions, transaction: work => coordinator.withTransaction(work) })
  async function prepareRoster() {
    const payloadBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    const upload = { fileName: '证件.png', mimeType: 'image/png', fileSize: 68, payloadBase64 }
    for (const worker of rosterSource.workers) {
      const read = await roster.profile(worker.id)
      await roster.execute({ commandId: `profile-${worker.id}`, workspaceId: 'work', actorId: 'actor', origin: 'real', action: 'save-profile', workerId: worker.id, sourceVersion: read.sourceVersion, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: false }, uploads: { 'portrait': upload, 'bank-card': { ...upload, fileName: '银行卡.png' } } })
    }
    const scope = { projectId: 'p', statementIds: input.statementIds, registeredOn: '2026-09-22' }
    const read = await roster.preview(scope)
    const saved = await roster.execute({ commandId: 'roster-save', workspaceId: 'work', actorId: 'actor', origin: 'real', action: 'archive', scope, sourceVersion: read.sourceVersion })
    input.rosterArchiveId = saved.archiveId!
    return roster.archive('p', input.rosterArchiveId)
  }
  return { ...f, archive, input, options, roster, rosterSource, prepareRoster, preview, command, getArchiveSession: () => session, setAfterOperation: (hook: (() => void) | undefined) => {
    afterOperation = hook
  }, setArchiveSession: (next: BusinessSession) => {
    session = next
  } }
}
