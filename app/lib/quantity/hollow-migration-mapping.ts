import type { QuantityHollowAction, QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowFact, QuantityHollowLocation, QuantityHollowParty, QuantityHollowProofRef, QuantityHollowTarget } from './central-hollow-contract'
import type { QuantityHollowProvenHistory, QuantityHollowResponsibilityProof } from './central-hollow-proof-contract'
import type { QuantityHollowResponsibilityRows, QuantityHollowRow } from './central-hollow-schema'
import type { QuantityHollowCommandKey, QuantityHollowIdentityBinding, QuantityHollowIdentityTable, QuantityHollowMigrationGraph, QuantityHollowOriginBinding } from './hollow-migration-contract'
import { QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'
import { hollowCommandIdentity, hollowMigrationInvalid, hollowRowKey, parseQuantityHollowMigrationGraph } from './hollow-migration-graph'

type Identity = (table: QuantityHollowIdentityTable, id: string) => string
type CommandIdentity = (key: QuantityHollowCommandKey) => QuantityHollowCommandKey
const foreignKeys: Partial<Record<QuantityHollowIdentityTable, Record<string, QuantityHollowIdentityTable>>> = {
  buildings: { project_id: 'projects' },
  floors: { building_id: 'buildings' },
  units: { floor_id: 'floors', house_type_template_id: 'house_type_templates' },
  house_type_templates: { project_id: 'projects' },
  rooms: { template_id: 'house_type_templates' },
  items: { project_id: 'projects' },
  house_type_template_items: { room_id: 'rooms', item_id: 'items' },
  unit_assignments: { unit_id: 'units', worker_id: 'workers', crew_id: 'crews' },
  unit_assignment_scopes: { assignment_id: 'unit_assignments', room_id: 'rooms', item_id: 'items' },
  quantity_hollow_records: { project_id: 'projects', unit_id: 'units', assignment_id: 'unit_assignments', room_id: 'rooms', item_id: 'items', command_receipt_id: 'quantity_hollow_command_receipts' },
  quantity_hollow_revisions: { record_id: 'quantity_hollow_records', previous_revision_id: 'quantity_hollow_revisions', command_receipt_id: 'quantity_hollow_command_receipts' },
  quantity_hollow_rectifications: { record_id: 'quantity_hollow_records', revision_id: 'quantity_hollow_revisions', command_receipt_id: 'quantity_hollow_command_receipts' },
  quantity_hollow_logs: { project_id: 'projects', record_id: 'quantity_hollow_records', previous_log_id: 'quantity_hollow_logs', revision_id: 'quantity_hollow_revisions', rectification_id: 'quantity_hollow_rectifications', command_receipt_id: 'quantity_hollow_command_receipts' },
  quantity_hollow_command_receipts: { project_id: 'projects', unit_id: 'units', record_id: 'quantity_hollow_records' },
}

/** SQL 命令身份单独命名；不能与回执 PK 混用，不能从 raw request 猜当前命令键。 */
export function quantityHollowMigratedCommandId(namespace: string, key: QuantityHollowCommandKey): string {
  if (!namespace.trim())
    hollowMigrationInvalid('迁入命令缺少来源命名空间')
  return `${namespace}:quantity-hollow-command:${encodeURIComponent(hollowCommandIdentity(key))}`
}

/** 明确类型遍历；任何原 JSON 正文、摘要、版本、姓名、日期及数值均不替换。 */
export function quantityHollowTypedMapper(identity: Identity, commandIdentity: CommandIdentity) {
  const nullable = (table: QuantityHollowIdentityTable, id: string | null) => id === null ? null : identity(table, id)
  function target(value: QuantityHollowTarget): QuantityHollowTarget {
    return { unitId: identity('units', value.unitId), assignmentId: identity('unit_assignments', value.assignmentId), roomId: identity('rooms', value.roomId), itemId: identity('items', value.itemId) }
  }
  function party(value: QuantityHollowParty): QuantityHollowParty {
    return value.kind === 'worker' ? { kind: 'worker', workerId: identity('workers', value.workerId) } : { kind: 'crew', crewId: identity('crews', value.crewId) }
  }
  function location(value: QuantityHollowLocation): QuantityHollowLocation {
    return { ...value, projectId: identity('projects', value.projectId), buildingId: identity('buildings', value.buildingId), floorId: identity('floors', value.floorId), unitId: identity('units', value.unitId), templateId: identity('house_type_templates', value.templateId), templateLineId: identity('house_type_template_items', value.templateLineId), roomId: identity('rooms', value.roomId), itemId: identity('items', value.itemId) }
  }
  function ownership(value: string): string {
    let parts: unknown
    try {
      parts = JSON.parse(value)
    }
    catch { hollowMigrationInvalid('原责任复合键不是 JSON') }
    if (!Array.isArray(parts) || parts.length !== 5 || parts.some(part => typeof part !== 'string'))
      hollowMigrationInvalid('原责任复合键必须是原项目、户、责任、房间、分项')
    return JSON.stringify((['projects', 'units', 'unit_assignments', 'rooms', 'items'] as const).map((table, index) => identity(table, parts[index])))
  }
  function row(table: QuantityHollowIdentityTable, value: QuantityHollowRow): QuantityHollowRow {
    const mapped: QuantityHollowRow = { ...value, id: identity(table, String(value.id)) }
    for (const [column, parent] of Object.entries(foreignKeys[table] ?? {})) mapped[column] = nullable(parent, value[column] as string | null)
    if (table === 'quantity_hollow_records')
      mapped.ownership_key = ownership(String(value.ownership_key))
    if (table === 'quantity_hollow_command_receipts')
      mapped.command_id = commandIdentity({ workspaceId: String(value.workspace_id), actorId: String(value.actor_id), commandId: String(value.command_id) }).commandId
    if (table === 'operation_logs') {
      if (value.table_name !== 'unit_assignments' && value.table_name !== 'unit_assignment_scopes')
        hollowMigrationInvalid('原责任审计身份种类无效')
      mapped.record_id = identity(value.table_name, String(value.record_id))
    }
    return mapped
  }
  function responsibility(value: QuantityHollowResponsibilityProof): QuantityHollowResponsibilityProof {
    return { ...value, target: target(value.target), originalParty: party(value.originalParty), location: location(value.location), ownershipKey: ownership(value.ownershipKey), rows: Object.fromEntries(Object.entries(value.rows).map(([table, rows]) => [table, rows.map(value => row(table as keyof QuantityHollowResponsibilityRows, value))])) as QuantityHollowResponsibilityRows }
  }
  function action(value: QuantityHollowAction): QuantityHollowAction {
    return value.kind === 'create-hollow-inspection' ? { ...value, target: target(value.target) } : { ...value, recordId: identity('quantity_hollow_records', value.recordId), expectedRevisionId: identity('quantity_hollow_revisions', value.expectedRevisionId) }
  }
  function command(value: QuantityHollowCommand): QuantityHollowCommand {
    return { ...value, ...commandIdentity(value), projectId: identity('projects', value.projectId), action: action(value.action) }
  }
  function proof(value: QuantityHollowProofRef): QuantityHollowProofRef {
    return { ...value, recordId: identity('quantity_hollow_records', value.recordId), revisionId: identity('quantity_hollow_revisions', value.revisionId), headLogId: identity('quantity_hollow_logs', value.headLogId), rectificationIds: value.rectificationIds.map(id => identity('quantity_hollow_rectifications', id)) }
  }
  function result(value: QuantityHollowCommandResult, key: QuantityHollowCommandKey): QuantityHollowCommandResult {
    return { ...value, commandId: commandIdentity(key).commandId, id: identity('quantity_hollow_records', value.id), logIds: value.logIds.map(id => identity('quantity_hollow_logs', id)), hollow: { ...value.hollow, recordId: identity('quantity_hollow_records', value.hollow.recordId), unitId: identity('units', value.hollow.unitId), revisionId: identity('quantity_hollow_revisions', value.hollow.revisionId), rectificationId: nullable('quantity_hollow_rectifications', value.hollow.rectificationId), logId: identity('quantity_hollow_logs', value.hollow.logId), proof: proof(value.hollow.proof) } }
  }
  function fact(value: QuantityHollowFact, key: (logId: string, commandId: string) => QuantityHollowCommandKey, outputCommand?: (logId: string, commandId: string) => string): QuantityHollowFact {
    const command = outputCommand ?? ((logId: string, commandId: string) => commandIdentity(key(logId, commandId)).commandId)
    const revisions = value.revisions.map(revision => ({ ...revision, revisionId: identity('quantity_hollow_revisions', revision.revisionId), previousRevisionId: nullable('quantity_hollow_revisions', revision.previousRevisionId), commandId: command(revision.logId, revision.commandId), logId: identity('quantity_hollow_logs', revision.logId) }))
    const rectifications = value.rectifications.map(event => ({ ...event, id: identity('quantity_hollow_rectifications', event.id), revisionId: identity('quantity_hollow_revisions', event.revisionId), commandId: command(event.logId, event.commandId), logId: identity('quantity_hollow_logs', event.logId) }))
    return { ...value, recordId: identity('quantity_hollow_records', value.recordId), target: target(value.target), originalParty: party(value.originalParty), location: location(value.location), ownershipKey: ownership(value.ownershipKey), inspection: revisions.find(revision => revision.revisionId === identity('quantity_hollow_revisions', value.inspection.revisionId))!, revisions, rectifications, proof: proof(value.proof) }
  }
  function history(value: QuantityHollowProvenHistory): QuantityHollowProvenHistory {
    function key(logId: string, commandId: string): QuantityHollowCommandKey {
      const step = value.steps.find(step => step.logId === logId && step.command.commandId === commandId)
      if (!step)
        return hollowMigrationInvalid('历史行缺少对应命令身份')
      return step.command
    }
    return { ...value, projectId: identity('projects', value.projectId), recordId: identity('quantity_hollow_records', value.recordId), responsibility: responsibility(value.responsibility), fact: fact(value.fact, key), steps: value.steps.map(step => ({ ...step, logId: identity('quantity_hollow_logs', step.logId), receiptId: identity('quantity_hollow_command_receipts', step.receiptId), command: command(step.command), result: result(step.result, step.command), proof: proof(step.proof), payload: { ...step.payload, recordId: identity('quantity_hollow_records', step.payload.recordId), previousLogId: nullable('quantity_hollow_logs', step.payload.previousLogId), action: action(step.payload.action), revisionId: identity('quantity_hollow_revisions', step.payload.revisionId), rectificationId: nullable('quantity_hollow_rectifications', step.payload.rectificationId) } })) }
  }
  return { row, history, fact, proof, command, responsibility, ownership }
}

export function quantityHollowBindingMapper(binding: QuantityHollowOriginBinding, reverse = false) {
  const rows = new Map<string, string>()
  const commands = new Map<string, QuantityHollowCommandKey>()
  for (const entry of binding.identities) {
    if (entry.kind === 'row')
      rows.set(hollowRowKey(entry.table, reverse ? entry.exportedId : entry.sourceId), reverse ? entry.sourceId : entry.exportedId)
    else commands.set(hollowCommandIdentity(reverse ? entry.exported : entry.source), reverse ? entry.source : entry.exported)
  }
  return quantityHollowTypedMapper((table, id) => rows.get(hollowRowKey(table, id)) ?? hollowMigrationInvalid(`原件缺少 ${table} 身份映射`), key => commands.get(hollowCommandIdentity(key)) ?? hollowMigrationInvalid('原件缺少命令三元组映射'))
}

export function quantityHollowIdentityCollector() {
  const values = new Map<string, QuantityHollowIdentityBinding>()
  const mapper = quantityHollowTypedMapper((table, id) => {
    values.set(hollowRowKey(table, id), { kind: 'row', table, sourceId: id, exportedId: id })
    return id
  }, (key) => {
    const plain = { workspaceId: key.workspaceId, actorId: key.actorId, commandId: key.commandId }
    values.set(hollowRowKey('command', hollowCommandIdentity(plain)), { kind: 'command', source: plain, exported: plain })
    return plain
  })
  return { ...mapper, identities: () => [...values.values()] }
}

export function mapQuantityHollowMigrationGraph(source: QuantityHollowMigrationGraph, namespace: string, identity: Identity): QuantityHollowMigrationGraph {
  const commandIdentity: CommandIdentity = key => ({ workspaceId: key.workspaceId, actorId: key.actorId, commandId: quantityHollowMigratedCommandId(namespace, key) })
  const mapper = quantityHollowTypedMapper(identity, commandIdentity)
  return parseQuantityHollowMigrationGraph({
    ...source,
    tables: Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, source.tables[table].map(row => mapper.row(table, row))])),
    bindings: source.bindings.map(binding => ({ ...binding, identities: binding.identities.map(entry => entry.kind === 'row' ? { ...entry, exportedId: identity(entry.table, entry.exportedId) } : { ...entry, exported: commandIdentity(entry.exported) }) })),
    rowOrigins: source.rowOrigins.map(entry => ({ ...entry, exportedId: identity(entry.table, entry.exportedId) })),
  })
}
