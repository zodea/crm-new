import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { listMigrationReferences, readMigrationReference } from '../../server/utils/production-migration-references'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('迁入关联使用实际同库主档ID与独立记录版本，权限/来源或损坏不能猜接', async () => {
  const root = testTempRoot('root-a01-a03-validation')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'migration-references-'))
  const identity = { workspaceId: 'migration-reference-workspace', actorId: 'migration-reference-owner' }
  const storage = await createSeededProductionStorage({ directory, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  const actor = { ...identity, capabilities: ['project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', 'customer:list:read', 'customer:write'] }
  const project = createProductionProjectService(storage)
  const supplier = createProductionSupplierService(storage)
  const session = () => actor
  try {
    const customer = await createProductionCustomerService(storage).execute({ ...identity, requiredCapability: 'customer:write', commandId: 'actual-customer', baseVersion: null, action: 'save', draft: { name: '实际关联客户', contact: '实际联系人' }, attachments: {} }, session)
    const common = { customerId: customer.id, manager: '真实项目经理' }
    const first = await project.execute({ ...identity, requiredCapability: 'project:write', commandId: 'first-project', baseVersion: null, action: 'save', draft: { ...common, name: '明确选择的项目', code: 'P001' }, attachments: {} }, session)
    await project.execute({ ...identity, requiredCapability: 'project:write', commandId: 'another-project', baseVersion: null, action: 'save', draft: { ...common, name: '同名不能猜接', code: 'P002' }, attachments: {} }, session)
    await project.execute({ ...identity, requiredCapability: 'project:write', id: first.id, commandId: 'project-edit', baseVersion: '1', action: 'save', draft: { ...common, name: '明确选择的项目新名', code: 'P001' }, attachments: {} }, session)
    const originalSupplier = await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'first-supplier', baseVersion: null, action: 'save', draft: { name: '明确分供方', supplierCategory: '其他', contact: '联系人甲' }, attachments: {} }, session)
    await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'another-supplier', baseVersion: null, action: 'save', draft: { name: '同名不能猜接', supplierCategory: '其他', contact: '联系人乙' }, attachments: {} }, session)
    await storage.withTransaction(async (tx) => {
      expect(await readMigrationReference(tx, actor, 'projects', first.id)).toEqual({ entityType: 'projects', serverId: first.id, label: '明确选择的项目新名', version: '2', sourceVersion: 'projects:3' })
      expect(await readMigrationReference(tx, actor, 'suppliers', originalSupplier.id)).toEqual({ entityType: 'suppliers', serverId: originalSupplier.id, label: '明确分供方', version: '1', sourceVersion: 'suppliers:2' })
      expect(await readMigrationReference(tx, actor, 'projects', 'missing-project')).toBeNull()
      expect((await listMigrationReferences(tx, actor, 'projects')).map(row => row.serverId)).toHaveLength(2)
      await expect(listMigrationReferences(tx, { ...actor, actorId: 'other-owner' }, 'projects')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      await expect(listMigrationReferences(tx, { ...actor, capabilities: ['supplier:list:read'] }, 'projects')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      await expect(readMigrationReference(tx, actor, 'projects', '../same-name')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    })
    await storage.close()
    expect(await storage.withTransaction(tx => readMigrationReference(tx, actor, 'projects', first.id))).toMatchObject({ version: '2', sourceVersion: 'projects:3' })
    await storage.execute('UPDATE projects SET draft_json=? WHERE id=?', ['{"name":"伪造行正文"}', first.id])
    await expect(storage.withTransaction(tx => listMigrationReferences(tx, actor, 'projects'))).rejects.toThrow('持久记录损坏')
  }
  finally { await storage.close() }
})

it('同名正式项目按各自稳定身份与版本读取，改名后重开仍不串接', async () => {
  const root = testTempRoot('same-name-project-references')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'synthetic-'))
  const identity = { workspaceId: 'same-name-workspace', actorId: 'same-name-owner' }
  const storage = await createSeededProductionStorage({ directory, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  const actor = { ...identity, capabilities: ['project:list:read', 'project:write', 'customer:list:read', 'customer:write'] }
  const session = () => actor
  try {
    const customer = await createProductionCustomerService(storage).execute({ ...identity, requiredCapability: 'customer:write', commandId: 'same-name-customer', baseVersion: null, action: 'save', draft: { name: '合成客户', contact: '合成联系人' }, attachments: {} }, session)
    const project = createProductionProjectService(storage)
    const common = { ...identity, requiredCapability: 'project:write', baseVersion: null, action: 'save', attachments: {} }
    const draft = { name: 'SAME-PROJECT', customerId: customer.id, manager: '合成项目经理' }
    const firstCommand = { ...common, commandId: 'same-name-first', draft: { ...draft, code: 'SYN-A' } }
    const first = await project.execute(firstCommand, session)
    const second = await project.execute({ ...common, commandId: 'same-name-second', draft: { ...draft, code: 'SYN-B' } }, session)
    expect(first.id).not.toBe(second.id)
    expect([first.id, second.id]).not.toContain(draft.name)
    expect(await project.execute(firstCommand, session)).toEqual(first)
    await storage.withTransaction(async (tx) => {
      const sameName = (await listMigrationReferences(tx, actor, 'projects')).filter(row => row.label === draft.name)
      expect(sameName).toHaveLength(2)
      expect(sameName.map(row => row.serverId).sort()).toEqual([first.id, second.id].sort())
      expect(await readMigrationReference(tx, actor, 'projects', first.id)).toEqual({ entityType: 'projects', serverId: first.id, label: draft.name, version: first.version, sourceVersion: 'projects:2' })
      expect(await readMigrationReference(tx, actor, 'projects', second.id)).toEqual({ entityType: 'projects', serverId: second.id, label: draft.name, version: second.version, sourceVersion: 'projects:2' })
      expect(await readMigrationReference(tx, actor, 'projects', draft.name)).toBeNull()
    })
    const renamed = await project.execute({ ...common, id: first.id, commandId: 'same-name-rename', baseVersion: first.version, draft: { ...draft, name: 'SAME-PROJECT-RENAMED', code: 'SYN-A' } }, session)
    expect(renamed.id).toBe(first.id)
    expect(renamed.version).not.toBe(first.version)
    await storage.close()
    await storage.withTransaction(async (tx) => {
      expect(await readMigrationReference(tx, actor, 'projects', first.id)).toEqual({ entityType: 'projects', serverId: first.id, label: 'SAME-PROJECT-RENAMED', version: renamed.version, sourceVersion: 'projects:3' })
      expect(await readMigrationReference(tx, actor, 'projects', second.id)).toEqual({ entityType: 'projects', serverId: second.id, label: draft.name, version: second.version, sourceVersion: 'projects:3' })
      expect(await readMigrationReference(tx, actor, 'projects', draft.name)).toBeNull()
    })
  }
  finally { await storage.close() }
})
