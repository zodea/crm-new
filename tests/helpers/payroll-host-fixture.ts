import type { CrewSourceRow, WorkerSourceRow } from '~/lib/crew-worker/read-contract'
import { loadPayrollHostSection } from '../../server/utils/crew-worker-payroll-read'
import { createCrewWorkerReadTestInstance } from '../../server/utils/crew-worker-read-test-instance'
import { createProjectReadTestInstance, PROJECT_READ_FIXTURE } from '../../server/utils/project-read-test-instance'
import { createPayrollAdjustmentFixture } from './payroll-adjustment-service-fixture'

export async function createPayrollHostFixture() {
  const payroll = await createPayrollAdjustmentFixture()
  let capabilities = ['payroll:read', 'worker:list:read', 'crew:list:read', 'project:list:read']
  let version = 'host-1'
  let afterRead: (() => void) | null = null
  let reads = 0
  const crew: CrewSourceRow = { dataOrigin: 'real', id: 'crew', name: '原班组', trade: '泥工', tradeCapabilities: [], itemCapabilities: [], contactName: '', contactPhone: '', defaultPayRatio: 1, rentSubsidyEnabled: false, rentSubsidyPrice: null, mgmtFeeEnabled: false, mgmtFeePrice: null, assignmentLevel: 'worker', note: '', status: 'submitted', updatedAt: '2026-09-14T00:00:00.000Z' }
  const worker: WorkerSourceRow = { dataOrigin: 'real', id: 'w', crewId: 'crew', currentProjectId: 'p', name: '负责人', trade: '泥工', phone: '', idCard: '', projectStatus: '在场', entryDate: null, exitDate: null, safetyEducation: true, status: 'submitted', updatedAt: '2026-09-14T00:00:00.000Z' }
  const read: Parameters<typeof createCrewWorkerReadTestInstance>[4] = async (scope) => {
    reads++
    const result = await payroll.withTransaction(tx => loadPayrollHostSection(tx, scope, { workspaceId: 'work', actorId: 'actor', capabilities }))
    afterRead?.()
    return result
  }
  const people = createCrewWorkerReadTestInstance(() => capabilities, () => [crew], () => [worker], () => version, read)
  const project = createProjectReadTestInstance(() => capabilities, () => [{ ...PROJECT_READ_FIXTURE[0]!, dataOrigin: 'real', id: 'p', name: '纯时工项目' }], () => version, undefined, async () => 0, async () => [], undefined, undefined, read)
  return {
    payroll,
    people,
    project,
    crew,
    worker,
    close: payroll.close,
    setCapabilities: (next: string[]) => { capabilities = next },
    setAfterRead: (hook: typeof afterRead) => { afterRead = hook },
    changeVersion: () => { version += '-changed' },
    readCount: () => reads,
  }
}
