import type { PayrollADraft } from '../../app/lib/payroll/central-a-contract'
import type { PayrollARoundingCommand } from '../../app/lib/payroll/central-a-rounding-contract'
import type { PayrollBatchConfirmCommand } from '../../app/lib/payroll/central-batch-service-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollAServiceFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ get payrollService() {
  return runtime.service
} }))
afterEach(() => vi.unstubAllGlobals())

it('batch HTTP/Repository roundtrip binds preview, identity and immutable plan while rejecting altered commands', async () => {
  const f = await createPayrollAServiceFixture()
  runtime.service = f.service
  f.facts.rows = [payrollAFact({ ownershipKey: 'left', completionId: 'left-complete', assignmentId: 'left-assignment', workerId: 'w', fieldQty: 1 })]
  await f.config()
  await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
  const scope = { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId: 'w' }
  const config = await f.service.aConfig({ origin: 'real' }, scope)
  await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 750, scope: { kind: 'project' } }] }))
  const draft: PayrollADraft = { ...f.draft, memberWorkerIds: ['w', 'zero'], payRatio: 0.8 }
  const form = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'batch-http', draft })
  const saved = await f.service.execute(f.command(form, { kind: 'save-a-draft', draft }))
  const persisted = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
  await f.service.execute(f.command(persisted, { kind: 'check-a' }))
  const roundingScope = { projectId: 'p', leaderWorkerId: 'w', book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
  const rounding = await f.service.aRounding({ origin: 'real' }, roundingScope)
  const roundingCommand: PayrollARoundingCommand = { schemaVersion: 1, commandId: 'batch-http-round', workspaceId: rounding.context.workspaceId, actorId: rounding.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: rounding.context.sourceVersion, scope: roundingScope, action: { kind: 'save-a-rounding', rule: { kind: 'off' } } }
  await f.service.executeARounding(roundingCommand)

  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'readBody', 'createError'] as const)
    vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.post('/api/read/payroll/batch-preview', (await import('../../server/api/read/payroll/batch-preview.post')).default)
  router.get('/api/read/payroll/batch', (await import('../../server/api/read/payroll/batch.get')).default)
  router.post('/api/commands/payroll-batch', (await import('../../server/api/commands/payroll-batch.post')).default)
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  const repo = createPayrollRepository(async (path, options) => {
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value !== undefined)
        url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
    const result = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('工资请求失败'), { data: result.data ?? result })
    return result
  })
  try {
    const query = { origin: 'real' as const, projectId: 'p', month: '2026-08' }
    const input = { purpose: 'release' as const, projectId: 'p', month: '2026-08', statementIds: [saved.statementId!], fundingAmountFen: 60_000 }
    const preview = await repo.batchPreview(query, input)
    expect(preview.items[0]).toMatchObject({ eligibleAmountFen: 60_000, rounding: { state: 'configured', rule: { kind: 'off' } } })
    const command: PayrollBatchConfirmCommand = { schemaVersion: 1, commandId: 'batch-http-confirm', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: 'p', month: '2026-08', previewVersion: preview.previewVersion, fundingAmountFen: 60_000, items: [{ ...preview.items[0]!.target, decision: { kind: 'release', actualAmountFen: 60_000, allocations: preview.items[0]!.members.map((member, index) => ({ workerId: member.workerId, amountFen: index ? 0 : 60_000 })) } }] } } }
    const plan = await repo.executeBatch(command)
    expect(await repo.batch(query, plan.planId)).toEqual(plan)
    const changed = structuredClone(command)
    changed.action.input.fundingAmountFen = 59_999
    await expect(repo.executeBatch(changed)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const malformed = await fetch(`${base}/api/commands/payroll-batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...command, unknown: true }) })
    expect(malformed.status).toBe(422)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
})
