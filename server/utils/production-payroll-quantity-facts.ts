import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAQuantityDiagnostic, PayrollAQuantityFacts, PayrollAQuantityQuery } from '../../app/lib/payroll/central-a-contract'
import type { BusinessSession } from './business-session'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodeQuantityCommand } from '../../app/lib/quantity/central-command-decoder'
import { commandFingerprint } from './command-journal'
import { loadPayrollAQuantityFacts } from './payroll-quantity-facts'
import { readProductionBoqImportedIdentities } from './production-boq-import-evidence'
import { assertProductionBoq, readProductionBoqQuantityFacts, readProductionBoqRows } from './production-boq-record'
import { readProductionQuantityImportedIdentities, readProductionQuantityImportedProjects } from './production-quantity-migration'
import { quantityDigest } from './production-quantity-record'
import { parseQuantityCommand } from './quantity-request'

/** Only an original applied command can establish a current re-binding; an intent never can. */
async function appliedTemplateBinding(tx: TransactionDb, actor: BusinessSession, projectId: string, templateLineId: string, lineId: string) {
  const cell = (await tx.select<{ room_id: string, template_id: string }>('SELECT h.room_id,r.template_id FROM house_type_template_items h JOIN rooms r ON r.id=h.room_id WHERE h.id=?', [templateLineId]))[0]
  if (!cell)
    return false
  const journal = await tx.select<{ command_id: string, request_json: string, fingerprint: string, result_json: string, intent_request: string, intent_fingerprint: string }>(`SELECT c.command_id,c.request_json,c.fingerprint,c.result_json,i.request_json AS intent_request,i.fingerprint AS intent_fingerprint FROM quantity_commands c
    JOIN quantity_command_intents i ON i.workspace_id=c.workspace_id AND i.actor_id=c.actor_id AND i.command_id=c.command_id
    LEFT JOIN quantity_resolutions r ON r.workspace_id=c.workspace_id AND r.actor_id=c.actor_id AND r.command_id=c.command_id
    WHERE c.workspace_id=? AND c.actor_id=? AND c.project_id=? AND r.command_id IS NULL ORDER BY c.command_id`, [actor.workspaceId, actor.actorId, projectId])
  for (const row of journal) {
    const request = parseQuantityCommand(JSON.parse(row.request_json))
    if (request.commandId !== row.command_id || request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || request.projectId !== projectId || row.request_json !== row.intent_request || row.fingerprint !== row.intent_fingerprint || quantityDigest(request) !== row.fingerprint)
      throw payrollProblem('unavailable', '原工程量采用请求、原意图及回执不能互证')
    if (request.action.kind !== 'save-template')
      continue
    const receipt = decodeQuantityCommand(JSON.parse(row.result_json), request)
    const draft = request.action.draft
    if (receipt.id !== cell.template_id || (draft.id && draft.id !== cell.template_id))
      continue
    const selected = draft.lines.filter(line => line.boqLineId === lineId && typeof line.boqBindingVersion === 'string' && line.boqBindingVersion)
    if (selected.some(line => line.id === templateLineId))
      return true
    // New rows receive their ID from the original owner. Its reliable log-ID receipt
    // identifies that exact row; names or array position never establish identity.
    for (const id of receipt.logIds) {
      const log = (await tx.select<{ after_data: string | null }>('SELECT after_data FROM operation_logs WHERE id=? AND table_name=\'house_type_template_items\' AND record_id=?', [id, templateLineId]))[0]
      const after: unknown = log?.after_data ? JSON.parse(log.after_data) : null
      if (selected.length && after && typeof after === 'object' && 'id' in after && after.id === templateLineId && 'room_id' in after && after.room_id === cell.room_id && 'boq_line_id' in after && after.boq_line_id === lineId)
        return true
    }
  }
  return false
}

/** The caller holds the trusted transaction. Frozen wages bypass this current adoption reader. */
export async function loadProductionPayrollAQuantityFacts(tx: TransactionDb, query: PayrollAQuantityQuery, actor: BusinessSession): Promise<PayrollAQuantityFacts> {
  if (!['quantity:read', 'boq:read', 'construction-contract:read', 'owner-document:read'].every(capability => actor.capabilities.includes(capability)))
    throw payrollProblem('forbidden', '当前身份无本项目工程量、施工主合同及已确认清单来源读取权限')
  await assertProductionBoq(tx, actor)
  const metadata = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  const quantity = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'quantity\''))[0]
  if (metadata?.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId || quantity?.schema_version !== 1)
    throw payrollProblem('unavailable', '正式工程量与已确认上游不属于当前工作区')
  if (!(await readProductionBoqRows(tx, 'boq_lines', query.projectId)).length)
    throw payrollProblem('unavailable', '本项目尚无可核实的施工主合同清单上游，请先核对施工合同及清单')
  const physical = await loadPayrollAQuantityFacts(tx, query)
  const templates = await tx.select<{ id: string, boq_line_id: string | null }>('SELECT id,boq_line_id FROM house_type_template_items ORDER BY id')
  const references = await tx.select<{ id: string, project_id: string, contract_id: string }>('SELECT id,project_id,contract_id FROM quantity_boq_references ORDER BY id')
  const imports = new Map<string, Promise<{ quantity: Awaited<ReturnType<typeof readProductionQuantityImportedIdentities>>, projects: Awaited<ReturnType<typeof readProductionQuantityImportedProjects>>, boq: Awaited<ReturnType<typeof readProductionBoqImportedIdentities>> }>>()
  const qualified = new Map<string, ReturnType<typeof readProductionBoqQuantityFacts>>()
  const rows: PayrollAQuantityFacts['rows'] = []
  const diagnostics: PayrollAQuantityDiagnostic[] = [...physical.diagnostics]
  for (const fact of physical.rows) {
    try {
      const template = templates.find(row => row.id === fact.templateLineId)
      const reference = references.find(row => row.id === template?.boq_line_id)
      if (!template?.boq_line_id || !reference || reference.project_id !== query.projectId)
        throw new Error('现场完成量尚未绑定同项目已确认清单')
      let lineId = reference.id
      let sourceSha256: string | null = null
      const imported = /^qty-([a-f0-9]{64})-/.exec(fact.templateLineId)
      const currentBinding = await appliedTemplateBinding(tx, actor, query.projectId, fact.templateLineId, lineId)
      if (imported && !currentBinding) {
        sourceSha256 = imported[1]!
        let proof = imports.get(sourceSha256)
        if (!proof) {
          proof = Promise.all([readProductionQuantityImportedIdentities(tx, sourceSha256, actor), readProductionQuantityImportedProjects(tx, sourceSha256, actor), readProductionBoqImportedIdentities(tx, sourceSha256, actor)]).then(([quantity, projects, boq]) => ({ quantity, projects, boq }))
          imports.set(sourceSha256, proof)
        }
        const evidence = await proof
        const identity = evidence.quantity.find(row => row.table === 'house_type_template_items' && row.id === fact.templateLineId && row.projectId === query.projectId)
        const project = evidence.projects.find(row => row.projectId === query.projectId && row.sourceGraph.tables.house_type_template_items.some(line => line.id === identity?.legacyId))
        const original = project?.sourceGraph.tables.house_type_template_items.find(row => row.id === identity?.legacyId)
        const adopted = evidence.boq.find(row => row.table === 'boq_lines' && row.legacyId === original?.boq_line_id && row.projectId === query.projectId)
        if (!identity || !original || original.boq_line_id !== reference.id || !adopted || adopted.contractId !== reference.contract_id)
          throw new Error('原工程量与施工清单尚无同一完整原库的双重确认映射，不能按相同编号猜采用')
        lineId = adopted.id
      }
      else if (!currentBinding) {
        throw new Error('该现场清单绑定缺少原已保存工程量命令及可靠回执，请核对原采用来源')
      }
      let upstream = qualified.get(lineId)
      if (!upstream) {
        upstream = readProductionBoqQuantityFacts(tx, query.projectId, actor, { lineIds: [lineId] })
        qualified.set(lineId, upstream)
      }
      const line = (await upstream).lines.find(row => row.id === lineId)
      if (!line || !line.eligible || line.contractId !== reference.contract_id)
        throw new Error('所选完成量的施工主合同或原清单/已批新增依据不可采用，请核对实际来源')
      const productionUpstream = { boqLineId: line.id, mainContractId: line.contractId, qualificationVersion: line.qualificationVersion, sourceSha256 }
      rows.push({ ...fact, productionUpstream, sourceFingerprint: commandFingerprint({ physical: fact.sourceFingerprint, productionUpstream }) })
    }
    catch (cause) {
      diagnostics.push({ code: 'upstream-binding-unavailable', message: cause instanceof Error ? cause.message : '原完成量的清单上游无法核实', affects: 'subject', completionId: fact.completionId, assignmentId: fact.assignmentId, workerId: fact.workerId, crewId: fact.crewId, unitId: fact.unitId, roomId: fact.roomId, itemId: fact.itemId })
    }
  }
  return { rows, diagnostics, sourceVersion: `production-a-upstream:${commandFingerprint({ rows, diagnostics })}` }
}
