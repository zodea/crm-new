import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollMigrationSource, seedReleasedPayrollMigrationSource } from '../helpers/payroll-migration-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
  vi.unstubAllGlobals()
})
it('公开迁入后经真实 HTTP/Repository 读冻结姓名、零分配、完整快照与无工资的独立来源', async () => {
  for (const key of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'createError'] as const)
    vi.stubGlobal(key, h3[key])
  const router = h3.createRouter()
  router.get('/api/read/payroll', (await import('../../server/api/read/payroll/index.get')).default)
  router.get('/api/read/payroll/sources', (await import('../../server/api/read/payroll/sources.get')).default)
  router.get('/api/read/payroll/:id', (await import('../../server/api/read/payroll/[id].get')).default)
  const app = h3.createApp()
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('测试地址未创建')
  const base = `http://127.0.0.1:${address.port}`
  const repo = createPayrollRepository(async (path, options) => {
    const url = new URL(path, base)
    Object.entries(options?.query ?? {}).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, String(value)))
    const response = await fetch(url)
    const result = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('工资 HTTP 请求失败'), { data: result.data ?? result })
    return result
  })
  const db = await createMemoryDb()
  try {
    expect((await repo.list({ origin: 'real' })).rows).toEqual([])
    const healthy = await seedReleasedPayrollMigrationSource(db)
    await seedPayrollMigrationSource(db)
    const source = await readQuantityCoreSource(db)
    const session = resolveBusinessSession()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('http-pay-preflight'), source, backup: null }), session)
    const hash = '8'.repeat(64)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('http-pay-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 412, createdAt: new Date().toISOString(), immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('http-pay-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('http-pay-confirm'), batchId: batch.batchId }, session)
    const list = await repo.list({ origin: 'real' })
    const row = list.rows.find(row => row.legacyId === healthy.statementId)!
    expect(row).toMatchObject({ actualAmount: 300, leaderName: '冻结时负责人', snapshot: { state: 'complete' } })
    const detail = await repo.detail({ origin: 'real', projectId: row.projectId }, row.id)
    expect(detail.statement.snapshot.raw).toBe(healthy.snapshot)
    expect(detail.statement.snapshot.originalRaw).toBe(healthy.snapshot)
    expect(detail.statement.lines[0]?.workerName).toBe('冻结时负责人')
    expect(detail.statement.allocations.map(row => row.amount)).toEqual([300, 0])
    expect(detail.statement.locks.some(lock => lock.workerId === detail.statement.members.find(member => !member.isLeader)?.workerId)).toBe(true)
    expect(detail.statement.stored.head.snapshot_json).toBe(healthy.snapshot)
    const independent = list.projects.find(project => project.name === '仅有工资来源的工程')!
    const sources = await repo.sources({ origin: 'real', projectId: independent.id })
    expect(sources.configs).toHaveLength(1)
    expect(sources.attendance[0]?.hours).toBe(0)
    expect(sources.daywork[0]?.status).toBe('draft')
    expect(sources.evidence[0]?.source.configs).toHaveLength(1)
    expect(list.rows.filter(row => row.projectId === independent.id)).toEqual([])
    expect((await fetch(`${base}/api/read/payroll?month=2026-99`)).status).toBe(400)
    expect((await fetch(`${base}/api/read/payroll/sources?origin=real`)).status).toBe(400)
    expect((await fetch(`${base}/api/read/payroll/${encodeURIComponent(row.id)}?origin=demo&includeDemo=true`)).status).toBe(403)
    expect((await fetch(`${base}/api/read/payroll?origin=demo`)).status).toBe(403)
    const wire = await (await fetch(`${base}/api/read/payroll/${encodeURIComponent(row.id)}?origin=real`)).json()
    expect(wire.statement.actualAmount).toBe('300.00')
    expect(wire.statement.snapshot.data.actualAmount).toBe(300)
    await expect(repo.detail({ origin: 'real', projectId: independent.id }, row.id)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  }
  finally {
    db.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
