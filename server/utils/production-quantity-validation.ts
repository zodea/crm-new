import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BoqLineRecord } from './production-boq-record'
import { Buffer } from 'node:buffer'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../../app/lib/forms/command-recovery'
import { decodeQuantityCommand } from '../../app/lib/quantity/central-command-decoder'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { readQuantityMigrationGraphs } from '../../app/lib/quantity/migration-source'
import { readProductionBoqRows } from './production-boq-record'
import { validateProductionBoqState } from './production-boq-validation'
import { parseProductionQuantityImportIntent, verifyProductionQuantityImportState } from './production-quantity-migration'
import { assertProductionQuantitySchema, quantityCanonical, quantityDigest } from './production-quantity-record'
import { quantityRecoveryDescriptor } from './production-quantity-service'
import { parseQuantityCommand } from './quantity-request'

/** Read-only validation of the entire registered quantity owner, used by backups and cold recovery. */
export async function validateProductionQuantityState(tx: TransactionDb) {
  await assertProductionQuantitySchema(tx)
  const fail = (message: string): never => {
    throw quantityProblem('unavailable', `工程量持久证据：${message}`)
  }
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!identity)
    return fail('工作区身份缺失')
  const intents = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, project_id: string, fingerprint: string, request_json: string }>('SELECT * FROM quantity_command_intents')
  const receipts = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, project_id: string, fingerprint: string, request_json: string, result_json: string }>('SELECT * FROM quantity_commands')
  const sealed = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, descriptor_json: string | null }>('SELECT * FROM quantity_resolutions')
  const key = (row: { workspace_id: string, actor_id: string, command_id: string }) => quantityCanonical([row.workspace_id, row.actor_id, row.command_id])
  for (const intent of intents) {
    let command
    const raw = JSON.parse(intent.request_json)
    if (raw.family === 'quantity-import') {
      const original = parseProductionQuantityImportIntent(raw)
      if (intent.workspace_id !== identity.workspace_id || intent.actor_id !== identity.owner_id || original.workspaceId !== intent.workspace_id || original.actorId !== intent.actor_id || original.commandId !== intent.command_id || (original.action === 'adopt' ? original.projects[0]?.projectId : original.projectId) !== intent.project_id || intent.fingerprint !== quantityDigest(original))
        return fail('迁入原摘要身份或映射不一致')
      continue
    }
    try {
      command = parseQuantityCommand(raw)
    }
    catch { return fail('原请求 JSON 或封闭命令格式损坏') }
    if (intent.workspace_id !== identity.workspace_id || intent.actor_id !== identity.owner_id || command.workspaceId !== intent.workspace_id || command.actorId !== intent.actor_id || command.commandId !== intent.command_id || command.projectId !== intent.project_id || intent.fingerprint !== quantityDigest(command))
      return fail('原请求身份或摘要不一致')
  }
  for (const receipt of receipts) {
    const intent = intents.find(intent => key(intent) === key(receipt))
    if (!intent || receipt.project_id !== intent.project_id || receipt.fingerprint !== intent.fingerprint || receipt.request_json !== intent.request_json || sealed.some(row => key(row) === key(receipt)))
      return fail('回执缺原请求或与未应用封存冲突')
    try {
      decodeQuantityCommand(JSON.parse(receipt.result_json), parseQuantityCommand(JSON.parse(receipt.request_json)))
    }
    catch { return fail('原结果与请求动作、目标范围不同') }
  }
  for (const row of sealed) {
    if (row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id)
      return fail('封存身份不属于当前 owner')
    if (row.descriptor_json !== null) {
      const descriptor = JSON.parse(row.descriptor_json)
      const codec = createCommandRecoveryStorage(() => ({ getItem: () => row.descriptor_json, setItem: () => fail('核查不能写定位'), removeItem: () => fail('核查不能删除定位') }))
      try {
        codec.read(commandRecoveryKey(descriptor))
      }
      catch { return fail('恢复封套不是最小可靠定位') }
      const intent = intents.find(intent => key(intent) === key(row))
      if (descriptor.workspaceId !== row.workspace_id || descriptor.actorId !== row.actor_id || descriptor.commandId !== row.command_id)
        return fail('原恢复描述身份不一致')
      if (descriptor.family === 'quantity-import') {
        if (!((descriptor.targetId === null && descriptor.action === 'adopt') || (typeof descriptor.targetId === 'string' && descriptor.action === 'restore')) || !/^[a-f0-9]{64}$/.test(descriptor.scopeId))
          return fail('迁入封存范围不一致')
        if (intent) {
          const original = parseProductionQuantityImportIntent(JSON.parse(intent.request_json))
          if (original.action !== descriptor.action || (original.action === 'adopt' ? original.source.sha256 !== descriptor.scopeId : original.sourceSha256 !== descriptor.scopeId || original.importId !== descriptor.targetId))
            return fail('迁入封存不属于原来源或动作')
        }
      }
      else if (descriptor.family !== 'quantity' || (intent && quantityCanonical(quantityRecoveryDescriptor(parseQuantityCommand(JSON.parse(intent.request_json)))) !== row.descriptor_json)) {
        return fail('原恢复描述与原目标或动作不一致')
      }
    }
  }
  const originals = await verifyProductionQuantityImportState(tx)
  // External references are locators only. Each locator must be proven by its current owner or its original SHA graph.
  const locators = await tx.select<{ id: string, project_id: string, contract_id: string }>('SELECT id,project_id,contract_id FROM quantity_boq_references ORDER BY id')
  const [boqOwner] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'boq\'')
  const actualLines = boqOwner?.schema_version === 1 ? await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', undefined, undefined, true) : []
  if (locators.some(locator => actualLines.some(row => row.value.id === locator.id && row.value.projectId === locator.project_id && row.value.contractId === locator.contract_id)))
    await validateProductionBoqState(tx)
  const historical = await tx.select<{ source_sha256: string, evidence_json: string }>('SELECT source_sha256,evidence_json FROM quantity_source_imports')
  for (const locator of locators) {
    const actual = actualLines.find(row => row.value.id === locator.id && row.value.projectId === locator.project_id && row.value.contractId === locator.contract_id)
    const [parent] = actual ? await tx.select<{ project_id: string }>('SELECT project_id FROM construction_contract_records WHERE id=?', [locator.contract_id]) : []
    const old = historical.some((row) => {
      const evidence = JSON.parse(row.evidence_json) as { sourceSha256: string, projects: Array<{ legacyProjectId: string, projectId: string, graph: { boqReferences: Array<{ id: string, contractId: string }> }, sourceGraph: { boqReferences: Array<{ id: string, contractId: string }> } }> }
      return evidence.sourceSha256 === row.source_sha256 && evidence.projects.some(project => project.projectId === locator.project_id && project.graph.boqReferences.some(ref => ref.id === locator.id && ref.contractId === locator.contract_id) && project.sourceGraph.boqReferences.some(ref => ref.id === locator.id && ref.contractId === locator.contract_id))
    })
    if (!(actual && parent?.project_id === locator.project_id) && !old)
      return fail('清单外部引用缺真实上游或同SHA原图依据，索引自身不能证明身份')
  }
  const legacyRead: TransactionDb = { execute: async () => fail('核查不能写库'), async select<T>(sql: string, params?: unknown[]) {
    if (/\bFROM\s+boq_lines\b/i.test(sql))
      return await tx.select('SELECT id,project_id,contract_id,NULL AS deleted_at FROM quantity_boq_references ORDER BY id') as T[]
    if (/\bFROM\s+file_payloads\b/i.test(sql)) {
      const bodies = await tx.select<{ file_ref_id: string, content: Uint8Array, sha256: string }>('SELECT body.* FROM file_payloads body JOIN file_refs file ON file.id=body.file_ref_id WHERE file.owner_type=\'unit_stage_completion\'')
      return bodies.map(body => ({ file_ref_id: body.file_ref_id, encoding: 'base64', content: Buffer.from(body.content).toString('base64') })) as T[]
    }
    return tx.select<T>(sql, params)
  } }
  await readQuantityMigrationGraphs(legacyRead)
  return originals
}
