import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { createQuantityService } from '../../app/lib/quantity/central-service'
import { loadPayrollAManagementScopeFacts } from '../../server/utils/payroll-management-scope-facts'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createPayrollWorkbookService } from '../../server/utils/payroll-workbook-service'
import { createProductionPayrollImport } from '../../server/utils/production-payroll-import'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { validateProductionPayrollState } from '../../server/utils/production-payroll-validation'
import { createProductionQuantityImport, readProductionQuantityImportedIdentities } from '../../server/utils/production-quantity-migration'
import { createProductionStorage } from '../../server/utils/production-storage'
import { loadQuantityHollowFacts } from '../../server/utils/quantity-hollow-facts'
import { createQuantityHollowService } from '../../server/utils/quantity-hollow-service'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'

it('真实整库A/P5/P6混合历史按同源工程量映射正式接管，保管理更正退款、原价格配置、空鼓整改、正式号和完整原目录，独立冷进程不开放新A来源', async () => {
  const native = await createPayrollAFeeAdjustmentFixture()
  const nativeActor = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'quantity:read', 'quantity:write', 'project:list:read', 'crew:list:read', 'worker:list:read'] }
  native.setSession(nativeActor)
  const coordinator = createDbCoordinator(async () => native.db)
  const base = resolve('.tmp/opt02-payroll-history')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const actor = { workspaceId: 'history-workspace', actorId: 'history-owner', capabilities: [...nativeActor.capabilities, 'core:migration:write', 'worker:sensitive:read'] }
  const options = { directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  try {
    await native.prices()
    await native.saveFees([native.fee()])
    const management = await native.management()
    const managed = await management.start()
    await native.release(managed.statementId!, 300)
    const correction = await native.correct(managed.statementId!, (basis) => {
      basis.fees!.components.forEach((component) => {
        component.unitPrice = 1.5
      })
    })
    expect(correction.adjustment.delta).toBe(-120)
    await native.pay(correction.adjustment.id, -50)
    const people = [...native.source.workers.map(row => ({ id: row.id, name: row.name!, kind: 'worker' as const, trade: '泥工', trades: ['泥工'], itemNames: [], dataOrigin: 'real' as const })), ...native.source.crews.map(row => ({ id: row.id, name: row.name!, kind: 'crew' as const, trade: '泥工', trades: ['泥工'], itemNames: [], dataOrigin: 'real' as const }))]
    const qty = createQuantityService({ workspaceId: 'work', database: coordinator, project: async id => ({ ...native.source.projects.find(row => row.id === id)!, dataOrigin: 'real' }), people: async () => people })
    let qtySequence = 0
    const qtyQuery = { projectId: 'p', origin: 'real' as const, includeDemo: false }
    const executeQty = async (action: Parameters<typeof qty.execute>[0]['action']) => qty.execute({ workspaceId: 'work', actorId: 'actor', commandId: `native-history-quantity-${++qtySequence}`, origin: 'real', requiredCapability: 'quantity:write', projectId: 'p', baseVersion: (await qty.region(qtyQuery, nativeActor)).sourceVersion, action }, nativeActor)
    const newUnit = await executeQty({ kind: 'create-unit', floorId: 'fee-floor', draft: { code: '102', name: '102室', templateId: 'fee-template' } })
    await executeQty({ kind: 'save-assignments', draft: { projectId: 'p', trade: '泥工', assigneeKind: 'worker', assigneeId: 'w', unitIds: [newUnit.id], expectedAssignments: [{ unitId: newUnit.id, assignmentId: null, fingerprint: null }], scopes: [{ unitId: newUnit.id, roomId: 'fee-room', itemId: 'wall' }], note: '真实新户原施工责任', allowReplacement: false } })
    const completion = (await qty.completion({ ...qtyQuery, unitId: newUnit.id }, nativeActor)).data.stages.find(row => row.id === 'fee-stage')!
    await executeQty({ kind: 'save-completion', draft: { projectId: 'p', unitId: newUnit.id, stageId: 'fee-stage', status: 'completed', completedAt: '2026-08-05', note: '原真实第二户完成', expectedCompletionId: completion.completion?.id ?? null, expectedCompletionFingerprint: completion.completion?.fingerprint ?? null, expectedAssignmentId: completion.currentAssignment?.id ?? null, photos: [{ fileName: '原现场照片.png', mimeType: 'image/png', fileSize: 3, contentBase64: 'AQID' }] } })
    const hollow = createQuantityHollowService({ session: () => nativeActor, projects: () => native.source.projects.map(row => ({ ...row, dataOrigin: 'real' as const })), people: () => people, transaction: work => coordinator.withTransaction(tx => work(tx, nativeActor)) })
    const query = { ...qtyQuery, unitId: newUnit.id }
    let inspected = await hollow.hollow(query)
    const target = inspected.data.targets.find(row => row.target.itemId === 'wall')!.target
    const hollowCommand = (read: typeof inspected, commandId: string, action: Parameters<typeof hollow.executeHollow>[0]['action']) => ({ commandId, workspaceId: nativeActor.workspaceId, actorId: nativeActor.actorId, origin: 'real' as const, requiredCapability: 'quantity:write' as const, projectId: 'p', baseVersion: read.sourceVersion, action })
    await hollow.executeHollow(hollowCommand(inspected, 'native-history-inspection', { kind: 'create-hollow-inspection', target, input: { inspectedOn: '2026-08-01', count: 3, note: '原墙砖检查三处' } }))
    inspected = await hollow.hollow(query)
    await hollow.executeHollow(hollowCommand(inspected, 'native-history-rectification', { kind: 'rectify-hollow-inspection', recordId: inspected.data.records[0]!.recordId, expectedRevisionId: inspected.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-08-02', count: 1, note: '原已整改一处' }))
    const service = createPayrollService({ session: () => nativeActor, identities: () => native.source, transaction: work => coordinator.withTransaction(tx => work(tx, nativeActor)), quantityFacts: loadPayrollAQuantityFacts, managementScopeFacts: loadPayrollAManagementScopeFacts, hollowFacts: loadQuantityHollowFacts })
    const draft = { ...native.draft, book: native.ordinary, payRatio: 1, note: '原普通工资与全零成员' }
    const form = await service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'native-history-ordinary', draft })
    const ordinary = await service.execute(native.command(form, { kind: 'save-a-draft', draft }))
    let current = await service.aForm({ origin: 'real' }, { statementId: ordinary.statementId! })
    await service.executeHollow({ commandId: 'native-history-hollow-adoption', workspaceId: nativeActor.workspaceId, actorId: nativeActor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: current.hollow!.context.sourceVersion, projectId: 'p', target: current.hollow!.target, config: null, action: { kind: 'start-hollow-deduction' } })
    current = await service.aForm({ origin: 'real' }, { statementId: ordinary.statementId! })
    expect(current.totals.grossAmount.value).toBe(7400)
    await service.execute(native.command(current, { kind: 'check-a' }))
    current = await service.aForm({ origin: 'real' }, { statementId: ordinary.statementId! })
    await service.execute(native.command(current, { kind: 'release-a', release: { actualAmount: 7400, allocations: [{ workerId: 'w', amount: 7400 }, { workerId: 'zero', amount: 0 }] } }))
    const statementIds = [managed.statementId!, ordinary.statementId!]
    const originals = await Promise.all(statementIds.map(id => service.aOutput({ origin: 'real' }, id)))
    expect(originals.every(row => row.state === 'available')).toBe(true)
    for (const [index, statementId] of statementIds.entries()) {
      let read = await service.numbering({ origin: 'real' }, { projectId: 'p', statementId })
      const command = (action: { kind: 'initialize', nextNumber: number, evidenceNote: string } | { kind: 'issue' }, suffix: string) => ({ schemaVersion: 1 as const, commandId: `native-history-number-${index}-${suffix}`, workspaceId: 'work', actorId: 'actor', origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', statementId, action })
      if (index === 0) {
        await service.executeNumbering(command({ kind: 'initialize', nextNumber: 128, evidenceNote: '原旧纸号核对至127' }, 'start'))
        read = await service.numbering({ origin: 'real' }, { projectId: 'p', statementId })
      }
      await service.executeNumbering(command({ kind: 'issue' }, 'issue'))
    }
    const workbook = createPayrollWorkbookService({ session: () => nativeActor, transaction: work => coordinator.withTransaction(work), payroll: db => createPayrollService({ session: () => nativeActor, identities: () => native.source, transaction: work => work(db, nativeActor), quantityFacts: loadPayrollAQuantityFacts, managementScopeFacts: loadPayrollAManagementScopeFacts, hollowFacts: loadQuantityHollowFacts }), roster: () => {
      throw new Error('该原公开目录没有固定实名附件，不能补造')
    } })
    const input = { projectId: 'p', mode: 'project-month' as const, statementIds, rosterArchiveId: null }
    const preview = await workbook.workbookPreview({ origin: 'real' }, input)
    const savedDirectory = await workbook.executeWorkbook({ schemaVersion: 1, commandId: 'native-history-directory', workspaceId: 'work', actorId: 'actor', origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.sourceVersion, input, action: 'archive' })
    const originalDirectory = await workbook.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: savedDirectory.archiveId })
    const originalSnapshots = await native.db.select<{ id: string, snapshot_json: string }>('SELECT id,snapshot_json FROM wage_statements ORDER BY id')
    const bytes = native.db.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const now = '2026-10-07T08:00:00.000Z'
    await storage.withTransaction(async (db) => {
      await db.execute('INSERT INTO projects(id,name,code,draft_json,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', ['history-project', '正式真实工资项目', 'HISTORY', JSON.stringify({ name: '正式真实工资项目', code: 'HISTORY' }), now, now])
      await db.execute('INSERT INTO crews(id,record_json) VALUES (?,?)', ['history-crew', JSON.stringify({ id: 'history-crew', version: 1, updatedAt: now, draft: { id: 'history-crew', name: '正式已有班组', trade: '泥工' } })])
      for (const [legacyId, id] of [['w', 'history-leader'], ['zero', 'history-zero'], ['other', 'history-other']])
        await db.execute('INSERT INTO workers(id,record_json) VALUES (?,?)', [id, JSON.stringify({ id, version: 1, updatedAt: now, draft: { id, name: `正式 ${legacyId}`, crewId: 'history-crew', dailyWage: 0 } })])
    })
    const quantity = createProductionQuantityImport(storage)
    const qtyCommand = { commandId: 'history-quantity-source', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'adopt' as const, source, projects: [{ legacyId: 'p', projectId: 'history-project', version: '1' }], people: [{ kind: 'worker' as const, legacyId: 'w', id: 'history-leader', version: '1' }] }
    await quantity.execute(qtyCommand, () => actor)
    const qtyIdentities = await storage.withTransaction(tx => readProductionQuantityImportedIdentities(tx, source.sha256, actor))
    expect(qtyIdentities.some(row => row.table === 'quantity_hollow_records')).toBe(true)
    const importer = createProductionPayrollImport(storage)
    const state = await importer.state(() => actor)
    const pairs = [['projects', 'p', 'history-project'], ['crews', 'crew', 'history-crew'], ['workers', 'w', 'history-leader'], ['workers', 'zero', 'history-zero']] as const
    const referenceMappings = pairs.map(([entityType, legacyId, serverId]) => {
      const row = state.references.find(row => row.entityType === entityType && row.serverId === serverId)!
      return { entityType, legacyId, serverId, version: row.version, sourceVersion: row.sourceVersion, evidenceNote: '逐项核实真实原工资身份' }
    })
    const adopted = await importer.execute({ commandId: 'history-payroll-source', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'adopt', source, referenceMappings }, () => actor)
    if (!('statementIds' in adopted))
      throw new Error('正式完整工资没有取得采用回执')
    expect(adopted.statementIds).toHaveLength(statementIds.length)
    const [evidence] = await storage.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence')
    const mappings = JSON.parse(evidence!.mapping_json) as Array<{ tableName: string, legacyId: string, centralId: string }>
    const mapped = (table: string, id: string) => mappings.find(row => row.tableName === table && row.legacyId === id)!.centralId
    const formal = createProductionPayrollService(storage)
    const output = await Promise.all(statementIds.map(id => formal.forSession(() => actor).aOutput({ origin: 'real' }, mapped('wage_statements', id))))
    expect(output.map(row => row.document?.actualAmount)).toEqual([300, 7400])
    expect(output[1]!.document?.hollow?.totals.currentDeduction.value).toBe(60)
    expect((await formal.forSession(() => actor).actualLedger({ origin: 'real' }, { projectId: 'history-project' })).netAmount.value).toBe(7650)
    expect((await formal.forSession(() => actor).adjustmentDetail({ origin: 'real' }, mapped('payroll_adjustments', correction.adjustment.id))).balance.remainingDelta.value).toBe(-70)
    for (const original of originalSnapshots)
      expect((await storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [mapped('wage_statements', original.id)]))[0]!.snapshot_json).toBe(original.snapshot_json)
    const archiveId = mapped('payroll_workbook_archives', savedDirectory.archiveId)
    const directoryRead = await formal.workbook(() => actor).workbookArchive({ origin: 'real' }, { projectId: 'history-project', archiveId })
    expect(directoryRead.manifestHash).toBe(originalDirectory.manifestHash)
    expect(directoryRead.issues.map(row => row.number)).toEqual(['128', '129'])
    await storage.withTransaction(validateProductionPayrollState)
    const upstreamActor = { ...actor, capabilities: [...actor.capabilities, 'boq:read', 'construction-contract:read', 'owner-document:read'] }
    await expect(formal.forSession(() => upstreamActor).aForm({ origin: 'real' }, { statementId: null, draftKey: 'forbidden-new-A', draft: { ...draft, projectId: 'history-project', crewId: 'history-crew', leaderWorkerId: 'history-leader', memberWorkerIds: ['history-leader', 'history-zero'] } })).rejects.toThrow('上游')
    expect(native.db.raw.export()).toEqual(bytes)
    await expect(quantity.restore({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'history-dangerous-quantity-restore', importId: (await quantity.execute(qtyCommand, () => actor)).importId }, () => actor)).rejects.toThrow('整批恢复')
    await storage.close()
    const child = await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-payroll-history-cold-process.ts')], { windowsHide: true, cwd: resolve('.'), env: { ...process.env, CRM_PAYROLL_HISTORY_DIRECTORY: directory, CRM_PAYROLL_HISTORY_COMMAND: adopted.commandId, CRM_PAYROLL_HISTORY_ARCHIVE: archiveId } })
    expect(JSON.parse(child.stdout)).toMatchObject({ recovered: { outcome: 'applied', result: adopted }, amounts: [300, 7400], net: 7650, numbers: ['128', '129'], valid: true })
  }
  finally {
    await storage.close()
    await native.close()
  }
}, 30000)
