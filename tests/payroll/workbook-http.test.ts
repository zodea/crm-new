import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollWorkbookFixture } from '../helpers/payroll-workbook-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollWorkbookFixture>>['archive'] | null }))
vi.mock('../../server/utils/payroll-workbook-runtime', () => ({ payrollWorkbookServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())

it('真实HTTP预览、归档、列表、冷读取及失响应核对往返，并拒绝多余请求字段', async () => {
  const f = await createPayrollWorkbookFixture()
  runtime.service = f.archive
  for (const name of ['defineEventHandler', 'getHeader', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.post('/api/read/payroll/workbook-preview', (await import('../../server/api/read/payroll/workbook-preview.post')).default)
  router.post('/api/read/payroll/workbook-archive', (await import('../../server/api/read/payroll/workbook-archive.post')).default)
  router.post('/api/read/payroll/workbook-archives', (await import('../../server/api/read/payroll/workbook-archives.post')).default)
  router.post('/api/commands/payroll-workbook', (await import('../../server/api/commands/payroll-workbook.post')).default)
  router.post('/api/commands/payroll-workbook-resolve', (await import('../../server/api/commands/payroll-workbook-resolve.post')).default)
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  let loseResponse = true
  const repo = createPayrollRepository(async (path, options) => {
    const response = await fetch(new URL(path, base), { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options?.body) })
    const result = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('目录请求失败'), { data: result.data ?? result })
    if (loseResponse && path === '/api/commands/payroll-workbook') {
      loseResponse = false
      throw new Error('response-lost-after-commit')
    }
    return result
  })
  try {
    await f.prepareRoster()
    const query = { origin: 'real' as const, projectId: 'p' }
    const preview = await repo.workbookPreview(query, f.input)
    expect(preview.groups[0]!.entries[0]!.document.actualAmount).toBe(525)
    expect(preview.deliveryGaps).toEqual([])
    const command = f.command(preview)
    await expect(repo.executeWorkbook(command)).rejects.toThrow()
    const recovered = await repo.resolveWorkbook(command.commandId, 'p')
    expect(recovered.state).toBe('applied')
    if (recovered.state !== 'applied')
      throw new Error('应读回原提交')
    expect(await repo.executeWorkbook(command)).toEqual(recovered.result)
    const archives = await repo.workbookArchives(query, { projectId: 'p' })
    expect(archives).toHaveLength(1)
    expect(archives[0]).toMatchObject({ id: recovered.result.archiveId, completeness: 'complete', version: 1 })
    const original = await repo.workbookArchive(query, { projectId: 'p', archiveId: recovered.result.archiveId })
    expect(original).toMatchObject({ completeness: 'complete', manifestHash: recovered.result.manifestHash, rosterRef: preview.rosterRef })
    expect(original.groups[0]!.entries[0]!.document.actualAmount).toBe(525)
    expect(JSON.stringify(original)).not.toContain('6222000000000001')
    const wire = await (await fetch(`${base}/api/read/payroll/workbook-archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, input: { projectId: 'p', archiveId: original.id } }) })).json()
    expect(wire.groups[0].entries[0].document.actualAmount).toBe('525.00')
    const malformed = await fetch(`${base}/api/commands/payroll-workbook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...command, privateBody: {} }) })
    expect(malformed.status).toBe(422)
    await expect(repo.workbookArchive(query, { projectId: 'other-project', archiveId: original.id })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    f.setArchiveSession({ ...f.getArchiveSession(), capabilities: [] })
    await expect(repo.workbookArchive(query, { projectId: 'p', archiveId: original.id })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(1)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)
