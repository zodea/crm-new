import type { SQLInputValue } from 'node:sqlite'
import type { QuotationCommand } from '~/lib/material-quotation/contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { ensureMaterialQuotationSchema } from '~/lib/material-quotation/schema-upgrade'
import { createQuotationOwner, validateQuotationJournal } from '~/lib/material-quotation/sqlite-owner'
import { createProductionMaterialQuotationOwner } from '../../server/utils/material-quotation-runtime'
import { createProductionStorage } from '../../server/utils/production-storage'

async function fixture() {
  const root = resolve('.tmp/a02-material-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'quotation-storage-'))
  const storage = createProductionStorage({ directory, workspaceId: 'quote-workspace', ownerId: 'quote-actor', purpose: 'verification' })
  let actor = { workspaceId: 'quote-workspace', actorId: 'quote-actor', capabilities: ['material-quotation:read', 'material-quotation:write', 'project:list:read', 'supplier:list:read'] }
  const session = () => actor
  const owner = createProductionMaterialQuotationOwner(storage)
  const draft = { ...newQuotationDraft(), partyName: '原未建档报价方', lines: [{ ...newQuotationDraft().lines[0]!, id: 'quote-line-real', name: '材料原件行', unit: '吨', unitPrice: 0, taxRate: null }] }
  const request: QuotationCommand = { ...actor, requiredCapability: 'material-quotation:write', commandId: 'quote-command-original', baseVersion: null, action: 'save', draft, attachments: { add: [{ fileName: '真实原报价.txt', mimeType: 'text/plain', fileSize: 3, payloadBase64: 'YWJj' }] } }
  delete (request as unknown as Record<string, unknown>).capabilities
  return { directory, storage, owner, request, session, actor: () => actor, changeActor: (next: typeof actor) => {
    actor = next
  } }
}
describe('真实独立报价存储', () => {
  it('实际整图落库、重复点击、冷重启与原回执恢复保留原ID/原价/原件', async () => {
    const f = await fixture()
    try {
      const saved = await f.owner.execute(f.request, f.session)
      expect(await f.owner.execute(f.request, f.session)).toEqual(saved)
      expect(await f.storage.select('SELECT COUNT(*) AS n FROM suppliers')).toEqual([{ n: 0 }])
      expect(await f.storage.select('SELECT COUNT(*) AS n FROM projects')).toEqual([{ n: 0 }])
      await f.storage.close()
      const read = await f.owner.read(f.session)
      expect(read.records).toHaveLength(1)
      expect(read.records[0]).toMatchObject({ id: saved.id, version: '1', draft: { partyName: '原未建档报价方', supplierId: null, projectId: null, scope: 'unknown', quotationDate: null, lines: [{ id: 'quote-line-real', unitPrice: 0, taxRate: null }] } })
      expect(await f.owner.resolve(f.request.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
      expect(await f.owner.original(saved.id, saved.attachmentIds[0]!, f.session)).toMatchObject({ ownerId: saved.id, fileId: saved.attachmentIds[0], fileSize: 3, payloadBase64: 'YWJj', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })
      await expect(f.owner.execute({ ...f.request, draft: { ...f.request.draft, note: '另一完整请求' } }, f.session)).rejects.toThrow('不同内容')
    }
    finally {
      await f.storage.close()
    }
  })
  it('修改冻结旧价格/旧原件，当前删除原件后仍能按历史版本读原文', async () => {
    const f = await fixture()
    try {
      const first = await f.owner.execute(f.request, f.session)
      await f.owner.execute({ ...f.request, id: first.id, baseVersion: '1', commandId: 'quote-revision-two', draft: { ...f.request.draft, partyName: '后来更名原文', lines: [{ ...f.request.draft.lines[0]!, unitPrice: 50, taxRate: 0 }] }, attachments: { removeIds: first.attachmentIds } }, f.session)
      await f.storage.close()
      const record = (await f.owner.read(f.session)).records[0]!
      expect(record.history.map(history => [history.version, history.draft.partyName, history.draft.lines[0]!.unitPrice, history.draft.lines[0]!.taxRate])).toEqual([['1', '原未建档报价方', 0, null], ['2', '后来更名原文', 50, 0]])
      await expect(f.owner.original(first.id, first.attachmentIds[0]!, f.session)).rejects.toThrow('此版本')
      expect((await f.owner.original(first.id, first.attachmentIds[0]!, f.session, '1')).payloadBase64).toBe('YWJj')
      await expect(f.storage.execute('UPDATE material_quotation_history SET snapshot_json=\'{}\'')).rejects.toThrow('immutable')
      await expect(f.storage.execute('DELETE FROM material_quotation_lines')).rejects.toThrow('retained')
      await expect(f.storage.execute('UPDATE file_payloads SET content=?', [new Uint8Array([0])])).rejects.toThrow('immutable')
      await expect(f.storage.execute('DELETE FROM material_quotations')).rejects.toThrow('retained')
    }
    finally {
      await f.storage.close()
    }
  })
  it('版本冲突不覆盖现行图，原编号封存后迟到请求不能写入', async () => {
    const f = await fixture()
    try {
      const saved = await f.owner.execute(f.request, f.session)
      const newer = { ...f.request, id: saved.id, baseVersion: '1', commandId: 'quote-newer', attachments: {}, draft: { ...f.request.draft, note: '当前已保存' } }
      await f.owner.execute(newer, f.session)
      const stale = { ...newer, commandId: 'quote-stale', draft: { ...newer.draft, note: '不能覆盖' } }
      await expect(f.owner.execute(stale, f.session)).rejects.toThrow('已被更新')
      expect(await f.owner.resolve(stale.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: stale.commandId })
      await f.storage.close()
      await expect(f.owner.execute({ ...stale, baseVersion: '2' }, f.session)).rejects.toThrow('迟到')
      expect((await f.owner.read(f.session)).records[0]!.draft.note).toBe('当前已保存')
    }
    finally {
      await f.storage.close()
    }
  })
  it('不完整原件导致整图事务回滚，没有假回执或半个报价', async () => {
    const f = await fixture()
    try {
      await expect(f.owner.execute({ ...f.request, attachments: { add: [{ fileName: '无正文', fileSize: 3 }] } }, f.session)).rejects.toThrow('原件')
      expect((await f.owner.read(f.session)).records).toEqual([])
      for (const table of ['material_quotations', 'material_quotation_lines', 'material_quotation_history', 'file_refs', 'file_payloads', 'material_quotation_commands'])
        expect(await f.storage.select(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }])
    }
    finally {
      await f.storage.close()
    }
  })
  it('选择必须来自真实目录，不猜同名；不借其他报价行/原件身份', async () => {
    const f = await fixture()
    try {
      await expect(f.owner.execute({ ...f.request, draft: { ...f.request.draft, supplierId: 'missing-supplier' } }, f.session)).rejects.toThrow('真实来源')
      const first = await f.owner.execute(f.request, f.session)
      await expect(f.owner.execute({ ...f.request, commandId: 'other-quotation' }, f.session)).rejects.toThrow('另一报价')
      const second = await f.owner.execute({ ...f.request, commandId: 'second-quotation', draft: { ...f.request.draft, lines: [{ ...f.request.draft.lines[0]!, id: 'other-original-line' }] }, attachments: {} }, f.session)
      await expect(f.owner.execute({ ...f.request, id: second.id, baseVersion: '1', commandId: 'cross-original', draft: { ...f.request.draft, lines: [{ ...f.request.draft.lines[0]!, id: 'other-original-line' }] }, attachments: { removeIds: first.attachmentIds } }, f.session)).rejects.toThrow('不属于')
      expect((await f.owner.read(f.session)).records).toHaveLength(2)
    }
    finally {
      await f.storage.close()
    }
  })
  it.each(['party_name', 'scope', 'quotation_date'])('头索引 %s 与原文冲突时明确拒绝读取', async (column) => {
    const f = await fixture()
    try {
      await f.owner.execute(f.request, f.session)
      await f.storage.execute(`UPDATE material_quotations SET ${column}=?`, [column === 'scope' ? 'general' : '冲突索引'])
      await expect(f.owner.read(f.session)).rejects.toThrow('头索引')
    }
    finally {
      await f.storage.close()
    }
  })
  it.each(['unit', 'unit_price', 'tax_rate'])('行索引 %s 与原价冲突时拒绝，NULL不变0', async (column) => {
    const f = await fixture()
    try {
      await f.owner.execute(f.request, f.session)
      await f.storage.execute(`UPDATE material_quotation_lines SET ${column}=?`, [column === 'unit' ? '另一单位' : 9])
      await expect(f.owner.read(f.session)).rejects.toThrow('索引字段')
    }
    finally {
      await f.storage.close()
    }
  })
  it('读写身份不匹配/无写权限均拒绝，事务中身份切换撤回', async () => {
    const f = await fixture()
    try {
      const trusted = f.actor()
      f.changeActor({ ...trusted, actorId: 'another-actor' })
      await expect(f.owner.read(f.session)).rejects.toThrow('当前身份')
      f.changeActor({ ...trusted, capabilities: ['material-quotation:read'] })
      await expect(f.owner.execute(f.request, f.session)).rejects.toThrow('权限')
      f.changeActor(trusted)
      const changing = createQuotationOwner(f.storage, { payloadMode: 'central', references: async () => {
        f.changeActor({ ...trusted, capabilities: [] })
        return { projects: [], suppliers: [] }
      } })
      await expect(changing.execute(f.request, f.session)).rejects.toThrow('权限')
      f.changeActor(trusted)
      expect((await f.owner.read(f.session)).records).toEqual([])
    }
    finally {
      await f.storage.close()
    }
  })
})
describe('native58结构恢复边界', () => {
  function native(path = ':memory:') {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);CREATE TABLE IF NOT EXISTS file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),encoding TEXT,content TEXT);')
    const coordinator = createDbCoordinator(async () => ({ async execute(sql, params) {
      if (params)
        db.prepare(sql).run(...params as SQLInputValue[])
      else
        db.exec(sql)
    }, async select<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params as SQLInputValue[]) as T[]
    }, async close() {
      db.close()
    } }))
    return coordinator
  }
  it('结构commit但版本尚未登记后重开，完整同形图只核验不清空', async () => {
    const db = native()
    try {
      await db.withTransaction(ensureMaterialQuotationSchema)
      await db.withTransaction(ensureMaterialQuotationSchema)
      const actor = { workspaceId: 'synthetic-native-workspace', actorId: 'synthetic-native-owner', capabilities: ['material-quotation:read', 'material-quotation:write'] }
      const owner = createQuotationOwner({ ...db, identity: actor, assertBusinessWrite() {
      } }, { payloadMode: 'native', references: async () => ({ projects: [], suppliers: [] }) })
      const draft = { ...newQuotationDraft(), partyName: '实际合成原文', lines: [{ ...newQuotationDraft().lines[0]!, name: '合成材料', unit: '米', unitPrice: 0 }] }
      const saved = await owner.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-quotation:write', commandId: 'native-original-command', baseVersion: null, action: 'save', draft, attachments: { add: [{ fileName: '原件.txt', fileSize: 0, payloadBase64: '' }] } }, () => actor)
      await db.withTransaction(ensureMaterialQuotationSchema)
      expect((await owner.read(() => actor)).records[0]!.id).toBe(saved.id)
      expect((await owner.original(saved.id, saved.attachmentIds[0]!, () => actor)).fileSize).toBe(0)
      await db.withTransaction(validateQuotationJournal)
    }
    finally {
      await db.close()
    }
  })
  it('部分结构保留现有内容并明确拒绝，不重建覆盖', async () => {
    const db = native()
    try {
      await db.execute('CREATE TABLE material_quotations(id TEXT PRIMARY KEY,note TEXT)')
      await db.execute('INSERT INTO material_quotations VALUES(?,?)', ['original-existing', '需要保全'])
      await expect(db.withTransaction(ensureMaterialQuotationSchema)).rejects.toThrow('部分缺失')
      expect(await db.select('SELECT * FROM material_quotations')).toEqual([{ id: 'original-existing', note: '需要保全' }])
    }
    finally {
      await db.close()
    }
  })
  it('物理库commit后、版本登记前中断并冷开，历史原件和封存原编号均保全', async () => {
    const root = resolve('.tmp/a02-material-tests')
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(join(root, 'quotation-native-cold-'))
    const path = join(directory, 'synthetic-native.sqlite')
    let db = native(path)
    const actor = { workspaceId: 'native-cold-synthetic-workspace', actorId: 'native-cold-synthetic-owner', capabilities: ['material-quotation:read', 'material-quotation:write'] }
    const owner = () => createQuotationOwner({ ...db, identity: actor, assertBusinessWrite() {
    } }, { payloadMode: 'native', references: async () => ({ projects: [], suppliers: [] }) })
    try {
      await db.withTransaction(ensureMaterialQuotationSchema)
      const draft = { ...newQuotationDraft(), partyName: '冷开保全原文', lines: [{ ...newQuotationDraft().lines[0]!, id: 'native-cold-original-line', name: '冷开材料', unit: '米', unitPrice: 0 }] }
      const saved = await owner().execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-quotation:write', commandId: 'native-cold-original-command', baseVersion: null, action: 'save', draft, attachments: { add: [{ fileName: '原件.txt', fileSize: 3, payloadBase64: 'YWJj' }] } }, () => actor)
      await owner().resolve('native-cold-sealed-command', () => actor)
      await db.close()
      db = native(path)
      await db.withTransaction(ensureMaterialQuotationSchema)
      expect(await owner().resolve('native-cold-original-command', () => actor)).toEqual({ outcome: 'applied', result: saved })
      expect(await owner().resolve('native-cold-sealed-command', () => actor)).toEqual({ outcome: 'not-applied', commandId: 'native-cold-sealed-command' })
      expect((await owner().read(() => actor)).records[0]!.history[0]!.draft.lines[0]).toMatchObject({ id: 'native-cold-original-line', unitPrice: 0, taxRate: null })
      expect((await owner().original(saved.id, saved.attachmentIds[0]!, () => actor, '1')).payloadBase64).toBe('YWJj')
      await db.execute('DROP TRIGGER quotation_history_update')
      await expect(db.withTransaction(ensureMaterialQuotationSchema)).rejects.toThrow('部分缺失')
      expect(await db.select('SELECT COUNT(*) AS n FROM material_quotation_history')).toEqual([{ n: 1 }])
      expect(await db.select('SELECT COUNT(*) AS n FROM file_payloads')).toEqual([{ n: 1 }])
    }
    finally {
      await db.close()
    }
  })
})
