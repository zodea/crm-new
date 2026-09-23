import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_SCHEMA } from '../../server/utils/production-storage-schema'

it('既有客户v1库经同事务升级加入工序库与分供方，客户参与者和原事实不被替换', async () => {
  const base = resolve('.codex-tmp/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/upgrade-`)
  const raw = new DatabaseSync(join(directory, 'ruihang.sqlite'))
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  raw.prepare('INSERT INTO production_metadata VALUES(1,1,?,?,?,?)').run('upgrade-workspace', 'upgrade-owner', 'verification', '2026-09-22T00:00:00.000Z')
  raw.exec('CREATE TABLE preserved_specimen(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  raw.prepare('INSERT INTO preserved_specimen VALUES(?,?)').run('existing-fact', '客户库既有事实')
  raw.close()
  const storage = createProductionStorage({ directory, workspaceId: 'upgrade-workspace', ownerId: 'upgrade-owner', purpose: 'verification' })
  try {
    expect(await storage.status()).toMatchObject({ schemaVersion: 4, participants: ['customer', 'process-library', 'project', 'supplier'] })
    expect(await storage.select('SELECT * FROM preserved_specimen')).toEqual([{ id: 'existing-fact', value: '客户库既有事实' }])
    expect(await storage.select('SELECT * FROM production_participants ORDER BY domain')).toEqual([{ domain: 'customer', schema_version: 1 }, { domain: 'process-library', schema_version: 1 }, { domain: 'project', schema_version: 1 }, { domain: 'supplier', schema_version: 1 }])
  }
  finally { await storage.close() }
})

it('升级中途失败保持旧版本和完整旧参与者，未知参与者不会被自动抹掉', async () => {
  const base = resolve('.codex-tmp/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/failed-upgrade-`)
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  raw.prepare('INSERT INTO production_metadata VALUES(1,1,?,?,?,?)').run('upgrade-workspace', 'upgrade-owner', 'verification', '2026-09-22T00:00:00.000Z')
  raw.exec('CREATE TABLE process_library_command_receipts(synthetic TEXT)')
  raw.close()
  const options = { directory, workspaceId: 'upgrade-workspace', ownerId: 'upgrade-owner', purpose: 'verification' as const }
  await expect(createProductionStorage(options).status()).rejects.toThrow('无法初始化')
  const inspected = new DatabaseSync(path)
  try {
    expect(inspected.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(1)
    expect(inspected.prepare('SELECT * FROM production_participants').all()).toEqual([{ domain: 'customer', schema_version: 1 }])
    expect(inspected.prepare('SELECT name FROM sqlite_master WHERE name IN (?,?)').all('process_library_revision', 'process_library_versions')).toEqual([])
    inspected.exec('DROP TABLE process_library_command_receipts')
    inspected.exec('INSERT INTO production_participants VALUES (\'unknown-domain\',1)')
  }
  finally { inspected.close() }
  await expect(createProductionStorage(options).status()).rejects.toThrow('参与者清单')
})

it('参与者登记仍在但实际审计表缺失时，冷打开明确拒绝而非报告已就绪', async () => {
  const base = resolve('.codex-tmp/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/missing-table-`)
  const options = { directory, workspaceId: 'missing-table-workspace', ownerId: 'missing-table-owner', purpose: 'verification' as const }
  const first = createProductionStorage(options)
  await first.status()
  await first.close()
  const raw = new DatabaseSync(join(directory, 'ruihang.sqlite'))
  raw.exec('DROP TABLE customer_audits')
  raw.close()
  await expect(createProductionStorage(options).status()).rejects.toThrow('业务表')
})
