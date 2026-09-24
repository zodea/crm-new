import type { QuantityCommand } from '~/lib/quantity/central-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityRowImporter } from '~/lib/quantity/import-command'
import { editableQuantityTemplateDraft } from '~/lib/quantity/template'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'

const context = { workspaceId: 'quantity-import', actorId: 'import-actor', capabilities: ['quantity:read', 'quantity:write', 'project:list:read', 'crew:list:read', 'worker:list:read', 'construction-contract:read', 'owner-document:read'] }
const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }
const closing: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closing.splice(0))
    await close()
})

function fixture() {
  const projects = [{ id: 'project', code: 'P1', name: '中央项目', dataOrigin: 'real' as const }]
  const people = ['crew-a', 'crew-b'].map((id, index) => ({ id, name: `泥水${index + 1}班`, kind: 'crew' as const, trade: '泥水工', trades: ['泥水工'], itemNames: [], dataOrigin: 'real' as const }))
  const boq = { projectId: 'project', sourceVersion: 'boq:1', lines: [{ id: 'boq', contractId: 'contract', contractName: '施工合同', contractNo: 'HT', itemName: '墙砖', unit: '㎡', qty: 12, unitPrice: 2, approvedDeltaQty: 0, effectiveUnitPrice: 2, building: null, updatedAt: null }] }
  const instance = createQuantityTestInstance({ session: () => context, projects: () => projects, people: () => people, boq: () => structuredClone(boq) })
  closing.push(() => instance.close())
  let sequence = 0
  const command = async (action: unknown): Promise<QuantityCommand> => ({
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    requiredCapability: 'quantity:write',
    commandId: `row-${++sequence}`,
    baseVersion: (await instance.templates(query)).sourceVersion,
    projectId: query.projectId,
    origin: 'real',
    action,
  } as QuantityCommand)
  const save = async (action: unknown) => instance.execute(await command(action))
  return { instance, projects, people, boq, command, save }
}

const templateRow = { projectCode: 'P1', templateCode: 'A', templateName: 'A户型', roomCode: 'living', roomName: '客厅', itemCode: 'wall', itemName: '墙砖', trade: '泥水工', unit: '㎡', contractQty: '0', provisionalQty: '', fieldFormula: '2*3', note: '实际文件行' }
const areaRow = { projectCode: 'P1', buildingCode: 'B', floorCode: 'F', unitCode: '101' }

async function setupUnit() {
  const setup = fixture()
  const template = await setup.save({ kind: 'import-row', target: 'template', row: templateRow, unitId: null, assignee: null })
  const building = await setup.save({ kind: 'create-building', draft: { code: 'B', name: '1栋' } })
  const floor = await setup.save({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F', name: '1层' } })
  const unit = await setup.save({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101户', templateId: template.id } })
  const items = (await setup.instance.templates(query)).data.items
  await setup.save({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'S', name: '铺贴', trade: '泥水工', completionMode: 'unit', sortOrder: 1, itemIds: items.map(item => item.id) } })
  return { ...setup, unitId: unit.id }
}

describe('三类工程量中央日常导入', () => {
  it('模板行按当前中央项目保存，保留零与缺量并复算公式，重试不重复模板或版本', async () => {
    const { instance, command } = fixture()
    const request = await command({ kind: 'import-row', target: 'template', row: templateRow, unitId: null, assignee: null })
    const result = await instance.execute(request)
    expect(await instance.execute(request)).toEqual(result)
    const read = await instance.templates(query)
    expect(read.sourceVersion).toBe(result.sourceVersion)
    expect(read.data.templates).toHaveLength(1)
    expect(read.data.lines).toEqual([expect.objectContaining({ contractQty: 0, provisionalQty: null, fieldQty: 6, recognizedContractQty: null })])
    expect(result.logIds.length).toBeGreaterThan(0)
  })

  it('项目编码需当前唯一且与信封一致；失败不留下模板、分项或新版本', async () => {
    const { instance, projects, command } = fixture()
    const action = { kind: 'import-row', target: 'template', row: templateRow, unitId: null, assignee: null }
    const request = await command(action)
    projects.push({ ...projects[0]!, id: 'duplicate' })
    await expect(instance.execute(request)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    projects.pop()
    await expect(instance.execute({ ...request, action: { ...action, row: { ...templateRow, projectCode: 'OTHER' } } } as QuantityCommand)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(instance.execute(await command({ ...action, row: { ...templateRow, fieldFormula: '1/0' } }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const after = await instance.templates(query)
    expect(after.sourceVersion).toBe(request.baseVersion)
    expect(after.data.templates).toEqual([])
    expect(after.data.items).toEqual([])
  })

  it('模板文件更正保留已识别快照、旧 BOQ 身份和未映射数量', async () => {
    const { instance, save, boq } = fixture()
    const imported = await save({ kind: 'import-row', target: 'template', row: { ...templateRow, provisionalQty: '9' }, unitId: null, assignee: null })
    const draft = editableQuantityTemplateDraft((await instance.templates(query)).data, imported.id)
    draft.lines[0]!.boqLineId = 'boq'
    await save({ kind: 'save-template', draft })
    boq.lines[0]!.qty = 88
    boq.sourceVersion = 'boq:2'
    await save({ kind: 'import-row', target: 'template', row: { ...templateRow, contractQty: '4', note: '只更正手工量' }, unitId: null, assignee: null })
    expect((await instance.templates(query)).data.lines[0]).toMatchObject({ boqLineId: 'boq', recognizedContractQty: 12, contractQty: 4, provisionalQty: 9, fieldQty: 6 })
  })

  it('责任名称与稳定 ID 双重匹配，拒重名、跨户和未同意替换；重复命令也重新验当前人', async () => {
    const { instance, people, unitId, command, save } = await setupUnit()
    const row = { ...areaRow, trade: '泥水工', crewName: '泥水1班' }
    const action = { kind: 'import-row', target: 'assignment', row, unitId, assignee: { kind: 'crew', id: 'crew-a' } }
    const request = await command(action)
    people.push({ ...people[0]!, id: 'duplicate' })
    await expect(instance.execute(request)).rejects.toThrow('不唯一')
    people.pop()
    await expect(save({ ...action, unitId: 'foreign' })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    const saved = await instance.execute(request)
    expect(await instance.execute(request)).toEqual(saved)
    const replacement = { ...action, row: { ...row, crewName: '泥水2班' }, assignee: { kind: 'crew', id: 'crew-b' } }
    await expect(save(replacement)).rejects.toThrow('允许替换')
    expect((await instance.assignments(query)).data.assignments).toMatchObject([{ assigneeId: 'crew-a' }])
    await save({ ...replacement, row: { ...replacement.row, replaceExisting: '是' } })
    expect((await instance.assignments(query)).data.assignments).toMatchObject([{ assigneeId: 'crew-b' }])
    people.shift()
    await expect(instance.execute(request)).rejects.toThrow('不在当前可读')
  })

  it('日常 completed 缺照片逐行拒绝，draft 明确保存，不能夹带迁移旁路或偷偷降级', async () => {
    const { instance, unitId, command, save } = await setupUnit()
    await save({ kind: 'import-row', target: 'assignment', row: { ...areaRow, trade: '泥水工', crewName: '泥水1班' }, unitId, assignee: { kind: 'crew', id: 'crew-a' } })
    const action = { kind: 'import-row', target: 'completion', row: { ...areaRow, stageCode: 'S', status: 'completed', completedAt: '2026-09-11', note: '无照不能完成' }, unitId, assignee: null }
    const request = await command(action)
    await expect(instance.execute(request)).rejects.toThrow('draft')
    expect((await instance.completion({ ...query, unitId })).data.stages[0]!.completion).toBeNull()
    await expect(save({ ...action, row: { ...action.row, allowMissingPhotos: true } })).rejects.toThrow('不支持的字段')
    const draft = await save({ ...action, row: { ...action.row, status: 'draft' } })
    expect(draft.completion?.status).toBe('draft')
    expect((await instance.completion({ ...query, unitId })).data.stages[0]!.completion).toMatchObject({ id: draft.id, status: 'draft' })
  })

  it('日常责任替换和完成备注更正保留完成时责任与已有照片', async () => {
    const { instance, unitId, save } = await setupUnit()
    const assignment = (crewName: string, id: string) => ({ kind: 'import-row', target: 'assignment', row: { ...areaRow, trade: '泥水工', crewName, replaceExisting: '是' }, unitId, assignee: { kind: 'crew', id } })
    await save(assignment('泥水1班', 'crew-a'))
    const stage = (await instance.completion({ ...query, unitId })).data.stages[0]!
    const saved = await save({ kind: 'save-completion', draft: { projectId: 'project', unitId, stageId: stage.id, status: 'completed', completedAt: '2026-09-11', note: '原完成', expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: stage.currentAssignment!.id, photos: [{ fileName: '原件.png', mimeType: 'image/png', fileSize: 1, contentBase64: 'AQ==' }] } })
    await save(assignment('泥水2班', 'crew-b'))
    await save({ kind: 'import-row', target: 'completion', row: { ...areaRow, stageCode: 'S', status: 'completed', completedAt: '2026-09-11', note: '文件更正备注' }, unitId, assignee: null })
    const current = (await instance.completion({ ...query, unitId })).data.stages[0]!
    expect(current.currentAssignment?.assigneeId).toBe('crew-b')
    expect(current.completion).toMatchObject({ id: saved.id, status: 'completed', executionAssigneeName: '泥水1班', note: '文件更正备注' })
    expect(current.photos.map(photo => photo.id)).toEqual(saved.completion!.photoIds)
  })

  it('陈旧版本与更改行内容的命令重试不能覆盖先前结果', async () => {
    const { instance, command } = fixture()
    const action = { kind: 'import-row', target: 'template', row: templateRow, unitId: null, assignee: null }
    const first = await command(action)
    const stale = await command({ ...action, row: { ...templateRow, contractQty: '99' } })
    await instance.execute(first)
    await expect(instance.execute(stale)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await expect(instance.execute({ ...stale, commandId: first.commandId })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await instance.templates(query)).data.lines[0]!.contractQty).toBe(0)
  })

  it('实际 Repository 导入写成功后回读失败不算拒绝，重试复用原行快照和命令', async () => {
    const { instance, projects } = fixture()
    const requests: QuantityCommand[] = []
    let failReadback = true
    const repository = createQuantityRepository(async (url, options) => {
      if (url === '/api/commands/quantity') {
        requests.push(structuredClone(options!.body!))
        return instance.execute(options!.body!)
      }
      if (url === '/api/read/quantity/region')
        return instance.region(options!.query as typeof query)
      if (url === '/api/read/quantity/templates') {
        if (failReadback) {
          failReadback = false
          throw quantityProblem('unavailable', '回读中断')
        }
        return instance.templates(options!.query as typeof query)
      }
      throw new Error(`意外请求 ${url}`)
    })
    const importer = createQuantityRowImporter({ context: async () => context, quantity: repository, projects: async request => ({ items: projects.map(project => ({ dataOrigin: 'real', code: project.code, project: { id: project.id, label: project.name } })), pagination: { page: request.page!, pageSize: request.pageSize!, total: projects.length }, sourceVersion: 'projects:1' }) })
    const row = { ...templateRow }
    await expect(importer('template', row)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    row.contractQty = '999'
    await importer('template', row)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect((await instance.templates(query)).data.lines[0]!.contractQty).toBe(0)
  })

  it('repository 拒绝把 requested completed 的响应降成 draft 或混入另一户责任', async () => {
    const { command } = fixture()
    const request = await command({ kind: 'import-row', target: 'completion', row: { ...areaRow, stageCode: 'S', status: 'completed', completedAt: '2026-09-11' }, unitId: 'unit', assignee: null })
    const result = { commandId: request.commandId, id: 'completion', sourceVersion: 'q:1', logIds: ['log'], completion: { completionId: 'completion', status: 'draft', created: true, changed: true, photoIds: [], logIds: ['log'] } }
    await expect(createQuantityRepository(async () => result).execute(request)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const assignment = await command({ kind: 'import-row', target: 'assignment', row: { ...areaRow, trade: '泥水工', crewName: '泥水1班' }, unitId: 'unit', assignee: { kind: 'crew', id: 'crew-a' } })
    await expect(createQuantityRepository(async () => ({ ...result, commandId: assignment.commandId, id: query.projectId, assignments: { changedUnitIds: ['foreign'], unchangedUnitIds: [], replacedUnitIds: [], assignmentIds: ['assignment'], logIds: ['log'] } })).execute(assignment)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  })
})
