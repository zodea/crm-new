import type { PayrollAAction, PayrollACommandRead } from '../../app/lib/payroll/central-a-contract'
import { afterEach, expect, it } from 'vitest'
import { decodePayrollARead, decodePayrollAResult, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'
import { importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function fixture() {
  const original = await createPayrollHollowFixture()
  closers.push(original.close)
  const migrated = await importPayrollHollowFixture(original.db, original.identities)
  closers.push(migrated.close)
  const draft = { ...original.draft, projectId: migrated.scope.projectId, leaderWorkerId: migrated.id('workers', original.draft.leaderWorkerId), memberWorkerIds: original.draft.memberWorkerIds.map(id => migrated.id('workers', id)), month: '2026-09' }
  const scope = { projectId: draft.projectId, crewId: null, leaderWorkerId: draft.leaderWorkerId, month: draft.month }
  let sequence = 0
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ ...original.command(read, action), commandId: `migrated-price-${++sequence}`, projectId: draft.projectId })
  const form = () => migrated.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'migrated-price-september', draft })
  return { original, ...migrated, draft, scope, command, form }
}

it.each([
  { field: 'unitId', makeId: (id: string) => id.replace(':units:', ':rooms:') },
  { field: 'roomId', makeId: () => 'arbitrary%3Aroom' },
] as const)('迁入工资价拒绝错配 $field，后月修订保原范围 JSON', async ({ field, makeId }) => {
  const f = await fixture()
  const [sourceRow] = await f.original.db.select<{ scope_json: string }>('SELECT scope_json FROM payroll_a_price_revisions')
  let config = await f.service.aConfig({ origin: 'real' }, f.scope)
  const price = config.prices[0]!
  expect(price.scope).toEqual({ kind: 'cells', cells: [{ unitId: f.id('units', f.original.target.unitId), roomId: f.id('rooms', f.original.target.roomId), itemId: f.id('items', f.original.target.itemId) }] })
  expect(decodePayrollARead(encodePayrollAWire(config), 'config', { origin: 'real' }, f.scope)).toEqual(config)
  expect((await f.form()).totals.grossAmount.value).toBe(1000)
  if (price.scope.kind !== 'cells')
    throw new Error('真实迁入夹具须保留明确责任单元范围')
  const originalCell = price.scope.cells[0]!
  const cell = { ...originalCell, [field]: makeId(originalCell[field]) }
  await expect(f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: price.priceId, itemId: price.itemId, unit: price.unit, mode: price.mode, workerId: price.workerId, effectiveMonth: f.scope.month, unitPrice: 300, scope: { kind: 'cells', cells: [cell] } }] }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  await expect(f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: price.itemId, unit: price.unit, mode: price.mode, workerId: price.workerId, effectiveMonth: f.scope.month, unitPrice: 300, scope: price.scope }] }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  config = await f.service.aConfig({ origin: 'real' }, f.scope)
  await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: price.priceId, itemId: price.itemId, unit: price.unit, mode: price.mode, workerId: price.workerId, effectiveMonth: f.scope.month, unitPrice: 300, scope: price.scope }] }))
  const current = await f.form()
  expect(current.totals.grossAmount.value).toBe(1200)
  expect(current.lines[0]?.unitPrice).toBe(300)
  expect((await f.service.aConfig({ origin: 'real' }, f.scope)).prices.map(row => row.revision)).toEqual([1, 2])
  const [unchanged] = await f.instance.withWorkspaceTransaction(tx => tx.select<{ scope_json: string }>('SELECT scope_json FROM payroll_a_price_revisions WHERE id=?', [price.id]))
  expect(unchanged?.scope_json).toBe(sourceRow?.scope_json)
}, 30_000)

it.each([
  (id: string) => id.replace(':payroll-price:', ':payroll-hollow-policy:'),
  () => 'arbitrary%3Aprice',
  (id: string) => id.replace('%3A', '%3a'),
])('两次迁入后沿原价格系列续改发放，拒绝非规范身份：%#', async (makePriceId) => {
  const first = await fixture()
  const cloned = await cloneQuantityHollowSnapshot(await first.instance.exportSnapshotBytes())
  try {
    const second = await importPayrollHollowFixture(cloned, first.identities)
    closers.push(second.close)
    const draft = { ...first.draft, projectId: second.scope.projectId, leaderWorkerId: second.id('workers', first.draft.leaderWorkerId), memberWorkerIds: first.draft.memberWorkerIds.map(id => second.id('workers', id)), month: '2026-10' }
    const scope = { projectId: draft.projectId, crewId: null, leaderWorkerId: draft.leaderWorkerId, month: draft.month }
    let sequence = 0
    const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ ...first.original.command(read, action), commandId: `second-migrated-price-${++sequence}`, projectId: draft.projectId })
    const config = await second.service.aConfig({ origin: 'real' }, scope)
    const price = config.prices[0]!
    expect(price.priceId).toContain('%3Apayroll-price%3A')
    expect(price.id).toContain('%3Apayroll_a_price_revisions%3A')
    expect(decodePayrollARead(encodePayrollAWire(config), 'config', { origin: 'real' }, scope)).toEqual(config)
    const [before] = await second.instance.withWorkspaceTransaction(tx => tx.select<{ scope_json: string }>('SELECT scope_json FROM payroll_a_price_revisions WHERE id=?', [price.id]))
    const action: PayrollAAction = { kind: 'save-a-prices', prices: [{ priceId: price.priceId, itemId: price.itemId, unit: price.unit, mode: price.mode, workerId: price.workerId, effectiveMonth: draft.month, unitPrice: 300, scope: price.scope }] }
    const submitted = command(config, action)
    const result = await second.service.execute(submitted)
    expect(decodePayrollAResult(result, submitted)).toEqual(result)
    const updated = await second.service.aConfig({ origin: 'real' }, scope)
    expect(updated.prices.map(row => [row.priceId, row.revision])).toEqual([[price.priceId, 1], [price.priceId, 2]])
    const input = { statementId: null, draftKey: 'second-migrated-price-october', draft }
    let read = await second.service.aForm({ origin: 'real' }, input)
    expect(read.totals.grossAmount.value).toBe(1200)
    expect(decodePayrollARead(encodePayrollAWire(read), 'form', { origin: 'real' }, input)).toEqual(read)
    const statementId = (await second.service.execute(command(read, { kind: 'save-a-draft', draft }))).statementId!
    read = await second.service.aForm({ origin: 'real' }, { statementId })
    await second.service.execute(command(read, { kind: 'check-a' }))
    read = await second.service.aForm({ origin: 'real' }, { statementId })
    await second.service.execute(command(read, { kind: 'release-a', release: { actualAmount: 1200, allocations: [{ workerId: draft.leaderWorkerId, amount: 1200 }] } }))
    const output = await second.reloadPayroll().aOutput({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    expect(decodePayrollARead(encodePayrollAWire(output), 'output', { origin: 'real' }, statementId)).toEqual(output)
    const [after] = await second.instance.withWorkspaceTransaction(tx => tx.select<{ scope_json: string }>('SELECT scope_json FROM payroll_a_price_revisions WHERE id=?', [price.id]))
    expect(after?.scope_json).toBe(before?.scope_json)

    const priceId = makePriceId(price.priceId)
    await expect(second.service.execute(command(updated, { ...action, prices: [{ ...action.prices[0]!, priceId }] }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const wrongRevisionId = price.id.replace(':payroll_a_price_revisions:', ':wage_statements:')
    expect(() => decodePayrollARead(encodePayrollAWire({ ...config, prices: [{ ...price, id: wrongRevisionId }] }), 'config', { origin: 'real' }, scope)).toThrow('工资核算数据不完整')
    expect(() => decodePayrollARead(encodePayrollAWire({ ...config, prices: [{ ...price, priceId: wrongRevisionId }] }), 'config', { origin: 'real' }, scope)).toThrow('工资核算数据不完整')
    expect(() => decodePayrollARead(encodePayrollAWire({ ...read, lines: read.lines.map(line => ({ ...line, priceRevisionIds: [wrongRevisionId] })) }), 'form', { origin: 'real' }, { statementId })).toThrow('工资核算数据不完整')
    expect(() => decodePayrollAResult({ ...result, priceRevisionIds: [wrongRevisionId] }, submitted)).toThrow('工资提交回执与原目标不一致')
  }
  finally { cloned.close() }
}, 30_000)

it('迁入工资价原物理范围损坏时后月配置与计算均拒绝，不能扩大为全项目', async () => {
  const f = await fixture()
  const config = await f.service.aConfig({ origin: 'real' }, f.scope)
  await f.instance.withWorkspaceTransaction(tx => tx.execute('UPDATE payroll_a_price_revisions SET scope_json=? WHERE id=?', [JSON.stringify({ kind: 'project' }), config.prices[0]!.id]))
  await expect(f.service.aConfig({ origin: 'real' }, f.scope)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  await expect(f.form()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
}, 30_000)

it('迁入价格范围缺少明确房间映射时拒绝消费，不能回退原 ID', async () => {
  const f = await fixture()
  await f.service.aConfig({ origin: 'real' }, f.scope)
  await f.instance.withWorkspaceTransaction(async (tx) => {
    const [evidence] = await tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [f.scope.projectId])
    const mappings = JSON.parse(evidence!.mapping_json) as typeof f.mappings
    await tx.execute('UPDATE payroll_migration_evidence SET mapping_json=? WHERE project_id=?', [JSON.stringify(mappings.filter(mapping => !(mapping.tableName === 'rooms' && mapping.legacyId === f.original.target.roomId))), f.scope.projectId])
  })
  await expect(f.service.aConfig({ origin: 'real' }, f.scope)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
}, 30_000)
