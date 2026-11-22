import type { OwnerCommercialDocumentCommandRequestDTO } from '../../app/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentKind } from '../../app/lib/owner-document/central-repository'
import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createHttpOwnerCommercialDocumentCommandRepository } from '../../app/lib/owner-document/central-http-repository'
import { createOwnerDocumentCommandSession } from '../../app/lib/owner-document/command-intent'
import { productionBoqHeadVersion } from '../../server/utils/production-boq-record'
import { createProductionBoqService } from '../../server/utils/production-boq-service'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionContractReference } from '../../server/utils/production-construction-contract-sources'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { readProductionOwnerDocumentState } from '../../server/utils/production-owner-document-record'
import { createProductionOwnerDocumentService } from '../../server/utils/production-owner-document-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'
import { installProductionBoqFixture } from '../helpers/production-boq-fixture'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

async function fixture() {
  const data = await createSubcontractFixture()
  const actor = data.session()
  actor.capabilities.push('owner-document:read', 'owner-document:write', 'subcontract-document:read', 'subcontract-document:write', 'crew:list:read', 'quantity:read', 'boq:read', 'boq:write')
  data.setActor(actor)
  const sub = await data.service.execute(data.command(), data.session)
  const owner = createProductionOwnerDocumentService(data.storage)
  const context = await owner.context(undefined, data.session)
  const groups = { projectId: context.projects, customerId: context.customers, supplierId: context.suppliers, crewId: context.crews ?? [], contractId: context.contracts }
  const refreshRelationships = async () => {
    const current = await owner.context(undefined, data.session)
    Object.assign(groups, { projectId: current.projects, customerId: current.customers, supplierId: current.suppliers, crewId: current.crews ?? [], contractId: current.contracts })
  }
  let sequence = 0
  const command = (kind: OwnerCommercialDocumentKind, fields: Record<string, unknown> = {}): OwnerCommercialDocumentCommandRequestDTO => {
    const draft = fields.draft as Record<string, unknown> | undefined
    const versions = Object.fromEntries(Object.entries(groups).flatMap(([field, rows]) => {
      const selected = draft ? rows.find(row => row.id === draft[field]) : null
      return selected ? [[field, { id: selected.id, version: selected.version }]] : []
    }))
    return { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: ['sub_change', 'sub_settlement', 'project_penalty'].includes(kind) ? 'subcontract-document:write' : 'owner-document:write', commandId: `business-test-${++sequence}`, kind, action: 'save', id: null, baseVersion: null, draft: {}, attachments: {}, ...fields, ...(draft ? { draft: { ...(kind === 'owner_change' ? { lines: [] } : {}), ...draft, relationshipVersionsJson: JSON.stringify(versions) } } : {}) } as OwnerCommercialDocumentCommandRequestDTO
  }
  return { ...data, owner, actor, sub, command, refreshRelationships }
}

async function monthlySource(f: Awaited<ReturnType<typeof fixture>>) {
  const boq = await installProductionBoqFixture(f.storage, f.actor, f.project.id, { qty: 100, unitPrice: 17 })
  f.actor.capabilities.push('crew:write', 'worker:list:read')
  f.setActor(f.actor)
  const crew = await createProductionCrewWorkerService(f.storage).executeCrew({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'crew:write', commandId: 'business-monthly-crew', baseVersion: null, action: 'draft', draft: { name: '实际报量执行班组', trade: '油漆工' }, attachments: {} }, f.session)
  await f.refreshRelationships()
  await f.storage.withTransaction(async (tx) => {
    await tx.execute('INSERT INTO buildings(id,project_id,code,name) VALUES (\'business-building\',?,\'A\',\'实际楼栋\')', [f.project.id])
    await tx.execute('INSERT INTO floors(id,building_id,code,name) VALUES (\'business-floor\',\'business-building\',\'F1\',\'实际一层\')')
    await tx.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES (\'business-template\',?,\'T\',\'实际模板\')', [f.project.id])
    const [room] = await tx.select<{ id: string }>('SELECT id FROM rooms WHERE template_id=\'business-template\'')
    await tx.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES (\'business-unit\',\'business-floor\',\'business-template\',\'101\')')
    await tx.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES (\'business-item\',?,\'I\',\'实际分项\',\'油漆工\',\'㎡\')', [f.project.id])
    await tx.execute('INSERT INTO quantity_boq_references VALUES (?,?,?)', [boq.line.id, f.project.id, boq.main.id])
    await tx.execute('INSERT INTO house_type_template_items(id,room_id,item_id,boq_line_id,contract_qty,provisional_qty,field_qty,updated_at) VALUES (\'business-template-line\',?,\'business-item\',?,8,7,6,\'2026-10-07T08:00:00Z\')', [room!.id, boq.line.id])
    await tx.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES (\'business-stage\',?,\'S\',\'实际报量阶段\',\'油漆工\')', [f.project.id])
    await tx.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage,updated_at) VALUES (\'business-mapping\',\'business-stage\',\'business-item\',1,\'2026-10-07T08:00:00Z\')')
    await tx.execute('INSERT INTO unit_assignments(id,unit_id,trade,crew_id) VALUES (\'business-assignment\',\'business-unit\',\'油漆工\',?)', [crew.id])
    await tx.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at,updated_at) VALUES (\'business-completed\',\'business-unit\',\'business-stage\',\'business-assignment\',\'completed\',\'2026-10-07\',\'2026-10-07T08:00:00Z\')')
  })
  return boq
}

async function coldRead(f: Awaited<ReturnType<typeof fixture>>, locators: { kind: OwnerCommercialDocumentKind, commandId: string }[]) {
  const directory = resolve(f.options.directory, 'cold-business')
  await mkdir(directory)
  await f.storage.backupTo(resolve(directory, 'ruihang.sqlite'))
  const output = resolve(f.options.directory, 'cold-business.json')
  await runColdProcess('production-owner-document-cold', [directory, JSON.stringify(f.actor), JSON.stringify(locators), output])
  return JSON.parse(await readFile(output, 'utf8'))
}

it('正式验收/保修同ID与共享原件耐久；原键重复、异文、封存、终态与权限来源仍受控', async () => {
  const f = await fixture()
  try {
    const command = f.command('acceptance', { action: 'submit', draft: { projectId: f.project.id, contractId: f.main.id, name: '真实联合验收', applicationDate: '2026-10-07' }, attachments: { add: [{ fileName: '真实验收.txt', fileSize: 3, mimeType: 'text/plain', category: 'acceptance-report', payloadBase64: 'YWJj' }] } })
    const saved = await f.owner.execute(command, f.session)
    expect(await f.owner.execute(command, f.session)).toEqual(saved)
    await expect(f.owner.execute({ ...command, draft: { ...('draft' in command ? command.draft : {}), name: '异文' } } as OwnerCommercialDocumentCommandRequestDTO, f.session)).rejects.toThrow('原编号')
    const accepted = await f.owner.execute(f.command('acceptance', { action: 'transition-acceptance', id: saved.id, baseVersion: saved.version, target: 'accepted', facts: { acceptanceOrganization: '联合验收组', acceptancePerson: '实际验收人', acceptanceDate: '2026-10-07', acceptanceConclusion: '合格' } }), f.session)
    const form = await f.owner.form('acceptance', saved.id, f.session)
    expect(form).toMatchObject({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, dataOrigin: 'real', version: accepted.version, draft: { lifecycleEvents: expect.any(Array), contractEstimate: null } })
    const original = await f.owner.file({ kind: 'acceptance', id: saved.id, fileId: saved.attachmentIds[0]!, origin: 'real' }, f.session)
    expect(Buffer.from(original.bytes).toString()).toBe('abc')
    const detail = await f.owner.detail('acceptance', saved.id, { origin: 'real', variant: 'acceptance' }, f.session)
    expect(detail.document.id).toBe(saved.id)
    await expect(f.owner.detail('acceptance', saved.id, { origin: 'demo' }, f.session)).rejects.toThrow('来源')
    await expect(f.owner.form('acceptance', saved.id, () => ({ ...f.actor, capabilities: [] }))).rejects.toThrow('身份')
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionOwnerDocumentService(reopened)
      expect(await owner.resolve('acceptance', command.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
      expect((await owner.form('acceptance', saved.id, f.session)).draft.lifecycleEvents).toHaveLength(2)
      expect(Buffer.from((await owner.file({ kind: 'acceptance', id: saved.id, fileId: saved.attachmentIds[0]!, origin: 'real' }, f.session)).bytes).toString()).toBe('abc')
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
})

it('商务原编号在BOQ委托及其他kind之间互斥，错误恢复不封存真实原结果', async () => {
  const f = await fixture()
  try {
    const boq = await installProductionBoqFixture(f.storage, f.actor, f.project.id, { qty: 100, unitPrice: 17 })
    await f.refreshRelationships()
    const penalty = f.command('owner_penalty', { draft: { projectId: f.project.id, contractId: boq.main.id, amount: null, reason: '原商务意图' } })
    const saved = await f.owner.execute(penalty, f.session)
    const change = f.command('owner_change', { commandId: penalty.commandId, draft: { projectId: f.project.id, contractId: boq.main.id, name: '另一签证', reason: '另一个动作', approvedTaxInclusiveAmount: 25 } })
    await expect(f.owner.execute(change, f.session)).rejects.toThrow('原商务编号')
    expect(await f.owner.resolve('owner_penalty', penalty.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
    const other = { ...change, commandId: 'unique-commercial-change' }
    const signed = await f.owner.execute(other, f.session)
    await expect(f.owner.execute({ ...penalty, commandId: other.commandId }, f.session)).rejects.toThrow('原商务编号')
    await expect(f.owner.resolve('owner_penalty', other.commandId, f.session)).rejects.toThrow('原商务编号')
    expect(await f.owner.resolve('owner_change', other.commandId, f.session)).toEqual({ outcome: 'applied', result: signed })
    const parent = await f.storage.withTransaction(tx => readProductionConstructionContractReference(tx, f.actor, boq.main.id))
    await expect(createProductionBoqService(f.storage).execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'other-physical-wrapper', requiredCapability: 'boq:write', origin: 'real', projectId: f.project.id, contractId: boq.main.id, contractVersion: productionBoqHeadVersion(parent), action: { kind: 'owner-change', command: other } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '上游命令只允许同原身份的真实甲方变洽签' } })
    expect(await f.storage.select('SELECT id FROM boq_change_records WHERE id=?', [signed.id])).toHaveLength(1)
  }
  finally { await f.storage.close() }
}, 30000)

it('明确未应用先可靠封存，依赖恢复后迟到原请求仍不能落账', async () => {
  const f = await fixture()
  try {
    const command = f.command('sub_settlement', { action: 'submit', draft: { name: '原核对', projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, totalAmount: null, settlementDate: '2026-10-07' } })
    await expect(f.owner.execute(command, f.session)).rejects.toMatchObject({ problem: { commandId: command.commandId, commandOutcome: 'not-applied' } })
    expect(await f.storage.select('SELECT command_id FROM owner_document_command_resolutions WHERE command_id=?', [command.commandId])).toHaveLength(1)
    await expect(f.owner.execute({ ...command, draft: { ...command.draft, totalAmount: 10 } }, f.session)).rejects.toThrow('封存')
    expect(await f.storage.select('SELECT id FROM expenditure_settlements WHERE document_owner=\'business\'')).toHaveLength(0)
  }
  finally { await f.storage.close() }
}, 30000)

it('分包结算共享唯一头、整改与部分抵扣双方版本一起耐久；冻结金额与旧版本拒绝', async () => {
  const f = await fixture()
  try {
    const settlement = await f.owner.execute(f.command('sub_settlement', { action: 'submit', draft: { name: '真实分包结算', projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, settlementDate: '2026-10-07', totalAmount: 2000 } }), f.session)
    const penalty = await f.owner.execute(f.command('project_penalty', { action: 'submit', draft: { projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, penaltyDate: '2026-10-07', amount: 1000, reason: '保护整改' } }), f.session)
    const rectified = await f.owner.execute(f.command('project_penalty', { action: 'rectify-penalty', id: penalty.id, baseVersion: penalty.version, deadline: '2026-10-10', note: '实际复验记录' }), f.session)
    const request = f.command('project_penalty', { action: 'deduct-penalty', id: penalty.id, baseVersion: rectified.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 400, note: '实际结算抵扣' })
    const deducted = await f.owner.execute(request, f.session)
    expect(await f.owner.execute(request, f.session)).toEqual(deducted)
    const detail = await f.owner.detail('sub_settlement', settlement.id, { origin: 'real' }, f.session)
    expect(detail.document.amounts).toMatchObject({ total: '2000.00', deductions: '400.00', netSettlement: '1600.00' })
    expect((await f.owner.form('sub_settlement', settlement.id, f.session)).version).toBe('2')
    expect(await f.storage.select('SELECT id FROM expenditure_settlements WHERE id=? AND document_owner=\'business\'', [settlement.id])).toHaveLength(1)
    await expect(f.owner.execute(f.command('project_penalty', { ...request, commandId: 'stale-business-deduction' }), f.session)).rejects.toThrow('版本')
    await expect(f.owner.execute(f.command('sub_settlement', { id: settlement.id, baseVersion: '2', draft: { name: '改金额', totalAmount: 1 } }), f.session)).rejects.toThrow('只有草稿')
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionOwnerDocumentService(reopened)
      const restored = await owner.detail('project_penalty', penalty.id, { origin: 'real' }, f.session)
      expect(restored.penaltyDeductions).toHaveLength(1)
      expect(restored.penaltyRectifications).toHaveLength(1)
      expect(restored.document.amounts).toMatchObject({ deducted: '400.00', remaining: '600.00' })
      expect(await owner.resolve('project_penalty', request.commandId, f.session)).toEqual({ outcome: 'applied', result: deducted })
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
})

it('保存后删除保全部原回执和原前文，冷重开仍不可日常读；未知原键封存拒绝迟到', async () => {
  const f = await fixture()
  try {
    const save = f.command('owner_penalty', { draft: { amount: null, projectId: f.project.id, contractId: f.main.id, reason: '草稿待核' } })
    const saved = await f.owner.execute(save, f.session)
    expect((await f.owner.form('owner_penalty', saved.id, f.session)).draft.amount).toBeNull()
    const remove = f.command('owner_penalty', { action: 'delete', id: saved.id, baseVersion: saved.version })
    const deleted = await f.owner.execute(remove, f.session)
    await expect(f.owner.form('owner_penalty', saved.id, f.session)).rejects.toThrow('不存在')
    const state = await f.storage.withTransaction(tx => readProductionOwnerDocumentState(tx, f.actor))
    expect(state.allDocuments.find(row => row.id === saved.id)).toMatchObject({ amount: null, version: 2 })
    const unknown = f.command('owner_penalty', { commandId: 'business-unknown-original' })
    expect(await f.owner.resolve('owner_penalty', unknown.commandId, f.session)).toMatchObject({ outcome: 'not-applied' })
    await expect(f.owner.execute(unknown, f.session)).rejects.toThrow('封存')
    const coldDirectory = resolve(f.options.directory, 'cold-business')
    await mkdir(coldDirectory)
    await f.storage.backupTo(resolve(coldDirectory, 'ruihang.sqlite'))
    const output = resolve(f.options.directory, 'cold-business.json')
    await runColdProcess('production-owner-document-cold', [coldDirectory, JSON.stringify(f.actor), JSON.stringify([{ kind: 'owner_penalty', commandId: save.commandId }, { kind: 'owner_penalty', commandId: remove.commandId }, { kind: 'owner_penalty', commandId: unknown.commandId }]), output])
    const cold = JSON.parse(await readFile(output, 'utf8'))
    expect(cold.resolutions).toEqual([{ outcome: 'applied', result: saved }, { outcome: 'applied', result: deleted }, { outcome: 'not-applied', commandId: unknown.commandId }])
    expect(cold.deleted).toContain(`owner_penalty\u001F${saved.id}`)
    expect(cold.history).toHaveLength(2)
    expect(cold.details).toEqual([])
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionOwnerDocumentService(reopened)
      expect(await owner.resolve('owner_penalty', save.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
      expect(await owner.resolve('owner_penalty', remove.commandId, f.session)).toEqual({ outcome: 'applied', result: deleted })
      await expect(owner.form('owner_penalty', saved.id, f.session)).rejects.toThrow('不存在')
      await expect(owner.execute(unknown, f.session)).rejects.toThrow('封存')
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
}, 20000)

it.each(['owner_penalty', 'owner_change'] as const)('%s 正式盘库删除响应未知后，原session冷回执与受控归档后读释放pending；错kind和撤权拒绝', async (kind) => {
  const f = await fixture()
  let reopened: ReturnType<typeof createProductionStorage> | null = null
  try {
    const saved = await f.owner.execute(f.command(kind, { draft: { projectId: f.project.id, contractId: f.main.id, reason: '原删除恢复核验', ...(kind === 'owner_penalty' ? { amount: null } : { approvedTaxInclusiveAmount: 0 }) } }), f.session)
    await expect(f.owner.form(kind, saved.id, f.session, true)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const values = new Map<string, string>()
    const recovery = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    let owner = f.owner
    let writes = 0
    const reads: Array<{ kind: OwnerCommercialDocumentKind, id: string, includeDeleted: boolean }> = []
    const repository = {
      context: (scope?: OwnerCommercialDocumentKind) => owner.context(scope, f.session),
      loadForm: (scope: OwnerCommercialDocumentKind, id: string, includeDeleted = false) => {
        reads.push({ kind: scope, id, includeDeleted })
        return owner.form(scope, id, f.session, includeDeleted)
      },
      boqLines: async () => [],
      execute: async (request: OwnerCommercialDocumentCommandRequestDTO) => {
        writes++
        await owner.execute(request, f.session)
        throw new Error('正式删除已应用，原响应断开')
      },
      resolve: (scope: OwnerCommercialDocumentKind, descriptor: import('../../app/lib/forms/command-recovery').CommandRecoveryDescriptor) => owner.resolve(scope, descriptor, f.session),
    }
    const current = createOwnerDocumentCommandSession(kind, () => repository, () => recovery)
    const hydrated = await current.actions.hydrate(current.session, saved.id)
    await expect(current.actions.saveForm(current.session, hydrated.form!.draft, 'delete', {})).rejects.toThrow('原响应断开')
    const original = current.session.pending!.descriptor
    expect(current.session.pending!.result).toBeNull()
    expect(values.size).toBe(1)
    await expect(owner.form(kind, saved.id, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(owner.form(kind === 'owner_penalty' ? 'acceptance' : 'owner_penalty', saved.id, f.session, true)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(owner.form(kind, saved.id, () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'owner-document:read') }), true)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await f.storage.close()
    reopened = createProductionStorage(f.options)
    owner = createProductionOwnerDocumentService(reopened)
    const restored = createOwnerDocumentCommandSession(kind, () => repository, () => recovery)
    const verified = await restored.actions.hydrate(restored.session, saved.id)
    expect(verified).toMatchObject({ recovered: true, recoveryOutcome: 'applied', form: { id: saved.id, readOnly: true, deletionVerification: { commandId: original.commandId }, draft: { id: saved.id } } })
    expect(reads.at(-1)).toEqual({ kind, id: saved.id, includeDeleted: true })
    expect(restored.session.pending).toBeNull()
    expect(values.size).toBe(0)
    expect(writes).toBe(1)
    const revalidated = await restored.actions.revalidate(restored.session)
    expect(revalidated.form).toMatchObject({ id: saved.id, readOnly: true, deletionVerification: verified.form!.deletionVerification })
    expect(restored.session.pending).toBeNull()
    expect(values.size).toBe(0)
    expect(writes).toBe(1)
    expect(await owner.resolve(kind, original, f.session)).toMatchObject({ outcome: 'applied', result: { id: saved.id, commandId: original.commandId, deleted: true } })
  }
  finally {
    await reopened?.close()
    await f.storage.close()
  }
}, 20000)

it.each(['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'] as const)('%s 真实HTTP Repository→commandSession保存未知金额后可靠读回null并释放pending，未定义及坏金额拒绝', async (kind) => {
  const f = await fixture()
  try {
    const boq = kind === 'owner_report' ? await monthlySource(f) : null
    if (boq) {
      const current = await boq.owner.read(boq.scope, f.session)
      await boq.owner.execute({ ...boq.command, commandId: 'business-http-unknown-price', contractVersion: current.contractVersion, action: { kind: 'patch-line', lineId: boq.line.id, version: current.lines.find(line => line.id === boq.line.id)!.version, patch: { unitPrice: null } } }, f.session)
      await f.refreshRelationships()
    }
    const scope = boq ? { projectId: f.project.id, contractId: boq.main.id, periodNo: '2026-10', quantityBasis: 'field' } : null
    const [line] = scope ? await f.owner.boqLines(scope, f.session) : []
    const base = { projectId: f.project.id, contractId: f.main.id, name: '未知金额原草稿', reason: '未知金额保原', applicationDate: '2026-10-07' }
    const subcontract = { ...base, contractId: f.sub.id, supplierId: f.supplier.id }
    const drafts = {
      owner_change: { ...base, approvedTaxInclusiveAmount: null, approvedTaxExclusiveAmount: null, appliedTaxExclusiveAmount: null, lines: [] },
      owner_report: { ...base, ...scope, quantityConsumedVersion: line?.quantityConsumedVersion, lines: [{ boqLineId: boq?.line.id, reportedQty: null }] },
      acceptance: { ...base, contractEstimate: null },
      final_settlement: { ...base, settlementAmount: null, submissionDate: '2026-10-07' },
      owner_penalty: { ...base, amount: null, penaltyDate: '2026-10-07' },
      sub_change: { ...subcontract, approvedAmount: null, changeDate: '2026-10-07' },
      sub_settlement: { ...subcontract, totalAmount: null, settlementDate: '2026-10-07' },
      project_penalty: { ...subcontract, amount: null, penaltyDate: '2026-10-07' },
    }
    const key = { owner_change: 'approvedTaxInclusiveAmount', owner_report: 'reportedAmount', acceptance: 'contractEstimate', final_settlement: 'settlementAmount', owner_penalty: 'amount', sub_change: 'approvedAmount', sub_settlement: 'totalAmount', project_penalty: 'amount' }[kind]
    let invalid: unknown = null
    let corrupt = false
    let writes = 0
    const repository = createHttpOwnerCommercialDocumentCommandRepository({ fetcher: async (url, options) => {
      if (url.endsWith('/context'))
        return f.owner.context(kind, f.session)
      if (url.endsWith('/form')) {
        const form = await f.owner.form(kind, decodeURIComponent(url.split('/').at(-2)!), f.session)
        return corrupt ? { ...form, draft: { ...form.draft, [key]: invalid } } : form
      }
      if (url.endsWith('/resolve')) {
        const descriptor = options?.body?.descriptor
        return f.owner.resolve(kind, descriptor, f.session)
      }
      writes++
      return f.owner.execute(options?.body, f.session)
    } })
    const values = new Map<string, string>()
    const recovery = {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value) },
      removeItem: (name: string) => { values.delete(name) },
    }
    const current = createOwnerDocumentCommandSession(kind, () => repository, () => recovery)
    await current.actions.hydrate(current.session, null)
    const request = f.command(kind, { draft: drafts[kind] })
    if (!('draft' in request))
      throw new Error('未知金额保存fixture需要真实表单命令')
    const saved = await current.actions.saveForm(current.session, request.draft, 'save', {})
    expect(saved.form.draft[key]).toBeNull()
    expect(saved.readbackConfirmed).toBe(true)
    expect(current.session.pending).toBeNull()
    expect(values.size).toBe(0)
    expect(writes).toBe(1)
    if (kind === 'owner_report') {
      const [currentLine] = await f.owner.boqLines(scope!, f.session)
      expect(currentLine!.unitPrice).toBeNull()
      await expect(current.actions.saveForm(current.session, { ...saved.form.draft, quantityConsumedVersion: currentLine!.quantityConsumedVersion }, 'submit', {})).rejects.toThrow('当前清单单价未知')
      expect(current.session.pending).toBeNull()
      expect(values.size).toBe(0)
      expect((await f.owner.form(kind, saved.id, f.session)).draft.status).toBe('draft')
    }
    for (const bad of [undefined, Number.NaN, 'unknown']) {
      corrupt = true
      invalid = bad
      await expect(repository.loadForm(kind, saved.id)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    }
  }
  finally { await f.storage.close() }
}, 15000)

it('结果未知沿原意图和回执恢复；提交中撤权同事务撤回事实且保固定原意图', async () => {
  const f = await fixture()
  try {
    let loseResult = true
    const transport = createProductionOwnerDocumentService({ ...f.storage, async withTransaction(work) {
      const result = await f.storage.withTransaction(work)
      if (loseResult && result && typeof result === 'object' && 'commandId' in result) {
        loseResult = false
        throw new Error('提交已应用，返回结果丢失')
      }
      return result
    } })
    const request = f.command('owner_penalty', { action: 'submit', draft: { projectId: f.project.id, contractId: f.main.id, amount: 50, penaltyDate: '2026-10-07', reason: '真实联系单' } })
    await expect(transport.execute(request, f.session)).rejects.toThrow('结果丢失')
    const restored = await f.owner.resolve('owner_penalty', request.commandId, f.session)
    expect(restored.outcome).toBe('applied')
    expect(await f.owner.execute(request, f.session)).toEqual(restored.outcome === 'applied' ? restored.result : null)
    const revoking = createProductionOwnerDocumentService({ ...f.storage, withTransaction: work => f.storage.withTransaction(tx => work({ ...tx, async execute(sql, params) {
      await tx.execute(sql, params)
      if (sql.startsWith('INSERT INTO owner_document_history'))
        f.setActor({ ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'owner-document:write') })
    } })) })
    const revoked = f.command('owner_penalty', { draft: { reason: '撤权期间不应应用' } })
    await expect(revoking.execute(revoked, f.session)).rejects.toThrow('权限变化')
    f.setActor(f.actor)
    expect(await f.owner.resolve('owner_penalty', revoked.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: revoked.commandId })
    expect((await f.owner.list('owner_penalty', { origin: 'real' }, f.session)).items).toHaveLength(1)
    await expect(f.storage.withTransaction(async (tx) => {
      await tx.execute('UPDATE owner_penalties SET record_json=json_set(record_json,\'$.amount\',0)')
      await readProductionOwnerDocumentState(tx, f.actor)
    })).rejects.toThrow('不可变审计尾')
  }
  finally { await f.storage.close() }
})

it('八类正式商务单据在独立冷进程读取原头、原件、原回执，验收双视图保持唯一身份', async () => {
  const f = await fixture()
  try {
    const boq = await monthlySource(f)
    const scope = { projectId: f.project.id, contractId: boq.main.id, periodNo: '2026-10', quantityBasis: 'field' }
    const [line] = await f.owner.boqLines(scope, f.session)
    expect(line).toMatchObject({ id: boq.line.id, autoQty: 6, unitPrice: 17 })
    const requests = [
      f.command('owner_change', { action: 'submit', draft: { projectId: f.project.id, contractId: boq.main.id, name: '原编号金额变洽签', reason: '实际签证原因', applicationDate: '2026-10-07', approvedTaxInclusiveAmount: 25 } }),
      f.command('owner_report', { action: 'submit', draft: { ...scope, applicationDate: '2026-10-07', quantityConsumedVersion: line!.quantityConsumedVersion, operatorName: '实际报量人', lines: [{ boqLineId: boq.line.id, reportedQty: 3 }] } }),
      f.command('acceptance', { action: 'submit', draft: { projectId: f.project.id, contractId: f.main.id, name: '原编号竣工验收', applicationDate: '2026-10-07' } }),
      f.command('final_settlement', { draft: { projectId: f.project.id, contractId: f.main.id, name: '原编号最终结算', submissionDate: '2026-10-07', settlementAmount: 0 } }),
      f.command('owner_penalty', { action: 'submit', draft: { projectId: f.project.id, contractId: f.main.id, amount: 50, penaltyDate: '2026-10-07', reason: '实际甲方联系单' } }),
      f.command('sub_change', { action: 'submit', draft: { projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, changeDate: '2026-10-07', reason: '实际分包变更', approvedAmount: 10 } }),
      f.command('sub_settlement', { action: 'submit', draft: { projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, settlementDate: '2026-10-07', name: '原编号分包结算', totalAmount: 2000 } }),
      f.command('project_penalty', { action: 'submit', draft: { projectId: f.project.id, supplierId: f.supplier.id, contractId: f.sub.id, penaltyDate: '2026-10-07', reason: '实际项目罚扣', amount: 1000 } }),
    ]
    const saved = []
    for (const request of requests) {
      if ('attachments' in request)
        request.attachments = { add: [{ fileName: `${request.kind}.txt`, fileSize: 3, mimeType: 'text/plain', category: request.kind === 'acceptance' ? 'acceptance-report' : '', payloadBase64: 'YWJj' }] }
      saved.push(await f.owner.execute(request, f.session))
    }
    const accepted = await f.owner.execute(f.command('acceptance', { action: 'transition-acceptance', id: saved[2]!.id, baseVersion: saved[2]!.version, target: 'accepted', facts: { acceptanceOrganization: '原单位', acceptancePerson: '原验收人', acceptanceDate: '2026-10-07', acceptanceConclusion: '合格' } }), f.session)
    const rectified = await f.owner.execute(f.command('project_penalty', { action: 'rectify-penalty', id: saved[7]!.id, baseVersion: saved[7]!.version, deadline: '2026-10-09', note: '不可变原整改事实' }), f.session)
    const deduction = f.command('project_penalty', { action: 'deduct-penalty', id: saved[7]!.id, baseVersion: rectified.version, settlementId: saved[6]!.id, settlementVersion: saved[6]!.version, amount: 400, note: '原部分抵扣' })
    const deducted = await f.owner.execute(deduction, f.session)
    const before = await f.storage.withTransaction(tx => readProductionOwnerDocumentState(tx, f.actor))
    const cold = await coldRead(f, [...requests.map(request => ({ kind: request.kind, commandId: request.commandId })), { kind: 'project_penalty', commandId: deduction.commandId }])
    expect(cold.resolutions).toEqual([...saved.map(result => ({ outcome: 'applied', result })), { outcome: 'applied', result: deducted }])
    expect(cold.snapshot).toEqual(before.snapshot)
    expect(cold.allDocuments).toEqual(before.allDocuments)
    expect(cold.boqChanges).toHaveLength(1)
    expect(cold.details).toHaveLength(8)
    expect(cold.forms).toHaveLength(8)
    expect(cold.views).toHaveLength(2)
    expect(cold.views.map((view: { document: { id: string } }) => view.document.id)).toEqual([accepted.id, accepted.id])
    expect(cold.lists.every((list: { items: unknown[] }) => list.items.length === 1)).toBe(true)
    expect(cold.files).toHaveLength(8)
    expect(cold.files.every((file: { payloadBase64: string }) => file.payloadBase64 === 'YWJj')).toBe(true)
    const report = cold.allDocuments.find((source: { kind: string }) => source.kind === 'owner_report')
    expect(report).toMatchObject({ amount: 51, quantityBasis: 'field', operatorName: '实际报量人', submittedAt: expect.any(String), lines: [expect.objectContaining({ autoQty: 6, reportedQty: 3, contractUnitPrice: 17 })] })
    const final = cold.details.find((detail: { document: { kind: string } }) => detail.document.kind === 'final_settlement')
    expect(final.document.amounts).toMatchObject({ declared: '0.00', cumulativeReceipts: null })
    expect(cold.allPenaltyDeductions).toEqual(before.allPenaltyDeductions)
    expect(cold.allPenaltyRectifications).toEqual(before.allPenaltyRectifications)
  }
  finally { await f.storage.close() }
}, 30000)

it('报量只消费所选基准、同月完成与有效BOQ量；纯签证价变复算保手工量、提交后冻结', async () => {
  const f = await fixture()
  try {
    const boq = await monthlySource(f)
    const scope = { projectId: f.project.id, contractId: boq.main.id, periodNo: '2026-10', quantityBasis: 'field' }
    const [line] = await f.owner.boqLines(scope, f.session)
    const draft = { ...scope, applicationDate: '2026-10-07', quantityConsumedVersion: line!.quantityConsumedVersion, lines: [{ boqLineId: boq.line.id, reportedQty: 3 }] }
    await f.storage.execute('UPDATE house_type_template_items SET provisional_qty=12,updated_at=\'2026-10-07T10:00:00Z\' WHERE id=\'business-template-line\'')
    const saved = await f.owner.execute(f.command('owner_report', { draft }), f.session)
    expect((await f.owner.form('owner_report', saved.id, f.session)).draft.lines).toEqual([expect.objectContaining({ reportedQty: 3 })])
    const price = await f.owner.execute(f.command('owner_change', { action: 'submit', draft: { projectId: f.project.id, contractId: boq.main.id, name: '实际调价签证', reason: '现行有效单价调整', applicationDate: '2026-10-07', lines: [{ boqLineId: boq.line.id, operation: 'price', newUnitPrice: 21 }] } }), f.session)
    await f.owner.execute(f.command('owner_change', { action: 'approve', id: price.id, baseVersion: price.version, approvedAt: '2026-10-07' }), f.session)
    const repriced = await f.owner.execute(f.command('owner_report', { id: saved.id, baseVersion: saved.version, draft }), f.session)
    expect((await f.owner.detail('owner_report', saved.id, { origin: 'real' }, f.session)).lines).toEqual([expect.objectContaining({ reportedQty: '3', contractUnitPrice: '21.00', amount: '63.00' })])
    await f.storage.execute('UPDATE house_type_template_items SET field_qty=7 WHERE id=\'business-template-line\'')
    await expect(f.owner.execute(f.command('owner_report', { id: saved.id, baseVersion: repriced.version, draft }), f.session)).rejects.toThrow('实际完成量')
    const [current] = await f.owner.boqLines(scope, f.session)
    const submitted = await f.owner.execute(f.command('owner_report', { action: 'submit', id: saved.id, baseVersion: repriced.version, draft: { ...draft, quantityConsumedVersion: current!.quantityConsumedVersion, operatorName: '实际提交人' } }), f.session)
    await f.storage.execute('UPDATE house_type_template_items SET field_qty=9 WHERE id=\'business-template-line\'')
    expect((await f.owner.form('owner_report', saved.id, f.session)).draft).toMatchObject({ lines: [expect.objectContaining({ autoQty: 7, reportedQty: 3, unitPrice: 21, amount: 63 })] })
    await expect(f.owner.execute(f.command('owner_report', { id: saved.id, baseVersion: submitted.version, draft }), f.session)).rejects.toThrow('实际完成量')
  }
  finally { await f.storage.close() }
}, 30000)

it('合法JSON不能冒充商务头或借原回执推进伪历史，缺关联读权仍能读既有变洽签文书', async () => {
  const f = await fixture()
  try {
    const boq = await installProductionBoqFixture(f.storage, f.actor, f.project.id)
    f.setActor(f.actor)
    await f.refreshRelationships()
    const signed = await f.owner.execute(f.command('owner_change', { action: 'submit', draft: { name: '既有真实签证文书', projectId: f.project.id, contractId: boq.main.id, applicationDate: '2026-10-07', reason: '原金额依据', approvedTaxInclusiveAmount: 25 } }), f.session)
    const restricted = () => ({ ...f.actor, capabilities: ['owner-document:read'] })
    const list = await f.owner.list('owner_change', { origin: 'real' }, restricted)
    expect(list.items).toHaveLength(1)
    expect((await f.owner.detail('owner_change', signed.id, { origin: 'real' }, restricted)).document).toMatchObject({ id: signed.id, contract: { state: 'forbidden' } })
    const request = f.command('owner_penalty', { draft: { projectId: f.project.id, contractId: f.main.id, amount: 0, reason: '合法正式原头' } })
    const saved = await f.owner.execute(request, f.session)
    const state = await f.storage.withTransaction(tx => readProductionOwnerDocumentState(tx, f.actor))
    const original = state.allDocuments.find(row => row.id === saved.id)!
    await expect(f.storage.withTransaction(async (tx) => {
      const fake = { ...original, id: 'business-unproven-head', sourceId: 'business-unproven-head' }
      await tx.execute('INSERT INTO owner_penalties VALUES(?,?,?,?,?,?,?,?,NULL)', [fake.id, fake.projectId, fake.contractId, null, null, null, JSON.stringify(fake), fake.version])
      await readProductionOwnerDocumentState(tx, f.actor)
    })).rejects.toThrow('不可变审计尾')
    await expect(f.storage.withTransaction(async (tx) => {
      const fake = { ...original, version: original.version + 1, amount: 100 }
      await tx.execute('UPDATE owner_penalties SET record_json=?,version=? WHERE id=?', [JSON.stringify(fake), fake.version, fake.id])
      await tx.execute('INSERT INTO owner_document_history VALUES(?,?,?,?,?,?,?,?)', ['business-fake-history', fake.kind, fake.id, f.actor.actorId, request.commandId, JSON.stringify(original), JSON.stringify(fake), fake.updatedAt])
      await readProductionOwnerDocumentState(tx, f.actor)
    })).rejects.toThrow('原意图目标及回执')
    expect((await f.owner.form('owner_penalty', saved.id, f.session)).draft.amount).toBe(0)
  }
  finally { await f.storage.close() }
}, 20000)

it('关联合同实际消费事实推进读token并拒绝原采用版本，刷新后仍保留输入', async () => {
  const f = await fixture()
  try {
    const draft = { projectId: f.project.id, contractId: f.main.id, name: '实际合同依据验收', note: '必须保留的用户输入' }
    const saved = await f.owner.execute(f.command('acceptance', { draft }), f.session)
    const before = await f.owner.detail('acceptance', saved.id, { origin: 'real' }, f.session)
    expect((await f.owner.detail('acceptance', saved.id, { origin: 'real' }, f.session)).meta.sourceVersion).toBe(before.meta.sourceVersion)
    const pending = f.command('acceptance', { id: saved.id, baseVersion: saved.version, draft })
    const contracts = createProductionConstructionContractService(f.storage)
    const original = await contracts.form(f.main.id, f.session)
    await contracts.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'construction-contract:write', commandId: 'business-consumed-contract-change', id: f.main.id, baseVersion: original.version, action: 'save', draft: { ...original.draft, amount: 12 }, attachments: {} }, f.session, f.main.id)
    const current = await f.owner.detail('acceptance', saved.id, { origin: 'real' }, f.session)
    expect(current.meta.sourceVersion).not.toBe(before.meta.sourceVersion)
    expect(current.meta.sources.find(source => source.key === 'construction-contracts')?.sourceVersion).not.toBe(before.meta.sources.find(source => source.key === 'construction-contracts')?.sourceVersion)
    await expect(f.owner.execute(pending, f.session)).rejects.toThrow('采用版本已变化')
    expect((await f.owner.form('acceptance', saved.id, f.session)).draft.note).toBe(draft.note)
    await f.refreshRelationships()
    const refreshed = await f.owner.execute(f.command('acceptance', { id: saved.id, baseVersion: saved.version, draft }), f.session)
    expect(refreshed.version).toBe('2')
  }
  finally { await f.storage.close() }
}, 20000)
