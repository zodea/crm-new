import { expect, it } from 'vitest'
import { createBoqBuildingFixture } from '../helpers/boq-building-fixture'

it('已批新增行只读，原始行更正保量价、审批时序、台账、已报快照和全部排程事实', async () => {
  const fixture = await createBoqBuildingFixture()
  const { owner, session, query, service, quantity, core } = fixture
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write' as const, commandId })
  try {
    const change = await owner.execute({ ...envelope('change-submit'), action: 'submit', kind: 'owner_change', id: null, baseVersion: null, draft: { name: '已签清单', reason: '实际签证', projectId: query.projectId, contractId: query.contractId, applicationDate: '2026-09-12', lines: [
      { operation: 'qty', boqLineId: 'wbs-contract-boq', deltaQty: 3 },
      { operation: 'price', boqLineId: 'wbs-contract-boq', newUnitPrice: 2 },
      { operation: 'add', itemName: '变更新增', unit: '㎡', deltaQty: 2, newUnitPrice: 4 },
    ] }, attachments: {} }, session)
    await owner.execute({ ...envelope('change-approve'), action: 'approve', kind: 'owner_change', id: change.id, baseVersion: change.version, approvedAt: '2026-09-12' }, session)
    await owner.execute({ ...envelope('report-submit'), action: 'submit', kind: 'owner_report', id: null, baseVersion: null, draft: { projectId: query.projectId, contractId: query.contractId, applicationDate: '2026-09-12', periodNo: '2026-09', lines: [{ boqLineId: 'q-boq', reportedQty: 2 }] }, attachments: {} }, session)
    const beforeDocuments = owner.rows()
    const beforeCore = core.snapshot(session)
    const sqlFacts = () => quantity.withSchedule({ projectId: query.projectId, origin: 'real', includeDemo: false }, async (db) => {
      const result: Record<string, unknown[]> = {}
      for (const table of ['schedule_groups', 'schedule_group_buildings', 'schedule_tasks', 'task_item_map', 'task_dependencies', 'schedule_task_floor_plans', 'schedule_floor_quantity_snapshots', 'unit_stage_completions', 'operation_logs'])
        result[table] = await db.select(`SELECT * FROM ${table} ORDER BY id`)
      return result
    })
    const beforeSql = await sqlFacts()
    const before = await service.read(query)
    const added = before.lines.find(row => row.itemName === '变更新增')!
    expect(added).toMatchObject({ sourceKind: 'change-addition', qty: 2, unitPrice: 4 })
    expect(added.readOnlyReason).toMatch(/已签证/)
    const command = { ...query, ...envelope('correct-baseline'), sourceVersion: before.sourceVersion, lineId: 'wbs-contract-boq', buildingId: before.buildings.find(row => row.code === 'B1')!.id, reason: '仅更正已确认原始行楼栋' }
    await expect(service.execute({ ...command, commandId: 'cannot-change-add', lineId: added.id })).rejects.toMatchObject({ problem: { code: 'forbidden', commandOutcome: 'not-applied' } })
    await service.execute(command)
    expect((await service.read(query)).lines.find(row => row.id === command.lineId)).toMatchObject({ id: command.lineId, qty: 12, unitPrice: 1, effectiveQty: 15, effectiveUnitPrice: 2, building: 'B1' })
    expect(owner.rows()).toEqual(beforeDocuments)
    expect(core.snapshot(session)).toEqual(beforeCore)
    expect(await sqlFacts()).toEqual(beforeSql)
  }
  finally { await fixture.close() }
})

it('sQL失败之前不发布原表、审计或回执', async () => {
  const fixture = await createBoqBuildingFixture()
  const { query, service, quantity, owner } = fixture
  try {
    const before = await service.read(query)
    const facts = owner.quantityBoqFacts(query.projectId)
    await quantity.withSchedule({ projectId: query.projectId, origin: 'real', includeDemo: false }, async (db) => {
      await db.execute('CREATE TRIGGER reject_source_read BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, \'source unavailable\'); END')
    })
    const command = { ...query, commandId: 'sql-failure', workspaceId: before.workspaceId, actorId: before.actorId, requiredCapability: 'owner-document:write' as const, sourceVersion: before.sourceVersion, lineId: 'q-boq', buildingId: before.buildings.find(row => row.code === 'B2')!.id, reason: '失败时不能先写入' }
    await expect(service.execute(command)).rejects.toThrow()
    expect(owner.quantityBoqFacts(query.projectId)).toEqual(facts)
    expect(owner.hasBoqBuildingCommand(command.commandId)).toBe(false)
  }
  finally { await fixture.close() }
})

it('排队期间权限撤销后拒绝提交且保留原事实', async () => {
  const fixture = await createBoqBuildingFixture()
  const { query, service, quantity, owner, session } = fixture
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  try {
    const before = await service.read(query)
    const held = quantity.withSchedule({ projectId: query.projectId, origin: 'real', includeDemo: false }, async () => {
      entered()
      await gate
    })
    await ready
    const pending = service.execute({ ...query, commandId: 'revoked', workspaceId: before.workspaceId, actorId: before.actorId, requiredCapability: 'owner-document:write', sourceVersion: before.sourceVersion, lineId: 'q-boq', buildingId: before.buildings[0]!.id, reason: '等待中的更正' })
    fixture.setSession({ ...session, capabilities: session.capabilities.filter(cap => cap !== 'owner-document:write') })
    release()
    await held
    await expect(pending).rejects.toMatchObject({ problem: { code: 'forbidden', commandOutcome: 'not-applied' } })
    expect(owner.quantityBoqFacts(query.projectId).lines.find(row => row.id === 'q-boq')?.building).toBe('一栋')
    expect(owner.hasBoqBuildingCommand('revoked')).toBe(false)
  }
  finally {
    release()
    await fixture.close()
  }
})
