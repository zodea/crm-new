import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { decodePayrollAdjustmentRead } from '~/lib/payroll/central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from '~/lib/payroll/central-adjustment-wire'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollAdjustmentFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ payrollServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())

it('真实 HTTP 完成独立更正、退40及错记冲销，所有有符号实额以到分十进制传输', async () => {
  const f = await createPayrollAdjustmentFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const router = h3.createRouter()
  router.post('/api/read/payroll/adjustment-form', (await import('../../server/api/read/payroll/adjustment-form.post')).default)
  router.post('/api/read/payroll/adjustment-detail', (await import('../../server/api/read/payroll/adjustment-detail.post')).default)
  router.post('/api/read/payroll/adjustment-history', (await import('../../server/api/read/payroll/adjustment-history.post')).default)
  router.post('/api/read/payroll/actual-payment-form', (await import('../../server/api/read/payroll/actual-payment-form.post')).default)
  router.post('/api/read/payroll/actual-payment-detail', (await import('../../server/api/read/payroll/actual-payment-detail.post')).default)
  router.post('/api/read/payroll/actual-reversal-form', (await import('../../server/api/read/payroll/actual-reversal-form.post')).default)
  router.post('/api/read/payroll/actual-ledger', (await import('../../server/api/read/payroll/actual-ledger.post')).default)
  router.post('/api/commands/payroll-adjustment', (await import('../../server/api/commands/payroll-adjustment.post')).default)
  const server = createServer(h3.toNodeListener(h3.createApp().use(router)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  const wire: unknown[] = []
  const repo = createPayrollRepository(async (path, options) => {
    const response = await fetch(`${base}${path}`, { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: options?.body ? JSON.stringify(options.body) : undefined })
    const value = await response.json()
    wire.push(value)
    if (!response.ok)
      throw Object.assign(new Error('请求失败'), { data: value.data ?? value })
    return value
  })
  try {
    const target = { adjustmentId: null, draftKey: 'http-correction', originalStatementId: f.statementId } as const
    const initial = await repo.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('须提供原C2依据')
    const draft = { ...initial.draft, reason: '单价误录', evidenceNote: '经办人与负责人核对原价900', basis: { ...initial.draft.basis, unitRate: 900 } }
    const preview = await repo.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(wire.at(-1)).toMatchObject({ preview: { delta: { value: '-100.00' } } })
    const saved = await repo.executeAdjustment(f.adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    const read = await repo.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    await repo.executeAdjustment(f.adjustmentCommand(read, { kind: 'confirm-adjustment' }))
    expect((await repo.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)).balance.remainingDelta.value).toBe(-100)
    const unpaidHistory = await repo.adjustmentHistory({ origin: 'real' }, f.statementId)
    expect(unpaidHistory.adjustments).toMatchObject([{ adjustment: { id: saved.adjustmentId, status: 'confirmed' }, balance: { remainingDelta: { value: -100 } } }])
    expect(unpaidHistory.applications).toEqual([])
    const actualCommand = await f.paymentCommand(saved.adjustmentId!, -40)
    const actualForm = await repo.actualPaymentForm({ origin: 'real' }, { target: actualCommand.target, draft: actualCommand.action.payment })
    expect(actualForm.eligibility.canConfirmActual).toBe(true)
    const paid = await repo.executeAdjustment({ ...actualCommand, sourceVersion: actualForm.context.sourceVersion })
    expect((await repo.actualPaymentDetail({ origin: 'real' }, paid.actualEventId!)).fact.signedAmount.value).toBe(-40)
    expect(wire.at(-1)).toMatchObject({ fact: { signedAmount: { value: '-40.00' } } })
    expect((await repo.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(960)
    const reversalTarget = { kind: 'recording-reversal' as const, draftKey: 'http-reversal', original: { kind: 'actual-event' as const, eventId: paid.actualEventId! } }
    const reversal = { confirmedNotOccurred: true, confirmedOn: '2026-08-09', evidenceNote: '双方核对该退款实际尚未发生，独立冲销误点记录' }
    const reversalForm = await repo.actualReversalForm({ origin: 'real' }, { target: reversalTarget, draft: reversal })
    const reversed = await repo.executeAdjustment({ commandId: 'http-reversal-command', workspaceId: reversalForm.context.workspaceId, actorId: reversalForm.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: reversalForm.context.sourceVersion, projectId: 'p', target: reversalTarget, action: { kind: 'confirm-recording-reversal', reversal } })
    expect((await repo.actualPaymentDetail({ origin: 'real' }, reversed.actualEventId!)).fact.kind).toBe('recording-reversal')
    expect((await repo.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    const history = await repo.adjustmentHistory({ origin: 'real' }, f.statementId)
    expect(history.applications).toHaveLength(2)
    expect(history.applications).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: paid.applicationIds[0], kind: 'actual-payment', appliedDelta: expect.objectContaining({ value: -40 }), fact: expect.objectContaining({ ref: { kind: 'actual-event', eventId: paid.actualEventId } }) }),
      expect.objectContaining({ id: reversed.applicationIds[0], kind: 'recording-reversal', reversesApplicationId: paid.applicationIds[0], appliedDelta: expect.objectContaining({ value: 40 }) }),
    ]))
    expect((await repo.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)).applications).toEqual(history.applications)
    const forged = structuredClone(history)
    forged.applications[0]!.appliedDelta = { value: -99, knownValue: -99, state: 'known', reasons: [] }
    expect(() => decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(forged), 'adjustment-history', { origin: 'real' }, f.statementId)).toThrow()
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    await expect(repo.executeAdjustment(actualCommand)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)
