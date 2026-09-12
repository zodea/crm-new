import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareConstructionContractChainIdentityFixtures } from '../../server/utils/construction-contract-chain-test-fixture'
import { constructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { constructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'
import { customerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { processLibraryService } from '../../server/utils/process-library-runtime'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { scheduleCatalog, scheduleService } from '../../server/utils/schedule-runtime'
import { projectScheduleLibraryUsage } from '../../server/utils/schedule-usage'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const scope = 'schedule-visible-usage-444'
const session = resolveBusinessSession()
const query = { projectId: 'project-real-320', origin: 'real' as const, includeDemo: false }
let libraryId = ''

beforeEach(async () => {
  prepareConstructionContractChainIdentityFixtures(scope)
  const contract = await constructionContractCommandTestInstance.execute({
    ...session,
    commandId: 'visible-contract',
    baseVersion: null,
    action: 'save',
    attachments: {},
    requiredCapability: 'construction-contract:write',
    draft: { name: '排程来源合同', projectId: query.projectId, customerId: 'customer-real-320', content: '施工', signDate: '2026-09-12', amount: 100 },
  }, session, scope)
  const library = processLibraryService.execute({
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    action: 'create-version',
    commandId: 'visible-library',
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 0,
    sourceVersion: null,
    draft: { sourceLibraryId: null, code: 'visible', name: '排程来源库', description: '', tasks: [{ key: 'manual', name: '手工工序', durationDays: 1, trade: '', color: '#64748b', stageCode: '', itemCodes: [], predecessorKey: null }] },
  }, session, scope)
  libraryId = library.id
  await scheduleService.read(query, '', scope)
  await quantityTestInstance.withSchedule(query, async (db) => {
    for (const [id, contractId, basis] of [['bound', contract.id, 'contract'], ['provisional', null, 'provisional']] as const) {
      await db.execute('INSERT INTO schedule_groups (id,project_id,contract_id,scope_basis,name,process_library_id) VALUES (?,?,?,?,?,?)', [id, query.projectId, contractId, basis, id, libraryId])
    }
  }, scope)
})

afterEach(async () => {
  await quantityTestInstance.reset(scope)
  constructionContractCommandTestInstance.reset(scope)
  constructionContractReadTestInstance.reset('ready', scope)
  customerCommandTestInstance.reset(scope)
  ownerCommercialDocumentCommandTestInstance.reset(scope)
  projectCommandTestInstance.reset(scope)
  supplierCommandTestInstance.reset(scope)
  processLibraryService.resetTestSession(session, scope)
})

async function catalogCount() {
  return (await scheduleCatalog('real', false, scope)).projects.find(row => row.id === query.projectId)!.groupCount
}
async function libraryCount() {
  const versions = processLibraryService.catalog('real', session, scope).libraries
  return (await projectScheduleLibraryUsage(versions, session, scope)).find(row => row.id === libraryId)!.usageCount
}

describe('中央排程目录与工序库引用共用当前可见范围', () => {
  it.each(['catalog', 'library'] as const)('合同来源已隐藏时%s首先读取也排除其组，保留无合同暂估组', async (first) => {
    expect((await scheduleService.read(query, '', scope)).snapshot.groups).toHaveLength(2)
    expect(await catalogCount()).toBe(2)
    expect(await libraryCount()).toBe(2)
    constructionContractCommandTestInstance.reset(scope)
    expect(await (first === 'catalog' ? catalogCount() : libraryCount())).toBe(1)
    expect((await scheduleService.read(query, '', scope)).snapshot.groups.map(row => row.id)).toEqual(['provisional'])
    expect(await catalogCount()).toBe(1)
    expect(await libraryCount()).toBe(1)
  })
})
