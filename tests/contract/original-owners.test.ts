import type { ConstructionContractCommandRequestDTO } from '../../app/lib/construction-contract/command-contract'
import type { ContractFormAttachmentDraft } from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO, CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, getRouterParam, readBody, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '../../app/lib/migration/core-contract'
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionStorage, ProductionStorageProblem } from '../../server/utils/production-storage'
import { createSubcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

type Domain = 'construction' | 'subcontract'
const timestamp = '2026-10-04T08:00:00.000Z'
const body = Buffer.from('%PDF-1.7\nOriginal contract fixture\n%%EOF')
const original: ContractFormAttachmentDraft = { fileName: '合同原件.pdf', fileSize: body.length, mimeType: 'application/pdf', payloadBase64: body.toString('base64') }
const empty: ContractFormAttachmentDraft = { fileName: '真实空文件.txt', fileSize: 0, mimeType: 'text/plain', payloadBase64: '' }
let httpActor: BusinessSession

function originalFixture(domain: Domain, attachmentIds?: string[]) {
  let id = 0
  let fileId = 0
  const actor = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: [`${domain}-contract:read`, `${domain}-contract:write`] }

  const options = { createId: () => `${domain}-owner-${++id}`, createAttachmentId: () => {
    const index = fileId++
    return attachmentIds?.[index] ?? `${domain}-file-${index + 1}`
  }, now: () => timestamp, projects: [{ id: 'project-1', name: '项目', customerId: 'customer-1' }] }
  const service = domain === 'construction'
    ? createConstructionContractCommandTestInstance({ ...options, customers: [{ id: 'customer-1', name: '甲方' }] })
    : createSubcontractContractCommandTestInstance({ ...options, suppliers: [{ id: 'supplier-1', name: '分包方' }] })
  const request = (overrides: Partial<ConstructionContractCommandRequestDTO> = {}): ConstructionContractCommandRequestDTO => ({
    workspaceId: actor.workspaceId,
    actorId: actor.actorId,
    requiredCapability: 'construction-contract:write',
    commandId: `${domain}-create-original`,
    baseVersion: null,
    action: 'save',
    draft: { no: 'HT-01', name: '原件保全合同', projectId: 'project-1', customerId: domain === 'construction' ? 'customer-1' : null, supplierId: domain === 'subcontract' ? 'supplier-1' : null, subKind: domain === 'subcontract' ? '劳务' : '', content: '正常合同范围', signDate: '2026-10-04', amount: 0 },
    attachments: { add: [original] },
    ...overrides,
  })
  function execute(command: ConstructionContractCommandRequestDTO) {
    if (domain === 'construction')
      return (service as ReturnType<typeof createConstructionContractCommandTestInstance>).execute(command, actor)
    return (service as ReturnType<typeof createSubcontractContractCommandTestInstance>).execute({ ...command, requiredCapability: 'subcontract-contract:write' }, actor)
  }
  return { domain, actor, service, request, execute }
}

function legacySnapshot(domain: Domain, attachments: Record<string, unknown>[]): CoreMigrationSnapshotDTO {
  const entity = (entityType: CoreMigrationServerEntityDTO['entityType'], id: string, extra: Partial<CoreMigrationServerEntityDTO> = {}): CoreMigrationServerEntityDTO => ({ entityType, id, legacyId: id, name: id, references: {}, quantity: null, amount: null, attributes: {}, deletedAt: null, batchId: 'batch-originals', ...extra })
  return { authority: 'central', activeBatchId: 'batch-originals', entities: [
    entity('customers', 'customer-legacy'),
    entity('suppliers', 'supplier-legacy'),
    entity('projects', 'project-legacy', { references: { customerId: 'customer-legacy' } }),
    entity(domain === 'construction' ? 'construction_contracts' : 'subcontract_contracts', `${domain}-migrated`, { legacyId: 'legacy-contract', references: { projectId: 'project-legacy', ...(domain === 'construction' ? { customerId: 'customer-legacy' } : { supplierId: 'supplier-legacy' }) }, amount: '0.00', attributes: { no: 'LEGACY-HT', ...(domain === 'subcontract' ? { subKind: '劳务', settlementStatus: null, clearanceStatus: null } : {}), content: '已核对旧合同', signDate: '2026-01-01', createdAt: timestamp, attachmentsJson: JSON.stringify(attachments) } }),
  ] }
}

function metadata(overrides: Record<string, unknown> = {}) {
  return { id: 'legacy-original', ownerType: 'contract', ownerId: 'legacy-contract', fileName: '历史原件.pdf', filePath: 'C:/旧附件证据.pdf', fileSize: body.length, mimeType: 'application/pdf', category: 'original', uploader: '原经办人', uploadedAt: '2026-01-01 09:00:00', deletedAt: null, ...overrides }
}

describe.each(['construction', 'subcontract'] as const)('%s 合同原件完整 owner', (domain) => {
  it('真实正文与零字节分别保全，纯读取允许只读权限，首次回执不会重复原件', async () => {
    const f = originalFixture(domain)
    const command = f.request({ attachments: { add: [original, empty] } })
    const saved = await f.execute(command)
    const readActor = { ...f.actor, capabilities: [`${domain}-contract:read`] }
    const first = f.service.readFileContent(saved.id, saved.attachmentIds[0]!, readActor)
    expect(first).toMatchObject({ ownerId: saved.id, fileName: original.fileName, fileSize: body.length, payloadBase64: body.toString('base64'), dataOrigin: 'real' })
    // 此合成正文摘要经独立 .NET SHA256 核验，预期不调用被测 helper。
    expect(first.sha256).toBe('f2b59b85ccc162ba3a4cb41ed108b42c83925a08cbab43fb4ab20637752f0a67')
    expect(f.service.readFileContent(saved.id, saved.attachmentIds[1]!, readActor)).toMatchObject({ fileSize: 0, payloadBase64: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })
    const source = f.service.sourceVersion()
    expect(await f.execute(command)).toEqual(saved)
    expect(f.service.sourceVersion()).toBe(source)
    expect(f.service.form(saved.id, f.actor).attachments).toHaveLength(2)
    expect(JSON.stringify(f.service.facts())).not.toContain('payloadBase64')
    expect(JSON.stringify(f.service.form(saved.id, f.actor))).not.toContain('payloadBase64')
    expect(() => f.service.readFileContent(saved.id, saved.attachmentIds[0]!, { ...f.actor, capabilities: [] })).toThrow(/权限/)
  })

  it('软删除禁止读取；恢复沿同一ID和原摘要保留正文及原回执', async () => {
    const f = originalFixture(domain)
    const saved = await f.execute(f.request())
    const fileId = saved.attachmentIds[0]!
    const before = f.service.readFileContent(saved.id, fileId, f.actor)
    const removed = await f.execute(f.request({ id: saved.id, baseVersion: saved.version, commandId: `${domain}-remove-original`, attachments: { removeIds: [fileId] } }))
    expect(() => f.service.readFileContent(saved.id, fileId, f.actor)).toThrow(/删除|不存在/)
    const restored = await f.execute(f.request({ id: saved.id, baseVersion: removed.version, commandId: `${domain}-restore-original`, attachments: { restoreIds: [fileId] } }))
    expect(restored.attachmentIds).toEqual([fileId])
    expect(f.service.readFileContent(saved.id, fileId, f.actor)).toEqual(before)
    expect(f.service.resolve(saved.commandId, f.actor)).toEqual({ outcome: 'applied', result: saved })
  })

  it.each([
    { ...original, payloadBase64: undefined },
    { ...original, payloadBase64: 'YQ' },
    { ...original, payloadBase64: '@@==' },
    { ...original, fileSize: 0 },
  ])('坏正文或大小拒绝整个提交，不留下先前有效附件', async (invalid) => {
    const f = originalFixture(domain)
    await expect(f.execute(f.request({ attachments: { add: [empty, invalid] } }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(f.service.rows()).toEqual([])
    expect(f.service.facts().files).toEqual([])
  })

  it('异owner删除/恢复和重复附件ID均拒绝，既有事实及原件不被覆盖', async () => {
    const f = originalFixture(domain, ['retained-file', 'other-file', 'retained-file'])
    const first = await f.execute(f.request())
    const second = await f.execute(f.request({ commandId: `${domain}-second-original` }))
    const source = f.service.sourceVersion()
    for (const attachments of [{ removeIds: ['retained-file'] }, { restoreIds: ['retained-file'] }, { add: [original] }]) {
      await expect(f.execute(f.request({ id: second.id, baseVersion: second.version, commandId: `${domain}-invalid-${Object.keys(attachments)[0]}`, attachments }))).rejects.toMatchObject({ problem: { code: attachments.add ? 'conflict' : 'relationship-mismatch' } })
    }
    expect(f.service.sourceVersion()).toBe(source)
    expect(f.service.form(second.id, f.actor).version).toBe('1')
    expect(() => f.service.readFileContent(second.id, 'retained-file', f.actor)).toThrow(/属于|不存在/)
    expect(f.service.readFileContent(first.id, 'retained-file', f.actor).payloadBase64).toBe(original.payloadBase64)
  })

  it('旧路径缺正文明确missing，同图真实正文及历史删除原件完整迁入', async () => {
    const f = originalFixture(domain)
    const snapshot = legacySnapshot(domain, [metadata(), metadata({ id: 'legacy-with-bytes', payloadEncoding: 'base64', payloadBase64: original.payloadBase64 }), metadata({ id: 'legacy-zero', fileSize: 0, payloadEncoding: 'base64', payloadBase64: '', deletedAt: timestamp })])
    f.service.synchronizeMigrationSnapshot(snapshot)
    const id = `${domain}-migrated`
    expect(f.service.form(id, f.actor).attachments[0]).toMatchObject({ id: 'legacy-original', ownerId: id, filePath: 'C:/旧附件证据.pdf', uploadedAt: '2026-01-01 09:00:00' })
    expect(() => f.service.readFileContent(id, 'legacy-original', f.actor)).toThrow(/正文未迁入/)
    expect(f.service.readFileContent(id, 'legacy-with-bytes', f.actor).payloadBase64).toBe(original.payloadBase64)
    const edit = await f.execute(f.request({ id, baseVersion: '1', commandId: `${domain}-migration-later-original`, draft: f.service.form(id, f.actor).draft, attachments: { restoreIds: ['legacy-zero'], add: [empty] } }))
    f.service.synchronizeMigrationSnapshot(snapshot)
    expect(f.service.form(id, f.actor).version).toBe(edit.version)
    expect(f.service.readFileContent(id, 'legacy-zero', f.actor).payloadBase64).toBe('')
    expect(() => f.service.synchronizeMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })).toThrow(/不能回滚/)
    expect(f.service.readFileContent(id, edit.attachmentIds.at(-1)!, f.actor).payloadBase64).toBe('')
    expect(f.service.resolve(edit.commandId, f.actor)).toEqual({ outcome: 'applied', result: edit })
  })

  it.each([{ ownerId: 'foreign-contract' }, { fileSize: null }, { payloadEncoding: 'base64', payloadBase64: '%%%=' }])('损坏旧owner/未知大小/正文拒绝迁移且保留原图', async (invalid) => {
    const f = originalFixture(domain)
    const saved = await f.execute(f.request())
    const source = f.service.sourceVersion()
    expect(() => f.service.synchronizeMigrationSnapshot(legacySnapshot(domain, [metadata(invalid)]))).toThrow(/损坏|不一致/)
    expect(f.service.sourceVersion()).toBe(source)
    expect(f.service.readFileContent(saved.id, saved.attachmentIds[0]!, f.actor).payloadBase64).toBe(original.payloadBase64)
  })

  it('严格HTTP迁移解析经试跑、确认带入原字节，未日常写入时仍可安全回滚', async () => {
    const f = originalFixture(domain)
    const graph = legacySnapshot(domain, [metadata({ payloadEncoding: 'base64', payloadBase64: original.payloadBase64 })])
    const entities = Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])) as CoreMigrationSourceDTO['entities']
    for (const row of graph.entities)
      entities[row.entityType]!.push({ legacyId: row.legacyId, name: row.name, references: row.references, amount: row.amount, attributes: row.attributes, deletedAt: row.deletedAt })
    const source: CoreMigrationSourceDTO = { contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: CORE_MIGRATION_SOURCE_VERSION, sourceHash: '', entities }
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const actor = { ...f.actor, capabilities: [...f.actor.capabilities, CORE_MIGRATION_CAPABILITY] }
    const envelope = (commandId: string) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    const core = createCoreMigrationTestInstance({ now: () => timestamp, createServerId: input => `central-${input.entityType}-${input.legacyId}`, afterConfirm: next => f.service.synchronizeMigrationSnapshot(next), afterRollback: next => f.service.synchronizeMigrationSnapshot(next) })
    const parse = (value: unknown) => parseCoreMigrationSourceCommand(value)
    const input = { ...envelope(`${domain}-parsed-preflight`), source, backup: null }
    expect(parse(input).source.entities[domain === 'construction' ? 'construction_contracts' : 'subcontract_contracts'][0]?.attributes?.attachmentsJson).toBe(JSON.stringify([metadata({ payloadEncoding: 'base64', payloadBase64: original.payloadBase64 })]))
    expect(() => parse({ ...input, source: { ...source, entities: { ...entities, [domain === 'construction' ? 'construction_contracts' : 'subcontract_contracts']: [{ ...entities[domain === 'construction' ? 'construction_contracts' : 'subcontract_contracts'][0], attributes: { privateDebugId: 'forbidden-extra' } }] } } })).toThrow(/未知字段/)
    await core.preflight(parse(input), actor)
    const digest = 'e'.repeat(64)
    const trial = await core.dryRun(parse({ ...envelope(`${domain}-parsed-dry-run`), source, backup: { backupId: `core-migration-${source.sourceHash}-${digest}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: digest, byteLength: 128, createdAt: timestamp, immutable: true } }), actor)
    await core.importBatch({ ...envelope(`${domain}-parsed-import`), batchId: trial.batchId }, actor)
    await core.confirm({ ...envelope(`${domain}-parsed-confirm`), batchId: trial.batchId }, actor)
    const id = `central-${domain === 'construction' ? 'construction_contracts' : 'subcontract_contracts'}-legacy-contract`
    expect(f.service.readFileContent(id, 'legacy-original', actor)).toMatchObject({ ownerId: id, payloadBase64: original.payloadBase64, sha256: 'f2b59b85ccc162ba3a4cb41ed108b42c83925a08cbab43fb4ab20637752f0a67' })
    await core.rollback({ ...envelope(`${domain}-parsed-safe-rollback`), batchId: trial.batchId }, actor)
    expect(core.snapshot(actor)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
    expect(() => f.service.readFileContent(id, 'legacy-original', actor)).toThrow(/不存在/)
  })
})

it.each(['construction', 'subcontract'] as const)('%s 真实HTTP提交、原件读取、删除恢复与正式门禁', async (domain) => {
  const f = await createSubcontractFixture()
  let storage = f.storage
  const formal = () => domain === 'construction' ? createProductionConstructionContractService(storage) : f.service
  let owner = formal()
  httpActor = f.session()
  let unavailable = false
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('getHeader', getHeader)
  vi.stubGlobal('getQuery', getQuery)
  vi.stubGlobal('getRouterParam', getRouterParam)
  vi.stubGlobal('readBody', readBody)
  vi.doMock('../../server/utils/production-auth', async importOriginal => ({ ...await importOriginal<typeof import('../../server/utils/production-auth')>(), requireProductionBusinessSession: () => httpActor }))
  vi.doMock('../../server/utils/production-runtime', async importOriginal => ({ ...await importOriginal<typeof import('../../server/utils/production-runtime')>(), productionSession: () => () => httpActor }))
  const runtimeModule = domain === 'construction' ? '../../server/utils/production-construction-contract-runtime' : '../../server/utils/production-subcontract-contract-runtime'
  const actualRuntime = () => {
    if (unavailable)
      throw new ProductionStorageProblem('实际正式合同owner尚未就绪；不读取开发原件')
    return { storage, contracts: owner }
  }
  vi.doMock(runtimeModule, () => domain === 'construction' ? { productionConstructionContractRuntime: actualRuntime } : { productionSubcontractContractRuntime: actualRuntime })
  const create = domain === 'construction' ? (await import('../../server/api/commands/construction-contracts.post')).default : (await import('../../server/api/commands/subcontract-contracts.post')).default
  const update = domain === 'construction' ? (await import('../../server/api/commands/construction-contracts/[id].put')).default : (await import('../../server/api/commands/subcontract-contracts/[id].put')).default
  const read = domain === 'construction' ? (await import('../../server/api/read/construction-contracts/[id]/files/[fileId].get')).default : (await import('../../server/api/read/subcontract-contracts/[id]/files/[fileId].get')).default
  const access = (await import('../../server/middleware/production-access')).default
  const unreadyDocuments = (await import('../../server/api/read/owner-documents/[kind].get')).default
  const devDocumentOwner = (await import('../../server/utils/owner-commercial-document-read-test-instance')).ownerCommercialDocumentReadTestInstance
  const devRead = vi.spyOn(devDocumentOwner, 'list')
  const ownerModule = domain === 'construction' ? await import('../../server/utils/construction-contract-command-test-instance') : await import('../../server/utils/subcontract-contract-command-test-instance')
  const devOwner = 'constructionContractCommandTestInstance' in ownerModule ? ownerModule.constructionContractCommandTestInstance : ownerModule.subcontractContractCommandTestInstance
  const devFile = vi.spyOn(devOwner, 'readFileContent')
  const root = `/api/commands/${domain}-contracts`
  const files = `/api/read/${domain}-contracts/:id/files/:fileId`
  const router = createRouter().post(root, create).put(`${root}/:id`, update).get(files, read).get('/api/read/owner-documents/:kind', unreadyDocuments)
  const app = createApp({ debug: false }).use(access).use(router)
  const server = createServer(toNodeListener(app)).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  vi.stubEnv('CRM_RUN_MODE', 'production')
  vi.stubEnv('CRM_DATA_DIRECTORY', f.options.directory)
  vi.stubEnv('CRM_WORKSPACE_ID', f.options.workspaceId)
  vi.stubEnv('CRM_OWNER_ID', f.options.ownerId)
  vi.stubEnv('CRM_DATA_PURPOSE', 'verification')
  vi.stubEnv('CRM_PUBLIC_ORIGIN', origin)
  vi.stubEnv('CRM_ACCESS_CODE_HASH', `scrypt$${'a'.repeat(32)}$${'a'.repeat(128)}`)
  vi.stubEnv('NITRO_HOST', '127.0.0.1')
  const request = (overrides: Partial<Pick<ConstructionContractCommandRequestDTO, 'id' | 'commandId' | 'baseVersion' | 'draft' | 'attachments'>> = {}) => domain === 'construction'
    ? { commandId: 'construction-http-create', workspaceId: f.options.workspaceId, actorId: f.options.ownerId, requiredCapability: 'construction-contract:write', baseVersion: null, action: 'save', draft: { name: 'HTTP正式主合同', no: 'HTTP-C21', projectId: f.project.id, customerId: f.customer.id, amount: 0, content: '真实正式原件范围', signDate: '2026-10-07', ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零' }, attachments: {}, ...overrides }
    : f.command(overrides)
  const send = (path: string, command: unknown, method = 'POST') => fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Origin': origin }, body: JSON.stringify(command) })
  try {
    const submitted = await send(root, request({ attachments: { add: [original, empty] } }))
    expect(submitted.status).toBe(200)
    const saved = await submitted.json() as { id: string, version: string, attachmentIds: string[] }
    const filePath = `/api/read/${domain}-contracts/${saved.id}/files/${saved.attachmentIds[0]}?origin=real`
    const result = await fetch(`${origin}${filePath}`)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.json()).toMatchObject({ ownerId: saved.id, fileId: saved.attachmentIds[0], payloadBase64: original.payloadBase64, sha256: 'f2b59b85ccc162ba3a4cb41ed108b42c83925a08cbab43fb4ab20637752f0a67' })
    expect((await fetch(`${origin}/api/read/${domain}-contracts/${saved.id}/files/${saved.attachmentIds[1]}?origin=real`)).status).toBe(200)
    expect((await fetch(`${origin}${filePath.replace('origin=real', 'origin=demo')}`)).status).toBe(403)
    expect((await fetch(`${origin}${filePath.replace(saved.id, 'another-owner')}`)).status).toBe(404)
    httpActor = { ...f.session(), capabilities: [`${domain}-contract:read`] }
    expect((await fetch(`${origin}${filePath}`)).status).toBe(200)
    httpActor = { ...f.session(), capabilities: [] }
    expect((await fetch(`${origin}${filePath}`)).status).toBe(403)
    httpActor = f.session()
    const baseForm = await owner.form(saved.id, () => httpActor)
    const removed = await send(`${root}/${saved.id}`, request({ id: saved.id, baseVersion: saved.version, commandId: `${domain}-http-remove`, draft: baseForm.draft, attachments: { removeIds: [saved.attachmentIds[0]!] } }), 'PUT')
    expect(removed.status).toBe(200)
    expect((await fetch(`${origin}${filePath}`)).status).toBe(404)
    const removedReceipt = await removed.json() as { version: string }
    const restored = await send(`${root}/${saved.id}`, request({ id: saved.id, baseVersion: removedReceipt.version, commandId: `${domain}-http-restore`, draft: baseForm.draft, attachments: { restoreIds: [saved.attachmentIds[0]!] } }), 'PUT')
    expect(restored.status).toBe(200)
    expect((await (await fetch(`${origin}${filePath}`)).json()).payloadBase64).toBe(original.payloadBase64)
    const rejected = await send(`${root}/${saved.id}`, request({ id: saved.id, baseVersion: '3', commandId: `${domain}-http-bad-bytes`, draft: baseForm.draft, attachments: { add: [{ ...original, payloadBase64: 'YQ' }] } }), 'PUT')
    expect(rejected.status).toBe(422)
    expect((await owner.form(saved.id, () => httpActor)).version).toBe('3')
    await storage.close()
    storage = createProductionStorage(f.options)
    owner = domain === 'construction' ? createProductionConstructionContractService(storage) : (await import('../../server/utils/production-subcontract-contract-service')).createProductionSubcontractContractService(storage)
    expect((await (await fetch(`${origin}${filePath}`)).json()).payloadBase64).toBe(original.payloadBase64)
    expect((await owner.form(saved.id, () => httpActor)).version).toBe('3')
    expect((await fetch(`${origin}/api/read/owner-documents/owner_report?origin=real`)).status).toBe(503)
    expect(devRead).not.toHaveBeenCalled()
    unavailable = true
    expect((await fetch(`${origin}${filePath}`)).status).toBe(503)
    expect(devFile).not.toHaveBeenCalled()
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await storage.close()
    devRead.mockRestore()
    devFile.mockRestore()
    vi.doUnmock(runtimeModule)
    vi.doUnmock('../../server/utils/production-runtime')
    vi.doUnmock('../../server/utils/production-auth')
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})
