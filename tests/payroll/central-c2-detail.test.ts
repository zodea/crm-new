import { afterEach, expect, it } from 'vitest'
import { decodePayrollRead, encodePayrollWire } from '~/lib/payroll/central-codec'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

type Fixture = Awaited<ReturnType<typeof createPayrollC2ServiceFixture>>
const fixtures: Fixture[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0))
    await f.close()
})
async function released() {
  const f = await createPayrollC2ServiceFixture()
  fixtures.push(f)
  const checked = await createCheckedPayrollC2(f)
  const result = await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
  return { f, id: result.statementId!, commandId: result.commandId }
}

it('中央 C2 回执被损坏时通用详情也降为来源未证实，保留原金额与原文', async () => {
  const { f, id, commandId } = await released()
  const before = await f.service.detail({ origin: 'real' }, id)
  expect(before.statement.snapshot.state).toBe('complete')
  expect(before.statement.diagnostics.some(item => item.code === 'source-unproven')).toBe(false)
  await f.db.execute('UPDATE payroll_command_receipts SET fingerprint=? WHERE command_id=?', ['invalid-original-receipt', commandId])
  const after = await f.service.detail({ origin: 'real' }, id)
  expect((await f.service.c2Output({ origin: 'real' }, id)).state).toBe('unavailable')
  expect(after.statement.snapshot.state).toBe('partial')
  expect(after.statement.diagnostics.some(item => item.code === 'source-unproven')).toBe(true)
  expect(after.statement.actualAmount).toBe(500)
  expect(after.statement.stored.head).toEqual(before.statement.stored.head)
  expect(after.statement.snapshot.raw).toBe(before.statement.snapshot.raw)
})

it('新 C2 通用详情的签工姓名取发放时成员，后来改名不改原表姓名', async () => {
  const { f, id } = await released()
  const before = await f.service.detail({ origin: 'real' }, id)
  const frozenName = before.statement.members.find(member => member.workerId === 'w')!.workerName
  expect(frozenName).toBeTruthy()
  expect(before.statement.daywork.find(record => record.workerId === 'w')?.workerName).toBe(frozenName)
  f.source.workers.find(worker => worker.id === 'w')!.name = '之后档案中的新名字'
  await f.db.execute('UPDATE workers SET name=? WHERE id=?', ['之后档案中的新名字', 'w'])
  const after = await f.service.detail({ origin: 'real' }, id)
  expect(after.statement.daywork).toEqual(before.statement.daywork)
  expect(after.statement.members).toEqual(before.statement.members)
})

it('历史签工明确空姓名保留原空值，不用冻结另一字段或当前名册补写', async () => {
  const { f, id } = await released()
  const rows = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [id])
  const snapshot = JSON.parse(rows[0]!.snapshot_json)
  snapshot.dayworkRecords.find((record: { workerId: string }) => record.workerId === 'w').workerName = null
  await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), id])
  const detail = await f.service.detail({ origin: 'real' }, id)
  expect(detail.statement.daywork.find(record => record.workerId === 'w')?.workerName).toBeNull()
  expect(detail.statement.stored.head.snapshot_json).toBe(JSON.stringify(snapshot))
})

it('极小 C2 单价的通用详情使用定点字符串，无损往返且拒绝科学计数传输', async () => {
  const f = await createPayrollC2ServiceFixture()
  fixtures.push(f)
  await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 0.0000001, ruleText: '' } }))
  await f.daywork({ status: 'confirmed', witness: '证明甲', confirmedOn: '2026-08-02' })
  const saved = await f.service.executeC2(f.c2Command(await f.c2Form(), { kind: 'save-c2-draft', draft: f.draft }))
  const detail = await f.service.detail({ origin: 'real' }, saved.statementId!)
  const wire = encodePayrollWire(detail) as { statement: { lines: { unitPrice: string }[], stored: { lines: { unitPrice: string }[] } } }
  expect(wire.statement.lines[0]?.unitPrice).toBe('0.0000001')
  expect(wire.statement.stored.lines[0]?.unitPrice).toBe('0.0000001')
  expect(decodePayrollRead(wire, 'detail', { origin: 'real' }, saved.statementId!)).toEqual(detail)
  wire.statement.lines[0]!.unitPrice = '1e-7'
  expect(() => decodePayrollRead(wire, 'detail', { origin: 'real' }, saved.statementId!)).toThrow('工资数值传输格式不完整')
})
