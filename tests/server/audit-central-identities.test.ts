import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { f2FormDefaults } from '~/lib/contract/page'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { crewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { customerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance } from '../../server/utils/customer-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { projectReadTestInstance } from '../../server/utils/project-read-test-instance'
import { subcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { supplierReadTestInstance } from '../../server/utils/supplier-read-test-instance'

const session = { ...resolveBusinessSession(), capabilities: [...resolveBusinessSession().capabilities, 'worker:sensitive:read'] }
beforeEach(async () => {
  await coreMigrationTestInstance.reset()
  projectCommandTestInstance.reset()
  customerCommandTestInstance.reset()
  supplierCommandTestInstance.reset()
  crewWorkerCommandTestInstance.reset()
  subcontractContractCommandTestInstance.reset()
})

describe('审计正式身份边界', () => {
  it('未导入且未新建的正式工作区不返回固定测试样例', async () => {
    expect((await projectReadTestInstance.list({ includeDemo: 'false' })).items).toEqual([])
    expect((await customerReadTestInstance.list({ includeDemo: 'false' })).items).toEqual([])
    expect((await supplierReadTestInstance.list({ includeDemo: 'false' })).items).toEqual([])
  })

  it('分包合同不能把演示项目和分供方保存成正式记录', async () => {
    await expect(subcontractContractCommandTestInstance.execute({
      ...session,
      requiredCapability: 'subcontract-contract:write',
      commandId: 'audit-demo',
      baseVersion: null,
      action: 'save',
      attachments: {},
      draft: { ...f2FormDefaults('subcontract'), name: '错误的正式合同', projectId: 'proj_demo_001', supplierId: 'sup_demo_001', subKind: '劳务', content: '测试', signDate: '2026-09-05', amount: 100 },
    }, session)).rejects.toThrow('项目')
  })

  it('确认迁移后主档可普通编辑，重复同步保留修改，回滚撤回迁入身份', async () => {
    const entities = Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])) as CoreMigrationSourceDTO['entities']
    const row = (id: string) => ({ legacyId: id, name: id, deletedAt: null })
    entities.customers = [row('customer')]
    entities.suppliers = [row('supplier')]
    entities.crews = [row('crew')]
    entities.projects = [{ ...row('project'), references: { customerId: 'customer' } }]
    entities.workers = [{ ...row('worker'), references: { crewId: 'crew', projectId: 'project' } }]
    entities.project_suppliers = [{ ...row('relation'), references: { projectId: 'project', supplierId: 'supplier' } }]
    const source: CoreMigrationSourceDTO = { contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: CORE_MIGRATION_SOURCE_VERSION, sourceHash: '', entities }
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const command = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY }
    await coreMigrationTestInstance.preflight({ ...command, commandId: 'preflight', source, backup: null }, session)
    const dry = await coreMigrationTestInstance.dryRun({ ...command, commandId: 'dry', source, backup: { backupId: `core-migration-${source.sourceHash}-${'c'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'c'.repeat(64), byteLength: 1024, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
    await coreMigrationTestInstance.importBatch({ ...command, commandId: 'import', batchId: dry.batchId }, session)
    expect(projectCommandTestInstance.rows()).toEqual([])
    await coreMigrationTestInstance.confirm({ ...command, commandId: 'confirm', batchId: dry.batchId }, session)
    const snapshot = coreMigrationTestInstance.snapshot(session)
    const id = (type: string) => snapshot.entities.find(entity => entity.entityType === type)!.id
    const project = projectCommandTestInstance.form(id('projects'), session)
    const customer = customerCommandTestInstance.form(id('customers'), session)
    expect(supplierCommandTestInstance.form(id('suppliers'), session).draft.name).toBe('supplier')
    expect(crewWorkerCommandTestInstance.crewForm(id('crews'), session).draft.name).toBe('crew')
    expect(crewWorkerCommandTestInstance.workerForm(id('workers'), session).draft).toMatchObject({ crewId: id('crews'), currentProjectId: id('projects') })
    await customerCommandTestInstance.execute({ ...command, requiredCapability: 'customer:write', commandId: 'edit-customer', id: id('customers'), baseVersion: customer.version, action: 'draft', attachments: {}, draft: { ...customer.draft, name: '迁入后修改的客户' } }, session)
    await projectCommandTestInstance.execute({ ...command, requiredCapability: 'project:write', commandId: 'edit-project', id: id('projects'), baseVersion: project.version, action: 'draft', attachments: {}, draft: { ...project.draft, name: '迁入后修改的项目' } }, session)
    for (const source of [projectCommandTestInstance, customerCommandTestInstance, supplierCommandTestInstance, crewWorkerCommandTestInstance])
      source.prepareMigrationSnapshot(snapshot)()
    expect((await customerReadTestInstance.list({ includeDemo: 'false' })).items.map(row => row.customer.label)).toEqual(['迁入后修改的客户'])
    expect((await projectReadTestInstance.list({ includeDemo: 'false' })).items.map(row => row.project.label)).toEqual(['迁入后修改的项目'])
    expect((await projectReadTestInstance.list({ includeDemo: 'false' })).items[0]?.customer).toMatchObject({ id: id('customers'), label: '迁入后修改的客户' })
    await coreMigrationTestInstance.rollback({ ...command, commandId: 'rollback', batchId: dry.batchId }, session)
    expect(projectCommandTestInstance.rows()).toEqual([])
    expect(customerCommandTestInstance.rows()).toEqual([])
    expect(supplierCommandTestInstance.rows()).toEqual([])
    expect(crewWorkerCommandTestInstance.workerRows()).toEqual([])
    expect(crewWorkerCommandTestInstance.crewRows()).toEqual([])
  })
})
