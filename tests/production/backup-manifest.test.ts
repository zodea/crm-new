import { Buffer } from 'node:buffer'
import { copyFile, lstat, mkdir, mkdtemp } from 'node:fs/promises'
import { join, toNamespacedPath } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { backupDigest, backupFileDigest, inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('清单来自实际一致副本，覆盖客户原件/审计/回执，字节坏损或未知表拒绝', async () => {
  const base = testTempRoot('legacy-test-artifacts/issue-451-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/manifest-`)
  const identity = { workspaceId: 'backup-workspace', ownerId: 'backup-owner', purpose: 'verification' as const }
  const storage = createProductionStorage({ ...identity, directory })
  const session = () => ({ workspaceId: identity.workspaceId, actorId: identity.ownerId, capabilities: ['customer:write', 'customer:list:read', 'customer:original:write'] })
  const bytes = Buffer.from('合成原件正文')
  const services = createProductionCustomerService(storage)
  try {
    await services.execute({ commandId: 'backup-customer-first', workspaceId: identity.workspaceId, actorId: identity.ownerId, requiredCapability: 'customer:write', action: 'draft', baseVersion: null, draft: { name: '备份合成客户', aliases: [] }, attachments: { add: [{ fileName: '合成.txt', fileSize: bytes.length, mimeType: 'text/plain', category: '合同', contentBase64: bytes.toString('base64') }] } }, session, null)
    const path = join(directory, 'snapshot.sqlite')
    await storage.backupTo(path)
    const manifest = await inspectProductionBackup(path)
    expect(manifest.workspaceId).toBe(identity.workspaceId)
    expect(manifest.tables.customers?.rows).toBe(1)
    expect(manifest.tables.customer_command_receipts?.rows).toBe(1)
    expect(manifest.tables.customer_audits?.rows).toBe(1)
    expect(manifest.originals).toEqual({ files: 1, bytes: bytes.length })
    expect(JSON.stringify(manifest)).not.toContain('备份合成客户')
    const missingPath = join(directory, 'missing-body.sqlite')
    await storage.backupTo(missingPath)
    const missing = new DatabaseSync(missingPath)
    missing.exec('DELETE FROM file_payloads')
    missing.close()
    await expect(inspectProductionBackup(missingPath)).rejects.toThrow('缺少正文')
    const corrupt = new DatabaseSync(path)
    corrupt.prepare('UPDATE file_payloads SET content=?').run(Buffer.from('损坏'))
    corrupt.close()
    await expect(inspectProductionBackup(path)).rejects.toThrow('原件')
    const other = join(directory, 'unknown.sqlite')
    await storage.backupTo(other)
    const unknown = new DatabaseSync(other)
    unknown.exec('CREATE TABLE unregistered_fact(id TEXT PRIMARY KEY)')
    unknown.close()
    await expect(inspectProductionBackup(other)).rejects.toThrow('清单')
  }
  finally { await storage.close() }
})

async function longPathBackup() {
  const base = testTempRoot('a02-clearance-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'manifest-long-path-'))
  const identity = { workspaceId: 'long-backup-workspace', ownerId: 'long-backup-owner', purpose: 'verification' as const }
  const storage = createProductionStorage({ ...identity, directory })
  const session = () => ({ workspaceId: identity.workspaceId, actorId: identity.ownerId, capabilities: ['customer:write', 'customer:list:read', 'customer:original:write'] })
  const bytes = Buffer.from('真实合成原件\u0000中文备份')
  const service = createProductionCustomerService(storage)
  const firstRequest = { commandId: 'long-path-create', workspaceId: identity.workspaceId, actorId: identity.ownerId, requiredCapability: 'customer:write', action: 'draft', baseVersion: null, draft: { name: '初始合成客户', aliases: [] }, attachments: { add: [{ fileName: '原件.txt', fileSize: bytes.length, mimeType: 'text/plain', category: '合同', contentBase64: bytes.toString('base64') }] } }
  let first
  let saved
  const shortPath = join(directory, 'completed.sqlite')
  try {
    first = await service.execute(firstRequest, session, null)
    saved = await service.execute({ ...firstRequest, id: first.id, commandId: 'long-path-update', baseVersion: first.version, draft: { name: '已提交合成客户', aliases: ['原名称'] }, attachments: {} }, session, first.id)
    expect(saved.version).toBe('2')
    expect(saved.attachmentIds).toEqual(first.attachmentIds)
    await storage.backupTo(shortPath)
  }
  finally { await storage.close() }
  const standalone = new DatabaseSync(toNamespacedPath(shortPath))
  try {
    standalone.exec('PRAGMA journal_mode=DELETE')
  }
  finally { standalone.close() }
  const expected = await inspectProductionBackup(shortPath)
  let longDirectory = directory
  while (join(longDirectory, '完整数据库.sqlite').length <= 280)
    longDirectory = join(longDirectory, '中文独立备份及原件历史核验')
  await mkdir(longDirectory, { recursive: true })
  const path = join(longDirectory, '完整数据库.sqlite')
  await copyFile(shortPath, path)
  const stat = await lstat(path)
  expect(path.length).toBeGreaterThan(260)
  expect(path.startsWith('\\\\')).toBe(false)
  expect(stat.isFile()).toBe(true)
  expect(stat.isSymbolicLink()).toBe(false)
  return { path, bytes, expected, first, saved }
}

it('超过260字符的中文普通备份路径可只读核验，原数据/原件/两版审计/回执及文件摘要不变', async () => {
  const f = await longPathBackup()
  const before = await backupFileDigest(f.path)
  expect(await inspectProductionBackup(f.path)).toEqual(f.expected)
  expect(await backupFileDigest(f.path)).toBe(before)
  const raw = new DatabaseSync(toNamespacedPath(f.path), { readOnly: true })
  try {
    expect(raw.prepare('SELECT id,name,version,aliases FROM customers').all()).toEqual([{ id: f.saved.id, name: '已提交合成客户', version: 2, aliases: '["原名称"]' }])
    const audits = raw.prepare('SELECT command_id,before_json,after_json FROM customer_audits ORDER BY command_id').all()
    expect(audits).toHaveLength(2)
    expect(audits[0]?.command_id).toBe('long-path-create')
    expect(audits[0]?.before_json).toBeNull()
    expect(JSON.parse(String(audits[0]?.after_json))).toMatchObject({ id: f.first.id, name: '初始合成客户' })
    expect(audits[1]?.command_id).toBe('long-path-update')
    expect(JSON.parse(String(audits[1]?.before_json))).toMatchObject({ id: f.first.id, name: '初始合成客户' })
    expect(JSON.parse(String(audits[1]?.after_json))).toMatchObject({ id: f.saved.id, name: '已提交合成客户' })
    const receipts = raw.prepare('SELECT command_id,result_json FROM customer_command_receipts ORDER BY command_id').all()
    expect(receipts.map(row => [row.command_id, JSON.parse(String(row.result_json))])).toEqual([['long-path-create', f.first], ['long-path-update', f.saved]])
    const original = raw.prepare('SELECT r.id,r.owner_id,r.file_size,p.content,p.sha256 FROM file_refs r JOIN file_payloads p ON p.file_ref_id=r.id').get()
    expect(original).toMatchObject({ id: f.first.attachmentIds[0], owner_id: f.saved.id, file_size: f.bytes.length, sha256: backupDigest(f.bytes) })
    expect(Buffer.from(original!.content as Uint8Array)).toEqual(f.bytes)
  }
  finally { raw.close() }
  expect(await backupFileDigest(f.path)).toBe(before)
})

it.each(['missing', 'corrupt'] as const)('中文长路径的%s原件仍拒绝发布且检查不会改写坏副本', async (damage) => {
  const f = await longPathBackup()
  const raw = new DatabaseSync(toNamespacedPath(f.path))
  try {
    if (damage === 'missing')
      raw.exec('DELETE FROM file_payloads')
    else raw.prepare('UPDATE file_payloads SET content=?').run(Buffer.from('损坏'))
  }
  finally { raw.close() }
  const damagedDigest = await backupFileDigest(f.path)
  await expect(inspectProductionBackup(f.path)).rejects.toThrow(damage === 'missing' ? '缺少正文' : '原件')
  expect(await backupFileDigest(f.path)).toBe(damagedDigest)
})
