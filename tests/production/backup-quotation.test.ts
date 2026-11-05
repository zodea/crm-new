import type { QuotationCommand } from '~/lib/material-quotation/contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { createProductionMaterialQuotationOwner } from '../../server/utils/material-quotation-runtime'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const base = testTempRoot('root-a01-a03-validation')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'quotation-backup-'))
  const storage = createProductionStorage({ directory, workspaceId: 'quotation-backup-workspace', ownerId: 'quotation-backup-owner', purpose: 'verification' })
  try {
    const actor = { ...storage.identity, capabilities: ['material-quotation:read', 'material-quotation:write'] }
    const bytes = Buffer.from([0, 10, 128, 255])
    const command: QuotationCommand = {
      ...storage.identity,
      requiredCapability: 'material-quotation:write',
      commandId: 'quotation-backup-original',
      baseVersion: null,
      action: 'save',
      draft: {
        partyName: ' 未建档报价方原文\n',
        supplierId: null,
        projectId: null,
        scope: 'general',
        quotationDate: '2026-10-05',
        note: '原单条款',
        lines: [{ id: 'original-quotation-line', name: '原材料', spec: '原规格', grade: '', brand: '', unit: '米', unitPrice: 0, quantity: null, taxIncluded: null, taxRate: null, freight: null, quantityCondition: null, paymentCondition: null, validity: null }],
      },
      attachments: { add: [{ fileName: '报价原件.bin', fileSize: bytes.length, mimeType: 'application/octet-stream', payloadBase64: bytes.toString('base64') }] },
    }
    const owner = createProductionMaterialQuotationOwner(storage)
    const receipt = await owner.execute(command, () => actor)
    return { storage, directory, actor, bytes, command, owner, receipt }
  }
  catch (error) {
    await storage.close()
    throw error
  }
}

it('备份核验实际报价参与者、冻结原价、原件和原回执，隔离冷开沿原编号恢复', async () => {
  const f = await fixture()
  try {
    await f.owner.execute({ ...f.command, id: f.receipt.id, commandId: 'quotation-backup-revision', baseVersion: '1', draft: { ...f.command.draft, note: '后来条款', lines: [{ ...f.command.draft.lines[0]!, unitPrice: 23 }] }, attachments: {} }, () => f.actor)
    const backup = join(f.directory, 'cold-backup.sqlite')
    await f.storage.backupTo(backup)
    const inventory = await inspectProductionBackup(backup)
    expect(inventory.participants['material-quotations']).toEqual({ schemaVersion: 1, tables: ['quotation_revision', 'material_quotations', 'material_quotation_lines', 'material_quotation_history', 'material_quotation_commands', 'material_quotation_resolutions', 'material_quotation_files', 'quotation_imports'] })
    expect(inventory.originals).toEqual({ files: 1, bytes: 4 })
    expect(inventory.tables.material_quotation_history?.rows).toBe(2)
    expect(inventory.tables.material_quotation_commands?.rows).toBe(2)
    await f.storage.close()
    const reopened = createProductionStorage({ directory: f.directory, workspaceId: f.actor.workspaceId, ownerId: f.actor.actorId, purpose: 'verification' })
    try {
      const owner = createProductionMaterialQuotationOwner(reopened)
      expect(await owner.resolve(f.command.commandId, () => f.actor)).toEqual({ outcome: 'applied', result: f.receipt })
      const read = await owner.read(() => f.actor)
      expect(read.records[0]?.draft.lines[0]?.unitPrice).toBe(23)
      expect(read.records[0]?.history[0]?.draft.lines[0]?.unitPrice).toBe(0)
      expect(read.records[0]?.history[0]?.draft.lines[0]?.taxRate).toBeNull()
      expect(read.records[0]?.history[0]?.draft.partyName).toBe(' 未建档报价方原文\n')
      const original = await owner.original(f.receipt.id, f.receipt.attachmentIds[0]!, () => f.actor, '1')
      expect(Buffer.from(original.payloadBase64, 'base64')).toEqual(f.bytes)
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
})

it.each([
  ['头关系与原报价不一致', 'UPDATE material_quotations SET party_name=\'另一报价方\'', null],
  ['行原价与冻结资料不一致', 'UPDATE material_quotation_lines SET unit_price=99', null],
  ['原件精确归属失效', 'UPDATE file_refs SET owner_id=\'foreign-quotation\' WHERE owner_type=\'material_quotation\'', 'quotation_original_metadata'],
  ['原命令工作区失效', 'UPDATE material_quotation_commands SET workspace_id=\'foreign-workspace\'', 'quotation_command_update'],
  ['冻结历史正文被替换', 'UPDATE material_quotation_history SET snapshot_json=json_set(snapshot_json,\'$.draft.lines[0].unitPrice\',17)', 'quotation_history_update'],
])('报价备份拒绝%s，完整实表存在也不能冒充有效证据', async (_label, sql, guard) => {
  const f = await fixture()
  try {
    const backup = join(f.directory, 'corrupt-backup.sqlite')
    await f.storage.backupTo(backup)
    const db = new DatabaseSync(backup)
    try {
      let guardSql: string | null = null
      if (guard) {
        expect(() => db.exec(sql!)).toThrow(/immutable/)
        const definition = db.prepare('SELECT sql FROM sqlite_schema WHERE type=\'trigger\' AND name=?').get(guard)
        expect(typeof definition?.sql).toBe('string')
        guardSql = String(definition!.sql)
        // Only this isolated copied backup is deliberately damaged after proving the storage guard.
        db.exec(`DROP TRIGGER ${guard}`)
      }
      db.exec(sql!)
      if (guardSql)
        db.exec(guardSql)
    }
    finally { db.close() }
    await expect(inspectProductionBackup(backup)).rejects.toThrow('报价原明细、冻结历史、采用原件或原回执证据不完整。')
    expect((await f.owner.read(() => f.actor)).records[0]?.draft.lines[0]?.unitPrice).toBe(0)
  }
  finally { await f.storage.close() }
})

it('独立报价备份缺少冻结历史保护时拒绝发布，即使当前内容看似完整', async () => {
  const f = await fixture()
  try {
    const backup = join(f.directory, 'missing-history-guard.sqlite')
    await f.storage.backupTo(backup)
    const db = new DatabaseSync(backup)
    try {
      db.exec('DROP TRIGGER quotation_history_delete')
    }
    finally { db.close() }
    await expect(inspectProductionBackup(backup)).rejects.toThrow(/报价/)
    expect((await f.owner.read(() => f.actor)).records[0]?.history[0]?.draft.lines[0]?.unitPrice).toBe(0)
  }
  finally { await f.storage.close() }
})
