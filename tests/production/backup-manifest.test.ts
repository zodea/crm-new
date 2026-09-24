import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'

it('清单来自实际一致副本，覆盖客户原件/审计/回执，字节坏损或未知表拒绝', async () => {
  const base = resolve('.codex-tmp/issue-451-tests')
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
