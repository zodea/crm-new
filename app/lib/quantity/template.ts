import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, logCreate, selectVisibleSql, softDelete, undoOperationIfUnchanged, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'
import { evaluateQuantityFormula } from './formula'

export type QuantityTemplateRoomKind = 'room' | 'whole_unit'

export interface QuantityTemplateCatalogItem {
  id: string
  projectId: string
  code: string
  name: string
  section: string
  trade: string
  unit: string
  sortOrder: number
}

export interface QuantityTemplateSummary {
  id: string
  projectId: string
  code: string
  name: string
  copiedFromTemplateId: string | null
  sortOrder: number
  updatedAt: string
  unitCount: number
}

export interface QuantityTemplateRoom {
  id: string
  templateId: string
  code: string
  name: string
  kind: QuantityTemplateRoomKind
  sortOrder: number
}

export interface QuantityTemplateLine {
  id: string
  roomId: string
  itemId: string
  readonly boqLineId: string | null
  readonly recognizedContractQty: number | null
  contractQty: number | null
  provisionalQty: number | null
  fieldFormula: string
  fieldQty: number | null
  note: string
  sortOrder: number
}

export interface QuantityTemplateWorkspace {
  projectId: string
  items: readonly QuantityTemplateCatalogItem[]
  templates: readonly QuantityTemplateSummary[]
  rooms: readonly QuantityTemplateRoom[]
  lines: readonly QuantityTemplateLine[]
}

export interface QuantityTemplateRoomDraft {
  key: string
  id: string | null
  sourceRoomId?: string | null
  code: string
  name: string
  kind: QuantityTemplateRoomKind
  sortOrder: number
}

export interface QuantityTemplateNewItemDraft {
  key: string
  code: string
  name: string
  section: string
  trade: string
  unit: string
  sortOrder: number
}

export interface QuantityTemplateLineDraft {
  key: string
  id: string | null
  sourceLineId?: string | null
  sourceRoomId?: string | null
  sourceItemId?: string | null
  /** undefined 保留原关联，null 明确解除；字符串为当前项目的稳定清单身份。 */
  boqLineId?: string | null
  /** Current owner proof for a newly selected source; frozen existing links remain independent. */
  boqBindingVersion?: string
  roomKey: string
  /** 既有 item.id，或 newItems 中的 client key。 */
  itemId: string
  readonly recognizedContractQty: number | null
  contractQty: number | null
  provisionalQty: number | null
  fieldFormula: string
  /** 只供草稿展示；保存时始终由 fieldFormula 重新计算。 */
  fieldQty: number | null
  note: string
  sortOrder: number
}

export interface QuantityTemplateDraft {
  id: string | null
  projectId: string
  code: string
  name: string
  copiedFromTemplateId: string | null
  sortOrder: number
  expectedUpdatedAt: string | null
  rooms: QuantityTemplateRoomDraft[]
  newItems: QuantityTemplateNewItemDraft[]
  lines: QuantityTemplateLineDraft[]
  /** 矩阵归档后仍要保存时的显式二次授权（蓝本§六）。 */
  allowArchivedEdit?: boolean
}

interface ItemRow {
  id: string
  project_id: string
  code: string
  name: string
  section: string | null
  trade: string
  unit: string | null
  sort_order: number
}

interface TemplateRow {
  id: string
  project_id: string
  code: string
  name: string | null
  copied_from_template_id: string | null
  sort_order: number
  updated_at: string
}

interface RoomRow {
  id: string
  template_id: string
  code: string
  name: string
  kind: QuantityTemplateRoomKind
  sort_order: number
}

interface LineRow {
  id: string
  room_id: string
  item_id: string
  boq_line_id: string | null
  recognized_contract_qty: number | null
  contract_qty: number | null
  provisional_qty: number | null
  field_formula: string | null
  field_qty: number | null
  note: string | null
  sort_order: number
}

interface NormalizedLineDraft extends QuantityTemplateLineDraft {
  contractQty: number | null
  provisionalQty: number | null
  fieldFormula: string
  fieldQty: number | null
  note: string
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableQuantity(value: number | null, label: string): number | null {
  if (value == null)
    return null
  if (!Number.isFinite(value))
    throw new Error(`${label}必须是有效数字`)
  if (value < 0)
    throw new Error(`${label}不能小于 0`)
  return value
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed)
    throw new Error(`${label}不能为空`)
  return trimmed
}

function strictLog(logId: string | null, message: string): string {
  if (!logId)
    throw new Error(message)
  return logId
}

function normalizeDraft(draft: QuantityTemplateDraft): {
  code: string
  name: string
  sortOrder: number
  rooms: QuantityTemplateRoomDraft[]
  newItems: QuantityTemplateNewItemDraft[]
  lines: NormalizedLineDraft[]
} {
  const code = requireText(draft.code, '户型编码')
  const name = requireText(draft.name, '户型名称')
  const sortOrder = numberValue(draft.sortOrder)
  const roomKeys = new Set<string>()
  const roomCodes = new Set<string>()
  const rooms = draft.rooms.map((room) => {
    if (roomKeys.has(room.key))
      throw new Error('房间草稿标识重复')
    roomKeys.add(room.key)
    const roomCode = requireText(room.code, '房间编码')
    const normalizedCode = roomCode.toLocaleLowerCase('zh-CN')
    if (roomCodes.has(normalizedCode))
      throw new Error(`房间编码重复：${roomCode}`)
    roomCodes.add(normalizedCode)
    return {
      ...room,
      code: roomCode,
      name: requireText(room.name, '房间名称'),
      sortOrder: numberValue(room.sortOrder),
    }
  })
  const wholeRooms = rooms.filter(room => room.kind === 'whole_unit')
  if (wholeRooms.length !== 1)
    throw new Error('每个户型必须且只能保留一个整户范围')
  const wholeRoom = wholeRooms[0]!
  if (wholeRoom.code !== '__whole_unit__' || wholeRoom.name !== '整户范围')
    throw new Error('整户范围是系统身份，不能改名或改编码')

  const newItemKeys = new Set<string>()
  const newItemCodes = new Set<string>()
  const newItems = draft.newItems.map((item) => {
    if (newItemKeys.has(item.key))
      throw new Error('新分项草稿标识重复')
    newItemKeys.add(item.key)
    const itemCode = requireText(item.code, '分项编码')
    const normalizedCode = itemCode.toLocaleLowerCase('zh-CN')
    if (newItemCodes.has(normalizedCode))
      throw new Error(`新分项编码重复：${itemCode}`)
    newItemCodes.add(normalizedCode)
    return {
      ...item,
      code: itemCode,
      name: requireText(item.name, '分项名称'),
      trade: requireText(item.trade, '分项工种'),
      section: item.section.trim(),
      unit: item.unit.trim(),
      sortOrder: numberValue(item.sortOrder),
    }
  })

  const lineKeys = new Set<string>()
  const pairKeys = new Set<string>()
  const lines = draft.lines.map<NormalizedLineDraft>((line) => {
    if (lineKeys.has(line.key))
      throw new Error('模板明细草稿标识重复')
    lineKeys.add(line.key)
    if (!roomKeys.has(line.roomKey))
      throw new Error('模板明细引用了不存在的房间')
    if (!line.itemId)
      throw new Error('模板明细必须选择分项')
    const pair = `${line.roomKey}\u0000${line.itemId}`
    if (pairKeys.has(pair))
      throw new Error('同一房间不能重复添加同一分项')
    pairKeys.add(pair)
    const evaluation = evaluateQuantityFormula(line.fieldFormula)
    if (!evaluation.ok)
      throw new Error(`现场量算式无效：${evaluation.error}`)
    if (evaluation.value != null && evaluation.value < 0)
      throw new Error('现场量不能小于 0')
    return {
      ...line,
      recognizedContractQty: nullableQuantity(line.recognizedContractQty, '识别合同原量'),
      contractQty: nullableQuantity(line.contractQty, '合同量'),
      provisionalQty: nullableQuantity(line.provisionalQty, '暂估量'),
      fieldFormula: line.fieldFormula.trim(),
      fieldQty: evaluation.value,
      note: line.note.trim(),
      sortOrder: numberValue(line.sortOrder),
    }
  })

  return { code, name, sortOrder, rooms, newItems, lines }
}

function mapItem(row: ItemRow): QuantityTemplateCatalogItem {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    section: row.section ?? '',
    trade: row.trade,
    unit: row.unit ?? '',
    sortOrder: numberValue(row.sort_order),
  }
}

function mapRoom(row: RoomRow): QuantityTemplateRoom {
  return {
    id: row.id,
    templateId: row.template_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    sortOrder: numberValue(row.sort_order),
  }
}

function mapLine(row: LineRow): QuantityTemplateLine {
  return {
    id: row.id,
    roomId: row.room_id,
    itemId: row.item_id,
    boqLineId: row.boq_line_id,
    recognizedContractQty: row.recognized_contract_qty,
    contractQty: row.contract_qty,
    provisionalQty: row.provisional_qty,
    fieldFormula: row.field_formula ?? '',
    fieldQty: row.field_qty,
    note: row.note ?? '',
    sortOrder: numberValue(row.sort_order),
  }
}

export async function loadQuantityTemplateWorkspace(db: SoftDb, projectId: string): Promise<QuantityTemplateWorkspace> {
  const [itemRows, templateRows, roomRows, lineRows, unitCounts] = await Promise.all([
    db.select<ItemRow>(selectVisibleSql('items', 'AND project_id = ? ORDER BY sort_order, code, id'), [projectId]),
    db.select<TemplateRow>(
      selectVisibleSql('house_type_templates', 'AND project_id = ? ORDER BY sort_order, code, id'),
      [projectId],
    ),
    db.select<RoomRow>(
      `${hiddenCtes('rooms')}
       SELECT r.*
       FROM rooms r
       JOIN house_type_templates ht ON ht.id = r.template_id
       WHERE ${visibleCond('rooms', 'r')} AND ht.project_id = ?
       ORDER BY ht.sort_order, r.sort_order, r.code, r.id`,
      [projectId],
    ),
    db.select<LineRow>(
      `${hiddenCtes('house_type_template_items')}
       SELECT hti.*
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       JOIN house_type_templates ht ON ht.id = r.template_id
       JOIN items i ON i.id = hti.item_id
       WHERE ${visibleCond('house_type_template_items', 'hti')}
         AND ht.project_id = ?
         AND i.project_id = ?
       ORDER BY ht.sort_order, r.sort_order, hti.sort_order, hti.id`,
      [projectId, projectId],
    ),
    db.select<{ template_id: string, total: number }>(
      `${hiddenCtes('units')}
       SELECT u.house_type_template_id AS template_id, COUNT(*) AS total
       FROM units u
       JOIN floors f ON f.id = u.floor_id
       JOIN buildings b ON b.id = f.building_id
       WHERE ${visibleCond('units', 'u')} AND b.project_id = ?
       GROUP BY u.house_type_template_id`,
      [projectId],
    ),
  ])
  const counts = new Map(unitCounts.map(row => [row.template_id, numberValue(row.total)]))
  return {
    projectId,
    items: itemRows.map(mapItem),
    templates: templateRows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      code: row.code,
      name: row.name || row.code,
      copiedFromTemplateId: row.copied_from_template_id,
      sortOrder: numberValue(row.sort_order),
      updatedAt: row.updated_at,
      unitCount: counts.get(row.id) ?? 0,
    })),
    rooms: roomRows.map(mapRoom),
    lines: lineRows.map(mapLine),
  }
}

export function blankQuantityTemplateDraft(projectId: string): QuantityTemplateDraft {
  return {
    id: null,
    projectId,
    code: '',
    name: '',
    copiedFromTemplateId: null,
    sortOrder: 0,
    expectedUpdatedAt: null,
    rooms: [{
      key: 'new:whole-unit',
      id: null,
      code: '__whole_unit__',
      name: '整户范围',
      kind: 'whole_unit',
      sortOrder: -1,
    }],
    newItems: [],
    lines: [],
  }
}

/** 固化一次保存输入，避免响应式草稿在异步事务期间继续变化。 */
export function snapshotQuantityTemplateDraft(draft: QuantityTemplateDraft): QuantityTemplateDraft {
  return {
    ...draft,
    rooms: draft.rooms.map(room => ({ ...room })),
    newItems: draft.newItems.map(item => ({ ...item })),
    lines: draft.lines.map(line => ({ ...line })),
  }
}

export function editableQuantityTemplateDraft(
  workspace: QuantityTemplateWorkspace,
  templateId: string,
): QuantityTemplateDraft {
  const template = workspace.templates.find(candidate => candidate.id === templateId)
  if (!template)
    throw new Error('户型模板不存在')
  const rooms = workspace.rooms.filter(room => room.templateId === templateId)
  const roomIds = new Set(rooms.map(room => room.id))
  return {
    id: template.id,
    projectId: template.projectId,
    code: template.code,
    name: template.name,
    copiedFromTemplateId: template.copiedFromTemplateId,
    sortOrder: template.sortOrder,
    expectedUpdatedAt: template.updatedAt,
    rooms: rooms.map(room => ({
      key: room.id,
      id: room.id,
      code: room.code,
      name: room.name,
      kind: room.kind,
      sortOrder: room.sortOrder,
    })),
    newItems: [],
    lines: workspace.lines
      .filter(line => roomIds.has(line.roomId))
      .map(line => ({
        key: line.id,
        id: line.id,
        roomKey: line.roomId,
        itemId: line.itemId,
        boqLineId: line.boqLineId,
        recognizedContractQty: line.recognizedContractQty,
        contractQty: line.contractQty,
        provisionalQty: line.provisionalQty,
        fieldFormula: line.fieldFormula,
        fieldQty: line.fieldQty,
        note: line.note,
        sortOrder: line.sortOrder,
      })),
  }
}

export function borrowedQuantityTemplateDraft(
  workspace: QuantityTemplateWorkspace,
  sourceTemplateId: string,
): QuantityTemplateDraft {
  const source = editableQuantityTemplateDraft(workspace, sourceTemplateId)
  const roomKeyMap = new Map<string, string>()
  const rooms = source.rooms.map((room) => {
    const key = `borrow-room:${room.id}`
    roomKeyMap.set(room.key, key)
    return {
      ...room,
      key,
      id: null,
      sourceRoomId: room.id,
    }
  })
  return {
    ...source,
    id: null,
    code: '',
    name: '',
    copiedFromTemplateId: sourceTemplateId,
    expectedUpdatedAt: null,
    rooms,
    lines: source.lines.map(line => ({
      ...line,
      key: `borrow-line:${line.id}`,
      id: null,
      sourceLineId: line.id,
      sourceRoomId: line.roomKey,
      sourceItemId: line.itemId,
      roomKey: roomKeyMap.get(line.roomKey)!,
    })),
  }
}

async function insertCatalogItems(
  db: SoftDb,
  projectId: string,
  items: QuantityTemplateNewItemDraft[],
  existingItems: readonly ItemRow[],
  now: string,
  logIds: string[],
): Promise<Map<string, string>> {
  const existingCodes = new Set(existingItems.map(item => item.code.toLocaleLowerCase('zh-CN')))
  const ids = new Map<string, string>()
  for (const item of items) {
    const codeKey = item.code.toLocaleLowerCase('zh-CN')
    if (existingCodes.has(codeKey))
      throw new Error(`当前项目已存在分项编码：${item.code}`)
    existingCodes.add(codeKey)
    const id = generateId('qty_item')
    await db.execute(
      `INSERT INTO items
        (id, project_id, code, name, section, trade, unit, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, item.code, item.name, item.section || null, item.trade, item.unit || null, item.sortOrder, now, now],
    )
    logIds.push(strictLog(await logCreate(db, 'items', id), '新增分项未能记录操作日志'))
    ids.set(item.key, id)
  }
  return ids
}

export async function persistQuantityTemplate(
  db: SoftDb,
  draft: QuantityTemplateDraft,
  options: { boqLines?: readonly { id: string, qty: number | null }[] } = {},
): Promise<{ templateId: string, logIds: string[] }> {
  const [project] = await db.select<{ id: string, matrix_archived_at: string | null }>(
    `${selectVisibleSql('projects')} AND id = ?`,
    [draft.projectId],
  )
  if (!project)
    throw new Error('当前项目不存在或已删除')
  // 归档门先于输入校验：矩阵已归档时无论草稿内容如何都不接受写入。
  if (project.matrix_archived_at && !draft.allowArchivedEdit)
    throw new Error('工程量矩阵已归档，请二次确认后再修改户型模板')
  const normalized = normalizeDraft(draft)

  const existingItems = await db.select<ItemRow>(
    selectVisibleSql('items', 'AND project_id = ?'),
    [draft.projectId],
  )
  const itemById = new Map(existingItems.map(item => [item.id, item]))
  const newItemKeys = new Set(normalized.newItems.map(item => item.key))
  for (const key of newItemKeys) {
    if (itemById.has(key))
      throw new Error('新分项草稿标识不能与既有分项身份重复')
  }
  for (const line of normalized.lines) {
    if (!itemById.has(line.itemId) && !newItemKeys.has(line.itemId))
      throw new Error('模板明细分项不属于当前项目')
  }

  const sourceRoomById = new Map<string, RoomRow>()
  const sourceLineById = new Map<string, LineRow>()
  if (draft.copiedFromTemplateId) {
    const [source] = await db.select<TemplateRow>(
      'SELECT * FROM house_type_templates WHERE id = ? AND project_id = ?',
      [draft.copiedFromTemplateId, draft.projectId],
    )
    if (!source)
      throw new Error('借用来源模板不属于当前项目')
    // 物理读取只验证 provenance 身份；复制值仍取点击“借用”时捕获的草稿快照。
    // transaction tx 直连底层连接，必须顺序执行，不能用 Promise.all 跨连接竞态。
    const sourceRooms = await db.select<RoomRow>('SELECT * FROM rooms WHERE template_id = ?', [source.id])
    const sourceLines = await db.select<LineRow>(
      `SELECT hti.*
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       WHERE r.template_id = ?`,
      [source.id],
    )
    for (const room of sourceRooms)
      sourceRoomById.set(room.id, room)
    for (const line of sourceLines)
      sourceLineById.set(line.id, line)
  }

  const now = new Date().toISOString()
  const logIds: string[] = []
  let templateId = draft.id
  let currentTemplate: TemplateRow | null = null
  let currentRooms: RoomRow[] = []
  let currentLines: LineRow[] = []

  if (templateId) {
    const [row] = await db.select<TemplateRow>(
      `${selectVisibleSql('house_type_templates')} AND id = ? AND project_id = ?`,
      [templateId, draft.projectId],
    )
    if (!row)
      throw new Error('户型模板不存在或不属于当前项目')
    if (draft.expectedUpdatedAt !== row.updated_at)
      throw new Error('户型模板已被其他会话更新，请重新加载后再编辑')
    if (draft.copiedFromTemplateId !== row.copied_from_template_id)
      throw new Error('借用来源仅能在创建模板时确定')
    currentTemplate = row
    currentRooms = await db.select<RoomRow>(
      `${selectVisibleSql('rooms')} AND template_id = ?`,
      [templateId],
    )
    currentLines = await db.select<LineRow>(
      `${hiddenCtes('house_type_template_items')}
       SELECT hti.*
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       WHERE ${visibleCond('house_type_template_items', 'hti')} AND r.template_id = ?`,
      [templateId],
    )
  }
  else {
    templateId = generateId('qty_tpl')
  }

  const duplicateCode = await db.select<{ id: string }>(
    `${selectVisibleSql('house_type_templates')} AND project_id = ? AND lower(code) = lower(?) AND id <> ?`,
    [draft.projectId, normalized.code, templateId],
  )
  if (duplicateCode.length)
    throw new Error(`当前项目已存在户型编码：${normalized.code}`)

  const existingRoomById = new Map(currentRooms.map(room => [room.id, room]))
  const existingLineById = new Map(currentLines.map(line => [line.id, line]))
  const submittedRoomIds = new Set<string>()
  for (const room of normalized.rooms) {
    if (!room.id)
      continue
    if (submittedRoomIds.has(room.id))
      throw new Error('同一房间身份不能在草稿中重复出现')
    submittedRoomIds.add(room.id)
    const existing = existingRoomById.get(room.id)
    if (!existing || existing.template_id !== templateId)
      throw new Error('房间不属于当前户型模板')
    if (existing.kind !== room.kind)
      throw new Error('房间类型不能修改')
    if (existing.code !== room.code)
      throw new Error('房间编码创建后不能修改')
    if (existing.kind === 'whole_unit'
      && (existing.code !== room.code || existing.name !== room.name || existing.template_id !== templateId)) {
      throw new Error('整户范围是系统身份，不能修改')
    }
  }
  const submittedLineIds = new Set<string>()
  for (const line of normalized.lines) {
    if (!line.id)
      continue
    if (submittedLineIds.has(line.id))
      throw new Error('同一模板明细身份不能在草稿中重复出现')
    submittedLineIds.add(line.id)
    if (!existingLineById.has(line.id))
      throw new Error('模板明细不属于当前户型模板')
  }

  const roomDraftByKey = new Map(normalized.rooms.map(room => [room.key, room]))
  const sourceRoomIds = new Set<string>()
  for (const room of normalized.rooms) {
    if (!room.sourceRoomId)
      continue
    if (!draft.copiedFromTemplateId)
      throw new Error('仅借用模板草稿可以携带来源房间')
    if (sourceRoomIds.has(room.sourceRoomId))
      throw new Error('借用模板不能重复复制同一来源房间')
    const sourceRoom = sourceRoomById.get(room.sourceRoomId)
    if (!sourceRoom || sourceRoom.kind !== room.kind)
      throw new Error('借用模板的来源房间不匹配')
    sourceRoomIds.add(room.sourceRoomId)
  }
  const sourceLineIds = new Set<string>()
  for (const line of normalized.lines) {
    if (!line.sourceLineId) {
      if (line.sourceRoomId || line.sourceItemId)
        throw new Error('借用模板明细来源信息不完整')
      continue
    }
    if (!draft.copiedFromTemplateId || !line.sourceRoomId || !line.sourceItemId)
      throw new Error('借用模板明细来源信息不完整')
    if (sourceLineIds.has(line.sourceLineId))
      throw new Error('借用模板不能重复复制同一来源明细')
    sourceLineIds.add(line.sourceLineId)
    const room = roomDraftByKey.get(line.roomKey)
    const sourceLine = sourceLineById.get(line.sourceLineId)
    if (!sourceLine
      || sourceLine.room_id !== line.sourceRoomId
      || sourceLine.item_id !== line.sourceItemId
      || room?.sourceRoomId !== line.sourceRoomId
      || line.sourceItemId !== line.itemId) {
      throw new Error('借用模板明细的来源房间或分项不匹配')
    }
  }
  const keptExistingRoomIds = new Set(normalized.rooms.flatMap(room => room.id ? [room.id] : []))
  const removedRooms = currentRooms.filter(room => room.kind !== 'whole_unit' && !keptExistingRoomIds.has(room.id))
  const removedRoomIds = new Set(removedRooms.map(room => room.id))
  const keptLineIds = new Set<string>()
  const normalizedLineById = new Map<string, NormalizedLineDraft>()
  for (const line of normalized.lines) {
    if (!line.id)
      continue
    const existing = existingLineById.get(line.id)!
    const room = roomDraftByKey.get(line.roomKey)
    if (room?.id === existing.room_id && itemById.has(line.itemId) && line.itemId === existing.item_id) {
      keptLineIds.add(existing.id)
      normalizedLineById.set(existing.id, line)
    }
  }
  const obsoleteLines = currentLines.filter(line => !removedRoomIds.has(line.room_id) && !keptLineIds.has(line.id))

  const boqByKey = new Map<string, { id: string | null, recognizedQty: number | null }>()
  for (const line of normalized.lines) {
    const existing = line.id && keptLineIds.has(line.id) ? existingLineById.get(line.id) : undefined
    const id = line.boqLineId === undefined ? existing?.boq_line_id ?? null : line.boqLineId
    let recognizedQty = existing?.recognized_contract_qty ?? (line.sourceLineId ? line.recognizedContractQty : null)
    if (id && id !== existing?.boq_line_id) {
      const rows = options.boqLines ?? await db.select<{ id: string, qty: number | null }>(
        `${selectVisibleSql('boq_lines')} AND project_id = ? AND id = ?`,
        [draft.projectId, id],
      )
      const selected = rows.find(row => row.id === id)
      if (!selected)
        throw new Error('关联清单不存在、已删除或不属于当前项目，请重新选择')
      const source = line.sourceLineId ? sourceLineById.get(line.sourceLineId) : undefined
      recognizedQty = source?.boq_line_id === id ? line.recognizedContractQty : selected.qty
    }
    boqByKey.set(line.key, { id, recognizedQty })
  }

  const scopeRows = templateId
    ? await db.select<{ room_id: string, item_id: string }>(
        `${hiddenCtes('unit_assignment_scopes')}
         SELECT uas.room_id, uas.item_id
         FROM unit_assignment_scopes uas
         JOIN rooms r ON r.id = uas.room_id
         WHERE ${visibleCond('unit_assignment_scopes', 'uas')} AND r.template_id = ?`,
        [templateId],
      )
    : []
  const scopedRooms = new Set(scopeRows.map(scope => scope.room_id))
  const scopedPairs = new Set(scopeRows.map(scope => `${scope.room_id}\u0000${scope.item_id}`))
  for (const room of removedRooms) {
    if (scopedRooms.has(room.id))
      throw new Error(`房间「${room.name}」仍被个人责任范围引用，不能直接删除`)
  }
  for (const line of obsoleteLines) {
    if (scopedPairs.has(`${line.room_id}\u0000${line.item_id}`))
      throw new Error('该房间分项仍被个人责任范围引用，不能直接删除')
  }

  const headerChanged = currentTemplate != null && (
    currentTemplate.code !== normalized.code
    || (currentTemplate.name ?? currentTemplate.code) !== normalized.name
    || numberValue(currentTemplate.sort_order) !== normalized.sortOrder
  )
  const roomChanged = normalized.rooms.some((room) => {
    if (!room.id)
      return room.kind === 'room'
    const existing = existingRoomById.get(room.id)!
    return existing.name !== room.name
      || numberValue(existing.sort_order) !== room.sortOrder
  }) || removedRooms.length > 0
  const lineChanged = normalized.lines.some((line) => {
    if (!line.id || !keptLineIds.has(line.id))
      return true
    const existing = existingLineById.get(line.id)!
    return existing.boq_line_id !== boqByKey.get(line.key)!.id
      || existing.recognized_contract_qty !== boqByKey.get(line.key)!.recognizedQty
      || existing.contract_qty !== line.contractQty
      || existing.provisional_qty !== line.provisionalQty
      || (existing.field_formula ?? '') !== line.fieldFormula
      || existing.field_qty !== line.fieldQty
      || (existing.note ?? '') !== line.note
      || numberValue(existing.sort_order) !== line.sortOrder
  }) || obsoleteLines.length > 0
  const aggregateChanged = currentTemplate == null
    || headerChanged
    || roomChanged
    || lineChanged
    || normalized.newItems.length > 0
  if (currentTemplate && !aggregateChanged)
    return { templateId, logIds }

  if (!currentTemplate) {
    await db.execute(
      `INSERT INTO house_type_templates
        (id, project_id, code, name, copied_from_template_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, draft.projectId, normalized.code, normalized.name, draft.copiedFromTemplateId, normalized.sortOrder, now, now],
    )
    logIds.push(strictLog(await logCreate(db, 'house_type_templates', templateId), '新增户型模板未能记录操作日志'))
    currentRooms = await db.select<RoomRow>(
      `${selectVisibleSql('rooms')} AND template_id = ?`,
      [templateId],
    )
  }
  else {
    logIds.push(strictLog(await withUpdateLog(db, 'house_type_templates', templateId, () => db.execute(
      `UPDATE house_type_templates
       SET code = ?, name = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      [normalized.code, normalized.name, normalized.sortOrder, now, templateId],
    )), '更新户型模板未能记录操作日志'))
  }

  const newItemIds = await insertCatalogItems(
    db,
    draft.projectId,
    normalized.newItems,
    existingItems,
    now,
    logIds,
  )
  const resolveItemId = (key: string) => newItemIds.get(key) ?? key

  const roomIdsByKey = new Map<string, string>()
  const wholeDraft = normalized.rooms.find(room => room.kind === 'whole_unit')!
  const physicalWhole = currentRooms.find(room => room.kind === 'whole_unit')
  if (!physicalWhole)
    throw new Error('户型模板缺少系统整户范围')
  if (wholeDraft.id && wholeDraft.id !== physicalWhole.id)
    throw new Error('整户范围身份不属于当前模板')
  roomIdsByKey.set(wholeDraft.key, physicalWhole.id)

  // 先隐藏被移除房间，再插入新房间；这样删除后复用原编码仍能在同一事务内成功。
  for (const room of removedRooms)
    logIds.push(strictLog(await softDelete(db, 'rooms', room.id), '删除模板房间未能记录操作日志'))

  for (const room of normalized.rooms.filter(candidate => candidate.kind === 'room')) {
    if (room.id) {
      const existing = existingRoomById.get(room.id)!
      roomIdsByKey.set(room.key, room.id)
      if (existing.name !== room.name || numberValue(existing.sort_order) !== room.sortOrder) {
        logIds.push(strictLog(await withUpdateLog(db, 'rooms', room.id, () => db.execute(
          `UPDATE rooms SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
          [room.name, room.sortOrder, now, room.id],
        )), '更新模板房间未能记录操作日志'))
      }
      continue
    }
    const id = generateId('qty_room')
    await db.execute(
      `INSERT INTO rooms
        (id, template_id, code, name, kind, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'room', ?, ?, ?)`,
      [id, templateId, room.code, room.name, room.sortOrder, now, now],
    )
    logIds.push(strictLog(await logCreate(db, 'rooms', id), '新增模板房间未能记录操作日志'))
    roomIdsByKey.set(room.key, id)
  }

  // 成对身份变化按“软删旧行 + 新建新行”处理；先删旧行，避免最终唯一键的合法复用被中间态拦截。
  for (const line of obsoleteLines) {
    logIds.push(strictLog(
      await softDelete(db, 'house_type_template_items', line.id),
      '删除模板明细未能记录操作日志',
    ))
  }

  for (const line of normalized.lines) {
    const roomId = roomIdsByKey.get(line.roomKey)
    if (!roomId)
      throw new Error('模板明细引用的房间未能保存')
    const itemId = resolveItemId(line.itemId)
    const existing = line.id ? existingLineById.get(line.id) : null
    const pairUnchanged = existing != null && keptLineIds.has(existing.id)
    const { id: boqLineId, recognizedQty: recognizedContractQty } = boqByKey.get(line.key)!

    if (pairUnchanged) {
      const changed = normalizedLineById.has(existing!.id) && (
        existing!.boq_line_id !== boqLineId
        || existing!.recognized_contract_qty !== recognizedContractQty
        || existing!.contract_qty !== line.contractQty
        || existing!.provisional_qty !== line.provisionalQty
        || (existing!.field_formula ?? '') !== line.fieldFormula
        || existing!.field_qty !== line.fieldQty
        || (existing!.note ?? '') !== line.note
        || numberValue(existing!.sort_order) !== line.sortOrder
      )
      if (changed) {
        logIds.push(strictLog(await withUpdateLog(db, 'house_type_template_items', existing!.id, () => db.execute(
          `UPDATE house_type_template_items
           SET boq_line_id = ?, recognized_contract_qty = ?, contract_qty = ?, provisional_qty = ?, field_formula = ?, field_qty = ?, note = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
          [
            boqLineId,
            recognizedContractQty,
            line.contractQty,
            line.provisionalQty,
            line.fieldFormula || null,
            line.fieldQty,
            line.note || null,
            line.sortOrder,
            now,
            existing!.id,
          ],
        )), '更新模板明细未能记录操作日志'))
      }
      continue
    }

    const id = generateId('qty_line')
    await db.execute(
      `INSERT INTO house_type_template_items
        (id, room_id, item_id, boq_line_id, recognized_contract_qty, contract_qty, provisional_qty,
         field_formula, field_qty, note, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        roomId,
        itemId,
        boqLineId,
        recognizedContractQty,
        line.contractQty,
        line.provisionalQty,
        line.fieldFormula || null,
        line.fieldQty,
        line.note || null,
        line.sortOrder,
        now,
        now,
      ],
    )
    logIds.push(strictLog(await logCreate(db, 'house_type_template_items', id), '新增模板明细未能记录操作日志'))
  }

  return { templateId, logIds }
}

export async function deleteQuantityTemplate(
  db: SoftDb,
  projectId: string,
  templateId: string,
  options: { allowArchivedEdit?: boolean } = {},
): Promise<string> {
  const [project] = await db.select<{ id: string, matrix_archived_at: string | null }>(
    `${selectVisibleSql('projects')} AND id = ?`,
    [projectId],
  )
  if (!project)
    throw new Error('当前项目不存在或已删除')
  if (project.matrix_archived_at && !options.allowArchivedEdit)
    throw new Error('工程量矩阵已归档，请二次确认后再删除户型模板')
  const [template] = await db.select<TemplateRow>(
    `${selectVisibleSql('house_type_templates')} AND id = ? AND project_id = ?`,
    [templateId, projectId],
  )
  if (!template)
    throw new Error('户型模板不存在或不属于当前项目')
  const [count] = await db.select<{ total: number }>(
    `${hiddenCtes('units')}
     SELECT COUNT(*) AS total
     FROM units u
     WHERE ${visibleCond('units', 'u')} AND u.house_type_template_id = ?`,
    [templateId],
  )
  const total = numberValue(count?.total)
  if (total)
    throw new Error(`该户型仍挂靠 ${total} 户，不能删除`)
  return strictLog(await softDelete(db, 'house_type_templates', templateId), '删除户型模板未能记录操作日志')
}

const QUANTITY_UNDO_TABLES = new Set([
  'house_type_templates',
  'rooms',
  'house_type_template_items',
  'items',
])

async function quantityRecordProjectId(db: SoftDb, table: string, recordId: string): Promise<string | null> {
  if (table === 'house_type_templates' || table === 'items') {
    const [row] = await db.select<{ project_id: string }>(
      `SELECT project_id FROM "${table}" WHERE id = ?`,
      [recordId],
    )
    return row?.project_id ?? null
  }
  if (table === 'rooms') {
    const [row] = await db.select<{ project_id: string }>(
      `SELECT ht.project_id
       FROM rooms r
       JOIN house_type_templates ht ON ht.id = r.template_id
       WHERE r.id = ?`,
      [recordId],
    )
    return row?.project_id ?? null
  }
  if (table === 'house_type_template_items') {
    const [row] = await db.select<{ project_id: string }>(
      `SELECT ht.project_id
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       JOIN house_type_templates ht ON ht.id = r.template_id
       WHERE hti.id = ?`,
      [recordId],
    )
    return row?.project_id ?? null
  }
  return null
}

async function visibleReferenceCount(
  db: SoftDb,
  table: 'construction_stage_items' | 'house_type_template_items' | 'rooms' | 'unit_assignment_scopes' | 'units',
  column: string,
  recordId: string,
  extraCondition = '',
): Promise<number> {
  const [row] = await db.select<{ total: number }>(
    `${hiddenCtes(table)}
     SELECT COUNT(*) AS total
     FROM "${table}" child
     WHERE ${visibleCond(table, 'child')} AND child."${column}" = ? ${extraCondition}`,
    [recordId],
  )
  return numberValue(row?.total)
}

async function assertNoQuantityUndoDependents(db: SoftDb, table: string, recordId: string): Promise<void> {
  let count = 0
  if (table === 'items') {
    count += await visibleReferenceCount(db, 'house_type_template_items', 'item_id', recordId)
    count += await visibleReferenceCount(db, 'construction_stage_items', 'item_id', recordId)
    count += await visibleReferenceCount(db, 'unit_assignment_scopes', 'item_id', recordId)
  }
  else if (table === 'rooms') {
    count += await visibleReferenceCount(db, 'house_type_template_items', 'room_id', recordId)
    count += await visibleReferenceCount(db, 'unit_assignment_scopes', 'room_id', recordId)
  }
  else if (table === 'house_type_templates') {
    count += await visibleReferenceCount(db, 'units', 'house_type_template_id', recordId)
    // INSERT 模板时 trigger 自动建立的 whole_unit 没有独立日志，随父级隐藏，不算外部依赖。
    count += await visibleReferenceCount(db, 'rooms', 'template_id', recordId, `AND child.kind <> 'whole_unit'`)
  }
  else if (table === 'house_type_template_items') {
    const [line] = await db.select<{ room_id: string, item_id: string }>(
      'SELECT room_id, item_id FROM house_type_template_items WHERE id = ?',
      [recordId],
    )
    if (line) {
      const [row] = await db.select<{ total: number }>(
        `${hiddenCtes('unit_assignment_scopes')}
         SELECT COUNT(*) AS total
         FROM unit_assignment_scopes scope
         WHERE ${visibleCond('unit_assignment_scopes', 'scope')}
           AND scope.room_id = ? AND scope.item_id = ?`,
        [line.room_id, line.item_id],
      )
      count = numberValue(row?.total)
    }
  }
  if (count > 0)
    throw new Error('户型模板保存结果已被后续业务引用，不能撤回')
}

/** 严格、整批撤回一次模板保存；任一记录已被后续修改时由外层事务整体回滚。 */
export async function undoQuantityTemplateOperations(
  db: SoftDb,
  projectId: string,
  logIds: readonly string[],
): Promise<void> {
  if (new Set(logIds).size !== logIds.length)
    throw new Error('户型模板撤回批次包含重复日志')
  for (const logId of [...logIds].reverse()) {
    const [log] = await db.select<{ table_name: string, record_id: string, action: string }>(
      'SELECT table_name, record_id, action FROM operation_logs WHERE id = ?',
      [logId],
    )
    if (!log || !QUANTITY_UNDO_TABLES.has(log.table_name))
      throw new Error('户型模板操作已无法完整撤回')
    if (await quantityRecordProjectId(db, log.table_name, log.record_id) !== projectId)
      throw new Error('户型模板撤回记录不属于当前项目')
    if (log.action === 'create')
      await assertNoQuantityUndoDependents(db, log.table_name, log.record_id)
    if (!await undoOperationIfUnchanged(db, logId))
      throw new Error('户型模板已发生后续修改，不能覆盖新版本')
  }
}
