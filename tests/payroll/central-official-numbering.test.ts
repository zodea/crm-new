import { afterEach, expect, it } from 'vitest'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

it('登记项目旧纸号起点后首次正式出具占一个号，原键恢复和再次出具仍读原号', async () => {
  const f = await createPayrollC2ServiceFixture()
  closers.push(f.close)
  const checked = await createCheckedPayrollC2(f)
  await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 525, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 175 }, { workerId: 'zero', amount: 0 }] } }))
  const input = { projectId: 'p', statementId: checked.statementId! }
  const read = () => f.service.numbering({ origin: 'real' }, input)
  const initial = await read()
  const command = (value: Awaited<ReturnType<typeof read>>, id: string, action: { kind: 'initialize', nextNumber: number, evidenceNote: string } | { kind: 'issue' }) => ({ schemaVersion: 1 as const, commandId: id, workspaceId: value.context.workspaceId, actorId: value.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: value.context.sourceVersion, ...input, action })
  expect(initial.settings).toBeNull()
  expect(initial.eligibility.canIssue).toBe(false)
  await expect(f.service.executeNumbering(command(initial, 'issue-before-start', { kind: 'issue' }))).rejects.toThrow('起点')
  await f.service.executeNumbering(command(initial, 'initialize-numbering', { kind: 'initialize', nextNumber: 128, evidenceNote: '项目纸质旧号已核实到127，下一张从128开始' }))
  const first = command(await read(), 'issue-128', { kind: 'issue' })
  const issued = await f.service.executeNumbering(first)
  expect(issued.issue).toMatchObject({ projectId: 'p', statementId: checked.statementId, number: '128', formatFamily: 'C2' })
  expect(await f.service.executeNumbering(first)).toEqual(issued)
  const again = await f.service.executeNumbering(command(await read(), 'same-statement-new-command', { kind: 'issue' }))
  expect(again.issue).toEqual(issued.issue)
  const final = await read()
  expect(final.settings?.nextNumber).toBe(129)
  expect(final.issue).toEqual(issued.issue)
  const frozen = await f.service.c2Output({ origin: 'real' }, checked.statementId!)
  expect(frozen.state === 'available' ? frozen.document.actualAmount : null).toBe(525)
}, 30_000)
