import type { OurSignatorySnapshot } from '~/lib/our-signatory/contract'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { resolveContractSignatory } from '~/lib/our-signatory/storage'
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { contractMigratedSignatory } from '../../server/utils/contract-signatory-migration'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { writeOurSignatory } from '../../server/utils/our-signatory-owner'
import { developmentOurSignatoryOwner } from '../../server/utils/our-signatory-runtime'
import { createSubcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'
import { createMemoryDb } from '../helpers/memory-db'

const actor = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['construction-contract:read', 'construction-contract:write', 'subcontract-contract:read', 'subcontract-contract:write', 'our-signatory:write'] }
const directoryDraft = { name: '已核实公司', taxNo: 'tax-real', registeredAddress: null, legalRepresentative: null, verificationNote: '已核对营业执照原件', status: 'active' as const }
const domains = [
  { kind: 'construction-contract', create: createConstructionContractCommandTestInstance, extra: { customerId: 'customer-1' } },
  { kind: 'subcontract-contract', create: createSubcontractContractCommandTestInstance, extra: { supplierId: 'supplier-1', subKind: '劳务' } },
] as const

describe.each(domains)('$kind 采用真实我方签约主体', (domain) => {
  async function setup() {
    const scope = `signatory-${crypto.randomUUID()}`
    const sql = developmentOurSignatoryOwner(scope)
    const selected = await sql.withTransaction(tx => writeOurSignatory(tx, { ...actor, requiredCapability: 'our-signatory:write', commandId: 'directory-first', baseVersion: null, draft: directoryDraft }, actor))
    const resolve = vi.fn(async (draft: any, existing: any, required: boolean) => sql.withTransaction(tx => resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })))
    const owner = domain.create({ createId: () => 'contract-new', projects: [{ id: 'project-1', name: '项目', customerId: 'customer-1' }], customers: [{ id: 'customer-1', name: '客户' }], suppliers: [{ id: 'supplier-1', name: '分供方' }], resolveSignatory: resolve } as any)
    const request = { ...actor, requiredCapability: `${domain.kind}:write`, commandId: 'contract-first', baseVersion: null, action: 'submit', draft: { no: 'original-no', name: '原合同', projectId: 'project-1', ...domain.extra, content: '真实业务', signDate: '2026-10-04', amount: 100, ourSignatoryId: selected.id, ourSignatoryVersion: selected.version }, attachments: {} } as any
    return { scope, sql, selected, resolve, owner, request }
  }

  it('新提交采用目录真实快照，重放不再查目录，后来目录修改不改变已采用事实', async () => {
    const { sql, selected, resolve, owner, request } = await setup()
    const created = await owner.execute(request, actor)
    const adopted = owner.form(created.id, actor).draft.ourSignatorySnapshot
    expect(adopted).toMatchObject({ id: selected.id, version: '1', name: '已核实公司', verificationNote: directoryDraft.verificationNote })
    await sql.withTransaction(tx => writeOurSignatory(tx, { ...actor, id: selected.id, requiredCapability: 'our-signatory:write', commandId: 'directory-update', baseVersion: '1', draft: { ...directoryDraft, name: '目录当前名称' } }, actor))
    expect(await owner.execute(request, actor)).toEqual(created)
    expect(resolve).toHaveBeenCalledTimes(1)
    const update = { ...request, id: created.id, commandId: 'contract-update', baseVersion: created.version, action: 'save', draft: { ...owner.form(created.id, actor).draft, name: '合同修改', ourSignatorySnapshot: { ...adopted, name: '客户端伪造名称' } } }
    await owner.execute(update, actor)
    expect(owner.form(created.id, actor).draft.ourSignatorySnapshot).toEqual(adopted)
    expect(owner.rows()[0]?.ourSignatorySnapshot).toEqual(adopted)
  })

  it('未核实、错版本或不存在主体均不产生合同/附件，草稿可以明确未选', async () => {
    const { owner, request } = await setup()
    for (const { patch, message } of [
      { patch: { ourSignatoryId: null, ourSignatoryVersion: null }, message: '请选择实际我方签约主体' },
      { patch: { ourSignatoryVersion: '999' }, message: '我方主体资料已变化' },
      { patch: { ourSignatoryId: 'our-unknown' }, message: '所选我方主体不存在或已停用' },
    ]) {
      await expect(owner.execute({ ...request, commandId: crypto.randomUUID(), draft: { ...request.draft, ...patch } }, actor)).rejects.toThrow(message)
      expect(owner.rows()).toEqual([])
    }
    const saved = await owner.execute({ ...request, commandId: 'unselected-draft', action: 'draft', draft: { ...request.draft, ourSignatoryId: null, ourSignatoryVersion: null, ourSignatorySnapshot: { name: '伪造' } } }, actor)
    expect(owner.form(saved.id, actor).draft.ourSignatorySnapshot).toBeNull()
  })

  it('核验目录等待期间原编号封存后迟到命令不能落盘', async () => {
    const { owner, resolve, request } = await setup()
    let finish!: (value: OurSignatorySnapshot | null) => void
    resolve.mockImplementationOnce(() => new Promise((complete) => {
      finish = complete
    }))
    const pending = owner.execute(request, actor)
    await Promise.resolve()
    expect(owner.resolve(request.commandId, actor)).toEqual({ outcome: 'not-applied', commandId: request.commandId })
    finish(null)
    await expect(pending).rejects.toThrow('原命令已封存为未应用，迟到请求不能继续保存')
    expect(owner.rows()).toEqual([])
  })
})

describe('历史我方签约采用证据', () => {
  it('原party_a逐字保留为文本，不自动变身份；真实snapshot保ID/version，坏图拒绝', () => {
    const snapshot = { id: 'signatory-original', version: '2', name: '当时公司', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '当时核实' }
    const entity = { attributes: { legacyPartyA: '  原始名称\n旧备注  ', ourSignatoryId: snapshot.id, ourSignatorySnapshotJson: JSON.stringify(snapshot) } } as any
    const fail = (message: string): never => {
      throw new Error(message)
    }
    expect(contractMigratedSignatory(entity, fail)).toEqual({ legacyPartyA: entity.attributes.legacyPartyA, ourSignatoryId: snapshot.id, ourSignatoryVersion: '2', ourSignatorySnapshot: snapshot })
    expect(contractMigratedSignatory({ attributes: { legacyPartyA: '旧主体' } } as any, fail)).toMatchObject({ legacyPartyA: '旧主体', ourSignatorySnapshot: null, ourSignatoryId: null })
    for (const { patch, reason } of [
      { patch: { ourSignatoryId: 'other' }, reason: '迁入合同签约主体编号与当时采用快照不一致' },
      { patch: { ourSignatorySnapshotJson: 'null' }, reason: '迁入合同签约主体编号缺少当时采用快照，不能自动补当前目录' },
      { patch: { ourSignatorySnapshotJson: '{bad' }, reason: '迁入合同采用的签约主体快照损坏，不能推断或覆盖原资料' },
      { patch: { ourSignatorySnapshotJson: JSON.stringify({ ...snapshot, version: 2 }) }, reason: '迁入合同签约主体快照或身份损坏，不能改变历史采用事实' },
    ])
      expect(() => contractMigratedSignatory({ ...entity, attributes: { ...entity.attributes, ...patch } }, fail)).toThrow(reason)
  })

  it.each([52, 53])('真实 sqlite-v%i 经公开请求解析、整图确认保留原主体文本及当时快照', async (version) => {
    const db = await createMemoryDb()
    const snapshot: OurSignatorySnapshot = { id: 'signatory-source', version: '2', name: '当时公司', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '原始核实证据' }
    const legacyPartyA = '  原始主体\n不得猜目录映射  '
    try {
      await runMigrations(db, migrations.filter(migration => migration.version <= version))
      await db.execute(`INSERT INTO customers(id,name) VALUES('old-customer','来源客户')`)
      await db.execute(`INSERT INTO suppliers(id,name) VALUES('old-supplier','来源分供方')`)
      await db.execute(`INSERT INTO projects(id,name,customer_id) VALUES('old-project','来源项目','old-customer')`)
      for (const [id, kind] of [['old-construction', '施工'], ['old-subcontract', '分包']]) {
        await db.execute(`INSERT INTO contracts(id,no,name,kind,sub_kind,project_id,customer_id,supplier_id,party_a,amount,content,sign_date)
          VALUES(?,?,?,?,'劳务','old-project','old-customer','old-supplier',?,100,'真实来源合同内容','2026-10-01')`, [id, id, id, kind, legacyPartyA])
      }
      if (version >= 53) {
        await db.execute(`INSERT INTO our_signatories(id,draft_json,version,created_at,updated_at) VALUES(?,?,2,?,?)`, [snapshot.id, JSON.stringify(directoryDraft), '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'])
        await db.execute(`UPDATE contracts SET our_signatory_id=?,our_signatory_snapshot=?`, [snapshot.id, JSON.stringify(snapshot)])
      }
      const originalBytes = db.raw.export()
      async function unused(): Promise<never> {
        throw new Error('本例只读显式 SQLite 来源')
      }
      const source = await createCoreMigrationLocalSource({
        isDemoActive: () => false,
        currentSchemaVersion: async () => version,
        select: sql => db.select(sql),
        closeDatabase: unused,
        loadProductionSnapshot: unused,
        readSnapshotSource: unused,
        createBackup: unused,
        loadBackup: unused,
        restoreBackup: unused,
        activateMigration: unused,
        clearMigration: unused,
        prepareMigration: unused,
        loadMigrationMarker: unused,
        loadPendingMigrationMarker: unused,
        now: () => '2026-10-04T00:00:00.000Z',
      }).readSource()
      expect(source.sourceVersion).toBe(`sqlite-v${version}`)
      for (const entity of [...source.entities.construction_contracts, ...source.entities.subcontract_contracts]) {
        expect(entity.attributes?.legacyPartyA).toBe(legacyPartyA)
        expect(JSON.parse(String(entity.attributes?.ourSignatorySnapshotJson ?? 'null'))).toEqual(version >= 53 ? snapshot : null)
      }
      const construction = createConstructionContractCommandTestInstance()
      const subcontract = createSubcontractContractCommandTestInstance()
      const migrationActor = { ...actor, capabilities: [...actor.capabilities, CORE_MIGRATION_CAPABILITY] }
      const core = createCoreMigrationTestInstance({
        createServerId: entity => `central-${entity.entityType}-${entity.legacyId}`,
        prepareTransition: (next, _workspace, previous) => prepareCoreMigrationCommandSources(next, [construction, subcontract], [], previous),
      })
      const envelope = (commandId: string) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
      await core.preflight(parseCoreMigrationSourceCommand({ ...envelope('subject-preflight'), source, backup: null }), migrationActor)
      const snapshotSha256 = createHash('sha256').update(originalBytes).digest('hex')
      const batch = await core.dryRun(parseCoreMigrationSourceCommand({ ...envelope('subject-dry-run'), source, backup: {
        backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`,
        sourceHash: source.sourceHash,
        sourceVersion: source.sourceVersion,
        snapshotSha256,
        byteLength: originalBytes.byteLength,
        createdAt: '2026-10-04T00:00:00.000Z',
        immutable: true,
      } }), migrationActor)
      await core.importBatch({ ...envelope('subject-import'), batchId: batch.batchId }, migrationActor)
      expect(construction.rows()).toEqual([])
      expect(subcontract.rows()).toEqual([])
      const receipt = await core.confirm({ ...envelope('subject-confirm'), batchId: batch.batchId }, migrationActor)
      for (const [owner, id] of [[construction, 'central-construction_contracts-old-construction'], [subcontract, 'central-subcontract_contracts-old-subcontract']] as const) {
        expect(owner.form(id, actor).draft).toMatchObject({ legacyPartyA, ourSignatoryId: version >= 53 ? snapshot.id : null, ourSignatorySnapshot: version >= 53 ? snapshot : null })
      }
      expect(await core.resolve('subject-confirm', migrationActor)).toEqual({ outcome: 'applied', result: receipt })
      expect(createHash('sha256').update(db.raw.export()).digest('hex')).toBe(snapshotSha256)
      const cold = await createMemoryDb(originalBytes)
      try {
        expect(await cold.select('SELECT id,party_a FROM contracts ORDER BY id')).toEqual([
          { id: 'old-construction', party_a: legacyPartyA },
          { id: 'old-subcontract', party_a: legacyPartyA },
        ])
      }
      finally { cold.close() }
    }
    finally { db.close() }
  })
})
