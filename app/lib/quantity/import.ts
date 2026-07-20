// 工程量导入（ADR 0005 / #103 切片 6B）：模板量、责任配置、阶段完成三类目标 +
// 旧合一行迁移预检。逐行写入全部复用领域唯一写路径（persistQuantityXxx），
// 不建导入专用副本；旧合一行只校验报告，不落库。
import type { SoftDb } from '~/lib/db/soft-delete'
import type { ImportTemplateField } from '~/lib/kit/import-mapping'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { loadQuantityAssignmentWorkspace, persistQuantityAssignments } from './assignment'
import { loadQuantityCompletionWorkspace, persistQuantityStageCompletion } from './completion'
import {
  editableQuantityTemplateDraft,
  loadQuantityTemplateWorkspace,
  persistQuantityTemplate,
} from './template'

export const QUANTITY_TEMPLATE_IMPORT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'projectCode', label: '项目编码', required: true, aliases: ['项目', '项目代码'] },
  { key: 'templateCode', label: '户型编码', required: true, aliases: ['户型', '户型代码'] },
  { key: 'templateName', label: '户型名称', aliases: ['户型名'] },
  { key: 'roomCode', label: '房间编码', required: true, aliases: ['房间', '房间代码'] },
  { key: 'roomName', label: '房间名称', aliases: ['房间名'] },
  { key: 'itemCode', label: '分项编码', required: true, aliases: ['分项', '分项代码'] },
  { key: 'itemName', label: '分项名称', aliases: ['分项名'] },
  { key: 'trade', label: '工种', aliases: ['工种名称'] },
  { key: 'unit', label: '单位', aliases: ['计量单位'] },
  { key: 'contractQty', label: '合同量', aliases: ['清单量', '合同工程量'] },
  { key: 'provisionalQty', label: '暂定量', aliases: ['暂估量'] },
  { key: 'fieldFormula', label: '现场算式', aliases: ['算式', '现场量算式'] },
  { key: 'note', label: '备注', aliases: ['说明'] },
]

export const QUANTITY_ASSIGNMENT_IMPORT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'projectCode', label: '项目编码', required: true, aliases: ['项目', '项目代码'] },
  { key: 'buildingCode', label: '楼栋编码', required: true, aliases: ['楼栋', '栋号'] },
  { key: 'floorCode', label: '楼层编码', required: true, aliases: ['楼层', '层号'] },
  { key: 'unitCode', label: '户编码', required: true, aliases: ['户', '房号'] },
  { key: 'trade', label: '工种', required: true, aliases: ['工种名称'] },
  { key: 'crewName', label: '班组名称', aliases: ['班组'] },
  { key: 'workerName', label: '工人姓名', aliases: ['工人', '个人'] },
  { key: 'note', label: '备注', aliases: ['说明'] },
]

export const QUANTITY_COMPLETION_IMPORT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'projectCode', label: '项目编码', required: true, aliases: ['项目', '项目代码'] },
  { key: 'buildingCode', label: '楼栋编码', required: true, aliases: ['楼栋', '栋号'] },
  { key: 'floorCode', label: '楼层编码', required: true, aliases: ['楼层', '层号'] },
  { key: 'unitCode', label: '户编码', required: true, aliases: ['户', '房号'] },
  { key: 'stageCode', label: '阶段编码', required: true, aliases: ['阶段', '工序阶段'] },
  { key: 'status', label: '状态', aliases: ['完成状态'] },
  { key: 'completedAt', label: '完成日期', required: true, aliases: ['日期', '完成时间'] },
  { key: 'note', label: '备注', aliases: ['说明'] },
]

/** 旧红圈合一行（户+工种+月份+量混录）只进预检；映射到新粒度前不可写入。 */
export const QUANTITY_LEGACY_PRECHECK_FIELDS: readonly ImportTemplateField[] = [
  { key: 'projectCode', label: '项目编码', required: true, aliases: ['项目', '项目代码'] },
  { key: 'buildingCode', label: '楼栋编码', aliases: ['楼栋', '栋号'] },
  { key: 'floorCode', label: '楼层编码', aliases: ['楼层', '层号'] },
  { key: 'unitCode', label: '户编码', required: true, aliases: ['户', '房号'] },
  { key: 'trade', label: '工种', required: true, aliases: ['工种名称'] },
  { key: 'completionMonth', label: '完成月份', aliases: ['月份', '完成月'] },
  { key: 'quantity', label: '工程量', aliases: ['量', '完成量'] },
  { key: 'assigneeName', label: '责任人', aliases: ['班组', '工人'] },
]

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value == null ? '' : String(value).trim()
}

function numOrNull(row: Record<string, unknown>, key: string): number | null {
  const raw = str(row, key)
  if (!raw)
    return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed))
    throw new Error(`「${key === 'quantity' ? '工程量' : '数量'}」不是有效数字：${raw}`)
  return parsed
}

async function findProjectId(db: SoftDb, projectCode: string): Promise<string> {
  if (!projectCode)
    throw new Error('缺少项目编码')
  const [project] = await db.select<{ id: string }>(
    `${selectVisibleSql('projects')} AND code = ?`,
    [projectCode],
  )
  if (!project)
    throw new Error(`项目「${projectCode}」不存在`)
  return project.id
}

interface UnitLookupRow {
  id: string
}

async function findUnitId(
  db: SoftDb,
  projectId: string,
  buildingCode: string,
  floorCode: string,
  unitCode: string,
): Promise<string> {
  const [unit] = await db.select<UnitLookupRow>(
    `SELECT u.id
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     WHERE u.deleted_at IS NULL
       AND f.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND b.project_id = ?
       AND b.code = ?
       AND f.code = ?
       AND u.code = ?`,
    [projectId, buildingCode, floorCode, unitCode],
  )
  if (!unit)
    throw new Error(`户「${buildingCode}-${floorCode}-${unitCode}」不存在`)
  return unit.id
}

/**
 * 模板量逐行导入：定位/追加 户型、房间、分项与量行后整模板保存，
 * 复用 persistQuantityTemplate 的全部不变量（整户范围、活链接、乐观锁）。
 */
export async function importQuantityTemplateRow(db: SoftDb, row: Record<string, unknown>): Promise<void> {
  const projectId = await findProjectId(db, str(row, 'projectCode'))
  const templateCode = str(row, 'templateCode')
  const roomCode = str(row, 'roomCode')
  const itemCode = str(row, 'itemCode')
  if (!templateCode || !roomCode || !itemCode)
    throw new Error('户型编码、房间编码、分项编码均不能为空')

  const workspace = await loadQuantityTemplateWorkspace(db, projectId)
  const existingTemplate = workspace.templates.find(template => template.code === templateCode)
  const draft = existingTemplate
    ? editableQuantityTemplateDraft(workspace, existingTemplate.id)
    : {
        id: null,
        projectId,
        code: templateCode,
        name: str(row, 'templateName') || templateCode,
        copiedFromTemplateId: null,
        sortOrder: (workspace.templates.at(-1)?.sortOrder ?? 0) + 10,
        expectedUpdatedAt: null,
        rooms: [{
          key: 'whole',
          id: null,
          code: '__whole_unit__',
          name: '整户范围',
          kind: 'whole_unit' as const,
          sortOrder: -1,
        }],
        newItems: [],
        lines: [],
      }
  if (str(row, 'templateName'))
    draft.name = str(row, 'templateName')

  let room = roomCode === '__whole_unit__' || roomCode === '整户范围'
    ? draft.rooms.find(candidate => candidate.kind === 'whole_unit')
    : draft.rooms.find(candidate => candidate.code === roomCode)
  if (!room) {
    room = {
      key: `import-room-${roomCode}`,
      id: null,
      code: roomCode,
      name: str(row, 'roomName') || roomCode,
      kind: 'room',
      sortOrder: (draft.rooms.at(-1)?.sortOrder ?? 0) + 10,
    }
    draft.rooms.push(room)
  }
  else if (str(row, 'roomName') && room.kind !== 'whole_unit') {
    room.name = str(row, 'roomName')
  }

  let itemId = workspace.items.find(item => item.code === itemCode)?.id ?? null
  if (!itemId) {
    const pending = draft.newItems.find(item => item.code === itemCode)
    if (pending) {
      itemId = pending.key
    }
    else {
      const trade = str(row, 'trade')
      if (!trade)
        throw new Error(`分项「${itemCode}」不存在，新建分项必须提供工种`)
      const key = `import-item-${itemCode}`
      draft.newItems.push({
        key,
        code: itemCode,
        name: str(row, 'itemName') || itemCode,
        section: '',
        trade,
        unit: str(row, 'unit'),
        sortOrder: (workspace.items.at(-1)?.sortOrder ?? 0) + 10,
      })
      itemId = key
    }
  }

  const contractQty = numOrNull(row, 'contractQty')
  const provisionalQty = numOrNull(row, 'provisionalQty')
  const existingLine = draft.lines.find(line => line.roomKey === room.key && line.itemId === itemId)
  if (existingLine) {
    if (contractQty != null)
      existingLine.contractQty = contractQty
    if (provisionalQty != null)
      existingLine.provisionalQty = provisionalQty
    if (str(row, 'fieldFormula'))
      existingLine.fieldFormula = str(row, 'fieldFormula')
    if (str(row, 'note'))
      existingLine.note = str(row, 'note')
  }
  else {
    draft.lines.push({
      key: `import-line-${roomCode}-${itemCode}`,
      id: null,
      roomKey: room.key,
      itemId,
      // 导入按手工通道处理：识别原值只归 BOQ/OCR 识别链路（切片 3 定稿），persist 层会将其置空。
      recognizedContractQty: null,
      contractQty,
      provisionalQty,
      fieldFormula: str(row, 'fieldFormula'),
      fieldQty: null,
      note: str(row, 'note'),
      sortOrder: (draft.lines.at(-1)?.sortOrder ?? 0) + 10,
    })
  }

  await persistQuantityTemplate(db, draft)
}

/** 责任配置逐行导入：单户 draft 走 persistQuantityAssignments，导入文件视为权威、允许替换。 */
export async function importQuantityAssignmentRow(db: SoftDb, row: Record<string, unknown>): Promise<void> {
  const projectId = await findProjectId(db, str(row, 'projectCode'))
  const unitId = await findUnitId(
    db,
    projectId,
    str(row, 'buildingCode'),
    str(row, 'floorCode'),
    str(row, 'unitCode'),
  )
  const trade = str(row, 'trade')
  const crewName = str(row, 'crewName')
  const workerName = str(row, 'workerName')
  if (!trade)
    throw new Error('缺少工种')
  if ((crewName && workerName) || (!crewName && !workerName))
    throw new Error('班组名称与工人姓名必须二选一')

  const workspace = await loadQuantityAssignmentWorkspace(db, projectId)
  const assignee = workspace.assignees.find(candidate => (
    candidate.kind === (crewName ? 'crew' : 'worker')
    && candidate.name === (crewName || workerName)
  ))
  if (!assignee)
    throw new Error(`${crewName ? '班组' : '工人'}「${crewName || workerName}」不存在`)
  const current = workspace.assignments.find(assignment => (
    assignment.unitId === unitId && assignment.trade === trade
  ))

  await persistQuantityAssignments(db, {
    projectId,
    trade,
    assigneeKind: assignee.kind,
    assigneeId: assignee.id,
    unitIds: [unitId],
    expectedAssignments: [{
      unitId,
      assignmentId: current?.id ?? null,
      fingerprint: current?.fingerprint ?? null,
    }],
    scopes: [],
    note: str(row, 'note') || undefined,
    allowReplacement: true,
    allowArchivedEdit: false,
  })
}

/** 阶段完成逐行导入：历史回填走 allowMissingPhotos 迁移通道，仍按唯一写路径落事实。 */
export async function importQuantityCompletionRow(db: SoftDb, row: Record<string, unknown>): Promise<void> {
  const projectId = await findProjectId(db, str(row, 'projectCode'))
  const unitId = await findUnitId(
    db,
    projectId,
    str(row, 'buildingCode'),
    str(row, 'floorCode'),
    str(row, 'unitCode'),
  )
  const stageCode = str(row, 'stageCode')
  if (!stageCode)
    throw new Error('缺少阶段编码')
  const statusText = str(row, 'status')
  const status = !statusText || statusText === '已完成' || statusText === 'completed'
    ? 'completed' as const
    : statusText === '草稿' || statusText === 'draft'
      ? 'draft' as const
      : null
  if (!status)
    throw new Error(`状态「${statusText}」无效，只支持 已完成 / 草稿`)
  const completedAt = str(row, 'completedAt')
  if (!completedAt)
    throw new Error('缺少完成日期')

  const workspace = await loadQuantityCompletionWorkspace(db, projectId, unitId)
  const stage = workspace.stages.find(candidate => candidate.code === stageCode)
  if (!stage)
    throw new Error(`工序阶段「${stageCode}」不存在或不支持按户完成`)

  await persistQuantityStageCompletion(db, {
    projectId,
    unitId,
    stageId: stage.id,
    status,
    completedAt,
    note: str(row, 'note'),
    expectedCompletionId: stage.completion?.id ?? null,
    expectedCompletionFingerprint: stage.completion?.fingerprint ?? null,
    expectedAssignmentId: stage.currentAssignment?.id ?? null,
    photos: [],
    allowArchivedEdit: false,
    allowMissingPhotos: true,
  })
}

/**
 * 旧合一行迁移预检：只校验可迁移性并报告拆分结果，绝不写库。
 * 行通过 = 可拆为该户该工种逐阶段完成；抛错信息即预检不通过原因。
 */
export async function precheckQuantityLegacyRow(db: SoftDb, row: Record<string, unknown>): Promise<void> {
  const projectId = await findProjectId(db, str(row, 'projectCode'))
  const trade = str(row, 'trade')
  if (!trade)
    throw new Error('缺少工种')
  const unitCode = str(row, 'unitCode')
  if (!unitCode)
    throw new Error('缺少户编码')

  const buildingCode = str(row, 'buildingCode')
  const floorCode = str(row, 'floorCode')
  if (buildingCode && floorCode) {
    await findUnitId(db, projectId, buildingCode, floorCode, unitCode)
  }
  else {
    const units = await db.select<{ id: string }>(
      `SELECT u.id
       FROM units u
       JOIN floors f ON f.id = u.floor_id
       JOIN buildings b ON b.id = f.building_id
       WHERE u.deleted_at IS NULL AND b.project_id = ? AND u.code = ?`,
      [projectId, unitCode],
    )
    if (!units.length)
      throw new Error(`户「${unitCode}」不存在`)
    if (units.length > 1)
      throw new Error(`户「${unitCode}」在项目内不唯一，请补齐楼栋/楼层编码`)
  }

  const stages = await db.select<{ id: string }>(
    selectVisibleSql('construction_stages', `AND project_id = ? AND trade = ? AND completion_mode = 'unit'`),
    [projectId, trade],
  )
  if (!stages.length)
    throw new Error(`工种「${trade}」在项目内没有按户完成的工序阶段，旧合一行无法拆分`)

  const monthText = str(row, 'completionMonth')
  if (monthText && !/^\d{4}[-/年]?\d{1,2}/.test(monthText))
    throw new Error(`完成月份「${monthText}」无法解析`)
  numOrNull(row, 'quantity')
}
