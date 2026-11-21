import type { BusinessSession } from '../../server/utils/business-session'
import type { CoreMigrationSynchronousSource } from '../../server/utils/core-migration-preparation'
import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import type { SupplierCredentialAction, SupplierCredentialCommand } from '~/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput, isCoreMigrationBlockingIssue } from '~/lib/migration/core-contract'
import { readSupplierCredentialMigrationGraphs, supplierCredentialMasterAttributes } from '~/lib/migration/supplier-credential-source'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { parseCoreMigrationBatchCommand, parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { createSupplierCredentialService } from '../../server/utils/supplier-credential-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const at = '2026-09-12T10:00:00.000Z'
const pdf = Buffer.from('%PDF-1.7\ncontrolled original').toString('base64')
const session: BusinessSession = { workspaceId: 'credential-migration-workspace', actorId: 'credential-maintainer', capabilities: [CORE_MIGRATION_CAPABILITY, 'supplier:list:read', 'supplier:write', 'supplier-credential:read', 'supplier-credential:write'] }
const sessionId = 'credential-core-test'
let original: CoreMigrationSourceDTO
const invalidActiveRequirements = [
  { category: '营业执照', requirement: 'optional' },
  { category: '营业执照', requirement: 'not_applicable' },
  { category: '法人身份证', requirement: 'optional' },
  { category: '法人身份证', requirement: 'not_applicable' },
  { category: '银行账户资料', requirement: 'optional' },
  { category: '银行账户资料', requirement: 'not_applicable' },
  { category: '资质证书', requirement: 'required' },
] as const

function rehash(value: CoreMigrationSourceDTO): CoreMigrationSourceDTO {
  return { ...value, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(value)).digest('hex') }
}
beforeAll(async () => {
  const db = await createMigratedMemoryDb()
  try {
    await db.execute('INSERT INTO suppliers (id, name, unique_code, tax_no, credential_status, credential_reviewed_at, credential_review_note, created_at, updated_at) VALUES (\'old-supplier\', \'待迁入完整分供方\', \'INTERNAL-CODE\', \'91350100M000100Y43\', \'qualified\', ?, \'原人工确认\', ?, ?)', [at, at, at])
    await db.execute('INSERT INTO suppliers (id, name, created_at, updated_at) VALUES (\'empty-old-supplier\', \'只有主档的分供方\', ?, ?)', [at, at])
    for (const [index, category] of ['营业执照', '法人身份证', '银行账户资料'].entries()) {
      await db.execute('INSERT INTO supplier_credentials (id, supplier_id, category, file_name, file_path, added_at) VALUES (?, \'old-supplier\', ?, \'原件.pdf\', \'C:/legacy/original.pdf\', ?)', [`old-credential-${index}`, category, at])
      await db.execute('INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_size, mime_type, uploaded_at) VALUES (?, \'supplier_credential\', ?, \'原件.pdf\', ?, \'application/pdf\', ?)', [`old-file-${index}`, `old-credential-${index}`, Buffer.from(pdf, 'base64').length, at])
      await db.execute('UPDATE supplier_credentials SET file_ref_id = ? WHERE id = ?', [`old-file-${index}`, `old-credential-${index}`])
      await db.execute('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, \'base64\', ?)', [`old-file-${index}`, pdf])
    }
    const entities = Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])) as CoreMigrationSourceDTO['entities']
    entities.supplier_credentials = await readSupplierCredentialMigrationGraphs(db)
    entities.suppliers = entities.supplier_credentials.map((entity) => {
      const graph = JSON.parse(String(entity.attributes!.graphJson))
      return { legacyId: entity.legacyId, name: entity.name, deletedAt: entity.deletedAt, attributes: supplierCredentialMasterAttributes(graph.supplier) }
    })
    original = rehash({ contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: CORE_MIGRATION_SOURCE_VERSION, sourceHash: '', entities })
  }
  finally { db.close() }
})

function sourceCommand(commandId: string, source: CoreMigrationSourceDTO, backed = false) {
  return parseCoreMigrationSourceCommand(JSON.parse(JSON.stringify({
    commandId,
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    source,
    backup: backed ? { backupId: `core-migration-${source.sourceHash}-${'b'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: at, immutable: true } : null,
  })))
}
function batchCommand(commandId: string, batchId: string) {
  return parseCoreMigrationBatchCommand({ commandId, batchId, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY }, batchId)
}
function fixture(others: CoreMigrationSynchronousSource[] = []) {
  let sequence = 0
  const suppliers = createSupplierCommandTestInstance({ now: () => at, createId: () => `new-supplier-${++sequence}` })
  const credentials = createSupplierCredentialService({ read: suppliers.readCredentialScope, transact: suppliers.transactCredentialScope }, { now: () => at, createId: () => `new-credential-${++sequence}` })
  const core = createCoreMigrationTestInstance({
    now: () => at,
    createServerId: ({ entityType, legacyId }) => `central:${entityType}:${legacyId}`,
    prepareTransition: snapshot => prepareCoreMigrationCommandSources(snapshot, [{ prepareMigrationSnapshot: value => suppliers.prepareMigrationSnapshot(value, sessionId) }, ...others]),
  })
  const read = () => credentials.read('central:suppliers:old-supplier', 'real', session, sessionId)
  const write = (action: SupplierCredentialAction, commandId = 'daily-edit') => {
    const current = read()
    const command: SupplierCredentialCommand = { ...action, commandId, supplierId: current.supplierId, origin: 'real', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: current.supplierVersion, baseCredentialVersion: current.credentialVersion }
    return credentials.execute(command, session, sessionId)
  }
  return { suppliers, credentials, core, read, write }
}
async function plan(instance: ReturnType<typeof fixture>, source = structuredClone(original)) {
  const preflight = await instance.core.preflight(sourceCommand('preflight', source), session)
  expect(preflight.entityCount).toBe(4)
  return instance.core.dryRun(sourceCommand('dry-run', source, true), session)
}
async function confirm(instance: ReturnType<typeof fixture>) {
  const batch = await plan(instance)
  expect(batch.issues.some(isCoreMigrationBlockingIssue)).toBe(false)
  await instance.core.importBatch(batchCommand('import', batch.batchId), session)
  expect(instance.suppliers.rows(sessionId)).toEqual([])
  await instance.core.confirm(batchCommand('confirm', batch.batchId), session)
  return batch
}

describe('证照与中央迁移协调器完整接缝', () => {
  it('真实 SQLite 来源经备份证明、预检、确认后主档与原件同刻可读，空图也有稳定来源', async () => {
    const instance = fixture()
    const batch = await confirm(instance)
    expect(instance.core.snapshot(session).authority).toBe('central')
    expect(batch.mappings.filter(row => row.entityType === 'supplier_credentials')).toHaveLength(2)
    const current = instance.read()
    expect(current).toMatchObject({ supplierName: '待迁入完整分供方', status: 'qualified', review: { actorId: null, reviewedAt: at, note: '原人工确认' } })
    const credential = current.credentials[0]!
    expect(instance.credentials.file({ supplierId: current.supplierId, credentialId: credential.id, fileId: credential.file!.id, origin: 'real' }, session, sessionId)).toMatchObject({ payloadBase64: pdf, sha256: createHash('sha256').update(Buffer.from(pdf, 'base64')).digest('hex') })
    expect(instance.suppliers.form(current.supplierId, session, sessionId).draft).toMatchObject({ uniqueCode: 'INTERNAL-CODE', taxNo: '91350100M000100Y43' })
    expect(instance.suppliers.rows(sessionId)).toContainEqual(expect.objectContaining({ id: current.supplierId, credentialStatus: 'qualified', businessLicense: { state: 'available', fileCount: 1, fileIds: [credential.file!.id] } }))
    expect(instance.credentials.read('central:suppliers:empty-old-supplier', 'real', session, sessionId)).toMatchObject({ status: 'incomplete', credentials: [], review: null })
  })

  it('后置参与者准备失败不提前发布主档或原件，同命令可恢复确认', async () => {
    let failing = true
    let otherCommitted = false
    const instance = fixture([{ prepareMigrationSnapshot() {
      if (failing)
        throw new Error('后置候选失败')
      return () => {
        otherCommitted = true
      }
    } }])
    const batch = await plan(instance)
    await instance.core.importBatch(batchCommand('import', batch.batchId), session)
    const before = instance.core.snapshot(session)
    await expect(instance.core.confirm(batchCommand('confirm', batch.batchId), session)).rejects.toThrow('后置候选失败')
    expect(instance.core.snapshot(session)).toEqual(before)
    expect(instance.suppliers.rows(sessionId)).toEqual([])
    expect(() => instance.read()).toThrow(/不存在/)
    expect(otherCommitted).toBe(false)
    failing = false
    await instance.core.confirm(batchCommand('confirm', batch.batchId), session)
    expect(instance.read().status).toBe('qualified')
    expect(otherCommitted).toBe(true)
  })

  it('确认后更正有效期再确认不覆盖，危险恢复保留主档、原件和中央权威', async () => {
    const instance = fixture()
    const batch = await confirm(instance)
    const credential = instance.read().credentials[0]!
    instance.write({ action: 'edit', credentialId: credential.id, draft: { category: credential.category, validFrom: '', expiresAt: '2030-01-01', longTerm: false } })
    const before = instance.read()
    expect(before.status).toBe('reviewing')
    await instance.core.confirm(batchCommand('confirm-again', batch.batchId), session)
    expect(instance.read()).toEqual(before)
    const authority = instance.core.snapshot(session)
    await expect(instance.core.rollback(batchCommand('rollback', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.core.snapshot(session)).toEqual(authority)
    expect(instance.read()).toEqual(before)
  })

  it('合法恢复仅撤回迁入图，独立中央分供方及其原件保留', async () => {
    const instance = fixture()
    const batch = await confirm(instance)
    const created = await instance.suppliers.execute({ commandId: 'independent-master', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', baseVersion: null, action: 'save', draft: { name: '独立中央分供方', supplierCategory: '其他', contact: '合成联系人' }, attachments: {} }, session, sessionId)
    const current = instance.credentials.read(created.id, 'real', session, sessionId)
    instance.credentials.execute({ action: 'upload', commandId: 'independent-upload', supplierId: created.id, origin: 'real', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: current.supplierVersion, baseCredentialVersion: current.credentialVersion, draft: { category: '其他', validFrom: '', expiresAt: '', longTerm: false, fileName: '独立.pdf', mimeType: 'application/pdf', fileSize: Buffer.from(pdf, 'base64').length, payloadBase64: pdf } }, session, sessionId)
    const independent = instance.credentials.read(created.id, 'real', session, sessionId)
    await instance.core.rollback(batchCommand('rollback', batch.batchId), session)
    expect(instance.core.snapshot(session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
    expect(() => instance.read()).toThrow(/不存在/)
    expect(instance.credentials.read(created.id, 'real', session, sessionId)).toEqual(independent)
  })

  it.each(['json', 'credential-parent', 'file-owner', 'missing-payload-parent'] as const)('损坏 %s 图在 dry-run 明确阻断，没有部分发布', async (kind) => {
    const instance = fixture()
    const source = structuredClone(original)
    const entity = source.entities.supplier_credentials!.find(row => row.legacyId === 'old-supplier')!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    if (kind === 'credential-parent')
      graph.credentials[0].supplier_id = 'other'
    if (kind === 'file-owner')
      graph.files[0].owner_id = 'other'
    if (kind === 'missing-payload-parent')
      graph.payloads[0].file_ref_id = 'missing'
    entity.attributes!.graphJson = kind === 'json' ? '{broken' : JSON.stringify(graph)
    const batch = await plan(instance, rehash(source))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'supplier_credentials', field: 'graphJson', metricKey: 'apply-failed', attribution: 'source' }))
    await expect(instance.core.importBatch(batchCommand('import-invalid', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.suppliers.rows(sessionId)).toEqual([])
    expect(instance.core.snapshot(session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
  })

  it.each(invalidActiveRequirements)('迁入活跃 $category/$requirement 不能绕过现行资料要求，dry-run 阻断且不发布', async (requirement) => {
    const instance = fixture()
    const source = structuredClone(original)
    const entity = source.entities.supplier_credentials!.find(row => row.legacyId === 'old-supplier')!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    graph.requirements.push({ id: 'invalid-active-requirement', supplier_id: 'old-supplier', ...requirement, reason: '  ', updated_at: at, deleted_at: null })
    entity.attributes!.graphJson = JSON.stringify(graph)
    const batch = await plan(instance, rehash(source))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'supplier_credentials', field: 'graphJson', metricKey: 'apply-failed', attribution: 'source' }))
    await expect(instance.core.importBatch(batchCommand('import-invalid-requirement', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.suppliers.rows(sessionId)).toEqual([])
    expect(instance.core.snapshot(session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
  })

  it('软删除的旧要求完整保留，过去降级或缺原因不阻断整图迁入也不改变当前固定要求', async () => {
    const instance = fixture()
    const source = structuredClone(original)
    const entity = source.entities.supplier_credentials!.find(row => row.legacyId === 'old-supplier')!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    graph.requirements = invalidActiveRequirements.map((requirement, index) => ({ id: `old-deleted-requirement-${index}`, supplier_id: 'old-supplier', ...requirement, reason: '  ', updated_at: at, deleted_at: at }))
    entity.attributes!.graphJson = JSON.stringify(graph)
    const batch = await plan(instance, rehash(source))
    expect(batch.issues.some(isCoreMigrationBlockingIssue)).toBe(false)
    await instance.core.importBatch(batchCommand('import-deleted-requirements', batch.batchId), session)
    await instance.core.confirm(batchCommand('confirm-deleted-requirements', batch.batchId), session)
    const current = instance.read()
    expect(current.status).toBe('qualified')
    const aggregate = instance.suppliers.readCredentialScope(current.supplierId, sessionId).aggregate
    expect(aggregate.requirements).toHaveLength(invalidActiveRequirements.length)
  })

  it.each(Array.from(['营业执照', '法人身份证', '银行账户资料']).map(input => ({ input })))('软删除的旧要求完整保留，过去降级或缺原因不阻断整图迁入也不改变当前固定要求：输入组合 1 案例 %#', async ({ input: category }) => {
    const instance = fixture()
    const source = structuredClone(original)
    const entity = source.entities.supplier_credentials!.find(row => row.legacyId === 'old-supplier')!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    graph.requirements = invalidActiveRequirements.map((requirement, index) => ({ id: `old-deleted-requirement-${index}`, supplier_id: 'old-supplier', ...requirement, reason: '  ', updated_at: at, deleted_at: at }))
    entity.attributes!.graphJson = JSON.stringify(graph)
    const batch = await plan(instance, rehash(source))
    expect(batch.issues.some(isCoreMigrationBlockingIssue)).toBe(false)
    await instance.core.importBatch(batchCommand('import-deleted-requirements', batch.batchId), session)
    await instance.core.confirm(batchCommand('confirm-deleted-requirements', batch.batchId), session)
    const current = instance.read()
    expect(current.status).toBe('qualified')
    expect(current.requirements).toContainEqual(expect.objectContaining({ category, requirement: 'required' }))
  })

  it.each(Array.from(invalidActiveRequirements.entries()))('软删除的旧要求完整保留，过去降级或缺原因不阻断整图迁入也不改变当前固定要求：输入组合 2 案例 %#', async (index, requirement) => {
    const instance = fixture()
    const source = structuredClone(original)
    const entity = source.entities.supplier_credentials!.find(row => row.legacyId === 'old-supplier')!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    graph.requirements = invalidActiveRequirements.map((requirement, index) => ({ id: `old-deleted-requirement-${index}`, supplier_id: 'old-supplier', ...requirement, reason: '  ', updated_at: at, deleted_at: at }))
    entity.attributes!.graphJson = JSON.stringify(graph)
    const batch = await plan(instance, rehash(source))
    expect(batch.issues.some(isCoreMigrationBlockingIssue)).toBe(false)
    await instance.core.importBatch(batchCommand('import-deleted-requirements', batch.batchId), session)
    await instance.core.confirm(batchCommand('confirm-deleted-requirements', batch.batchId), session)
    const current = instance.read()
    expect(current.status).toBe('qualified')
    const aggregate = instance.suppliers.readCredentialScope(current.supplierId, sessionId).aggregate
    expect(aggregate.requirements).toHaveLength(invalidActiveRequirements.length)
    expect(aggregate.requirements).toContainEqual(expect.objectContaining({ legacyId: `old-deleted-requirement-${index}`, ...requirement, reason: '  ', deletedAt: at }))
  })
})
