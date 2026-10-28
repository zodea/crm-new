import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { createProductionProcessLibraryService } from '../../server/utils/production-process-library-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('工序库提交期间撤权完整回滚，已存原件证据损坏后明确拒绝读取和再保存', async () => {
  const base = testTempRoot('legacy-test-artifacts/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/boundary-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'boundary-workspace', ownerId: 'boundary-owner', purpose: 'verification' })
  const service = createProductionProcessLibraryService(storage)
  const authorized = () => ({ workspaceId: 'boundary-workspace', actorId: 'boundary-owner', capabilities: ['process-library:read', 'process-library:write'] })
  const command = { action: 'create-version', commandId: 'boundary-command', workspaceId: 'boundary-workspace', actorId: 'boundary-owner', origin: 'real', requiredCapability: 'process-library:write', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'BOUNDARY', name: '完整事务', description: '', tasks: [{ key: 'one', name: '一项完整工序', durationDays: 3, trade: '', color: '#123456', stageCode: '', itemCodes: [], predecessorKey: null, predecessorDisabled: false }] } }
  let reads = 0
  try {
    await expect(service.execute(command, () => ++reads === 1 ? authorized() : { ...authorized(), capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await service.catalog('real', authorized)).toMatchObject({ libraries: [], sourceVersion: '0' })
    const result = await service.execute(command, authorized)
    expect(result.version).toBe(1)
    await expect(service.detail(result.id, 'real', () => ({ ...authorized(), capabilities: [] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await storage.withTransaction(tx => tx.execute('UPDATE process_library_audits SET after_json=? WHERE version_id=?', ['{}', result.id]))
    await expect(service.catalog('real', authorized)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(service.execute(command, authorized)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await storage.close() }
})
