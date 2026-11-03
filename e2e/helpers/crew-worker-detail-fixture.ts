import type { Page } from '@playwright/test'
import type { CrewSourceRow, CrewWorkerAssignmentSourceRow, CrewWorkerProjectSourceRow, WorkerSourceRow } from '../../app/lib/crew-worker/read-contract'
import { expect } from '@playwright/test'
import { buildCrewDetailRead, buildWorkerDetailRead, parseCrewDetailQuery, parseWorkerDetailQuery } from '../../app/lib/crew-worker/read-page'
import { createReadMeta, readQueryScope, withReadMeta } from '../../server/utils/read-meta'

const asOf = '2026-09-08T00:00:00.000Z'
const crew: CrewSourceRow = { dataOrigin: 'demo', id: 'synthetic-detail-crew', name: '合成砌筑班', trade: '泥工', tradeCapabilities: ['泥工'], itemCapabilities: [], contactName: '合成负责人', contactPhone: '13700110001', defaultPayRatio: null, rentSubsidyEnabled: false, rentSubsidyPrice: null, mgmtFeeEnabled: false, mgmtFeePrice: null, assignmentLevel: 'worker', note: '', status: 'submitted', updatedAt: asOf }
const workers: WorkerSourceRow[] = [{ dataOrigin: 'demo', id: 'synthetic-detail-worker', crewId: crew.id, currentProjectId: 'synthetic-detail-project', name: '合成工人甲', trade: '泥工', phone: '13511220003', idCard: '362426198712146789', projectStatus: '在场', status: 'submitted', entryDate: null, exitDate: null, safetyEducation: true, updatedAt: asOf }]
const projects: CrewWorkerProjectSourceRow[] = [{ dataOrigin: 'demo', id: 'synthetic-detail-project', name: '合成责任项目', code: 'SYNTHETIC', status: '在建', permission: 'allowed' }]
const assignments: CrewWorkerAssignmentSourceRow[] = [{ dataOrigin: 'demo', id: 'synthetic-detail-assignment', crewId: null, workerId: workers[0]!.id, projectId: projects[0]!.id, unitId: 'synthetic-detail-unit', buildingName: '合成楼', floorName: '二层', unitName: '201户', trade: '泥工', scopes: [{ roomName: '客厅', itemName: '墙砖' }], completedStageCount: 2 }]

/** 固定详情事实，避免页面只读旅程依赖演示种子内容。 */
export async function installCrewWorkerDetailFixture(page: Page) {
  const sessionResponse = await page.request.get('/api/read/business-session')
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = await sessionResponse.json()
  await page.route(/\/api\/read\/(crews\/synthetic-detail-crew|workers\/synthetic-detail-worker)(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    const isCrew = url.pathname.includes('/crews/')
    const id = isCrew ? crew.id : workers[0]!.id
    const input = Object.fromEntries(url.searchParams)
    const query = isCrew ? parseCrewDetailQuery(id, input) : parseWorkerDetailQuery(id, input)
    const source = { crews: [crew], workers, projects, assignments, wages: [], penalties: [], asOf, sourceVersion: 'synthetic-detail-v1', capabilities: session.capabilities }
    const detail = isCrew ? buildCrewDetailRead({ ...source, query }) : buildWorkerDetailRead({ ...source, query })
    const sources = ['crew-workers', 'projects'].map(key => ({ key, state: 'readable' as const, sourceVersion: 'synthetic-detail-v1', asOf }))
    const meta = createReadMeta({ session, schemaVersion: 'crew-worker-read-v2', operation: isCrew ? 'crew:detail' : 'worker:detail', dataOrigin: 'demo', asOf, coverage: 'complete', scope: { query: readQueryScope(query) }, sources })
    await route.fulfill({ json: withReadMeta(detail, meta) })
  })
}
