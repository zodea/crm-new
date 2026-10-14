import type { ConstructionScopeCommand, ConstructionScopeDomain, ConstructionScopeLink, ConstructionScopeRead, ConstructionScopeResult, ConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { EntityRefDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { decodeConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { commandFingerprint } from './command-journal'
import { readAuxiliaryContractScopeFacts } from './production-auxiliary-contract-record'
import { readProductionConstructionContractFacts, readProductionConstructionContractReference } from './production-construction-contract-sources'
import { readOriginalExpenseReference } from './production-finance-expense-references'
import { validateFinanceJournal } from './production-finance-journal'
import { readMaterialContractScopeFacts } from './production-material-contract-record'
import { readSubcontractContractScopeFacts } from './production-subcontract-contract-sources'

type Row = Record<string, unknown>
export const constructionScopeDigest = (value: unknown) => createHash('sha256').update(commandFingerprint(value)).digest('hex')
export const constructionScopeLinkId = (source: ConstructionScopeSource) => `cscope-${constructionScopeDigest([source.domain, source.id])}`
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const sourceCapability = (domain: ConstructionScopeDomain) => domain === 'original-expense' ? 'finance-reimbursement:read' : `${domain}:read`
const inactive = (status: string) => ['draft', '草稿', '失效', '作废', '已作废', '取消', 'cancelled', 'void'].includes(status)

function command(value: unknown): ConstructionScopeCommand {
  const expected = ['action', 'actorId', 'baseVersion', 'commandId', 'mainBasis', 'mainId', 'projectId', 'requiredCapability', 'source', 'sourceBasis', 'workspaceId']
  if (value && typeof value === 'object' && Object.hasOwn(value, 'originalSourceCommand'))
    expected.push('originalSourceCommand')
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== expected.sort().join(','))
    return financeFailure('validation-failed', '施工合同关联命令包含未知字段或缺少原依据。')
  const row = value as Row
  let source: ConstructionScopeSource
  try {
    source = decodeConstructionScopeSource(row.source)
  }
  catch {
    return financeFailure('validation-failed', '施工合同关联必须指向已接通的真实稳定来源。')
  }
  if (!['commandId', 'workspaceId', 'actorId', 'projectId'].every(key => typeof row[key] === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(String(row[key])))
    || row.requiredCapability !== 'construction-scope:write' || !['bind', 'unbind'].includes(String(row.action)) || !hash(row.sourceBasis)
    || !(row.baseVersion === null || (typeof row.baseVersion === 'string' && /^[1-9]\d*$/.test(row.baseVersion)))
    || (row.action === 'bind' ? !(typeof row.mainId === 'string' && row.mainId && hash(row.mainBasis)) : row.mainId !== null || row.mainBasis !== null)) {
    return financeFailure('validation-failed', '施工合同关联范围、原版本或选择依据无效。')
  }
  if (row.originalSourceCommand !== undefined) {
    const original = row.originalSourceCommand
    if (!original || typeof original !== 'object' || Array.isArray(original) || Object.keys(original).sort().join(',') !== 'commandId,family' || !('family' in original) || original.family !== (source.domain === 'original-expense' ? 'finance-reimbursement' : source.domain) || !('commandId' in original) || typeof original.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(original.commandId))
      return financeFailure('validation-failed', '原来源命令引用必须与当前实际来源职责一致。')
  }
  return { ...row, source } as unknown as ConstructionScopeCommand
}
function link(row: Row): ConstructionScopeLink {
  const source = decodeConstructionScopeSource({ domain: row.source_domain, id: row.source_id })
  if (row.id !== constructionScopeLinkId(source) || typeof row.project_id !== 'string' || !row.project_id || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || !hash(row.source_basis)
    || (row.main_id === null ? row.main_basis !== null || typeof row.deleted_at !== 'string' : typeof row.main_id !== 'string' || !hash(row.main_basis) || row.deleted_at !== null)
    || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) {
    return financeFailure('unavailable', '施工合同关联身份、版本或撤销证据损坏。')
  }
  return { domain: source.domain, sourceId: source.id, id: String(row.id), projectId: row.project_id, mainId: row.main_id as string | null, version: String(row.version), sourceBasis: row.source_basis, mainBasis: row.main_basis as string | null, updatedAt: row.updated_at, deletedAt: row.deleted_at as string | null }
}
export async function assertProductionConstructionScope(tx: TransactionDb, actor: BusinessSession) {
  const metadata = (await tx.select<Row>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  const participant = (await tx.select<Row>('SELECT schema_version FROM production_participants WHERE domain=\'construction-scope\''))[0]
  if (!metadata || metadata.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId || ![1, 2].includes(Number(participant?.schema_version)))
    return financeFailure('unavailable', '施工合同关联尚无当前工作区的正式持久来源。')
}
async function sourceFact(tx: TransactionDb, actor: BusinessSession, source: ConstructionScopeSource, creating = false) {
  if (!actor.capabilities.includes(sourceCapability(source.domain)))
    return financeFailure('forbidden', '当前身份无权读取所选合同或原费用来源。')
  let name = source.id
  let parentId = source.id
  let projectId: string | null = null
  let basis: string | null = null
  let eligible = false
  let reason = '所选正式来源不存在、未确认或已归档，保留原历史关系。'
  if (source.domain !== 'original-expense') {
    const facts = source.domain === 'material-contract' ? await readMaterialContractScopeFacts(tx, actor) : source.domain === 'subcontract-contract' ? await readSubcontractContractScopeFacts(tx, actor) : await readAuxiliaryContractScopeFacts(tx, actor, creating)
    const fact = facts.find(row => row.id === source.id)
    if (fact) {
      name = fact.name
      projectId = fact.projectId
      const draftCreation = creating && ['draft', '草稿'].includes(fact.status)
      eligible = (draftCreation || fact.eligible) && !fact.retired && !fact.deletedAt && (draftCreation || !inactive(fact.status)) && projectId !== null
      basis = constructionScopeDigest({ id: fact.id, projectId, status: fact.status, deletedAt: fact.deletedAt, retired: fact.retired, amount: fact.amount, supplementAmount: fact.supplementAmount })
    }
  }
  else {
    if (!creating)
      await validateFinanceJournal(tx, actor)
    const fact = creating ? null : await readOriginalExpenseReference(tx, actor, source.id)
    const row = (await tx.select<Row>(`SELECT line.id,line.expense_item,line.amount,line.counterparty_supplier_id,line.counterparty_name_snapshot,line.deleted_at AS line_deleted_at,line.original_expense_line_id,
      head.id AS header_id,head.project_id,head.status,head.deleted_at AS head_deleted_at FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id WHERE line.id=?`, [source.id]))[0]
    if (row) {
      parentId = String(row.header_id)
      name = String(row.expense_item)
      projectId = typeof row.project_id === 'string' ? row.project_id : null
      basis = constructionScopeDigest(row)
      eligible = (fact !== null || (creating && row.original_expense_line_id === null && row.line_deleted_at === null && row.head_deleted_at === null && ['draft', 'submitted', 'pending', 'confirmed'].includes(String(row.status)))) && projectId !== null
      if (!projectId)
        reason = '历史公司或无项目费用保留原文；新关联需原费用已有真实项目，不能按付款人推定个人或项目。'
    }
  }
  if (projectId) {
    const project = (await tx.select<Row>('SELECT id,deleted_at FROM projects WHERE id=?', [projectId]))[0]
    if (!project || project.deleted_at !== null) {
      eligible = false
      reason = '原项目缺失或已归档，不能新建施工合同关联。'
    }
  }
  return { source, name, parentId, projectId, basis, eligible, reason: eligible ? null : reason }
}
async function mainFact(tx: TransactionDb, actor: BusinessSession, id: string) {
  const fact = await readProductionConstructionContractReference(tx, actor, id, { includeDeleted: true })
  return { ...fact, eligible: fact.projectId !== null && fact.deletedAt === null && fact.projectDeletedAt === null && fact.customerDeletedAt === null && !inactive(fact.status), basis: constructionScopeDigest({ id, projectId: fact.projectId, status: fact.status, deletedAt: fact.deletedAt, projectDeletedAt: fact.projectDeletedAt, customerDeletedAt: fact.customerDeletedAt }) }
}

/** New source forms choose a qualified main explicitly; this list never creates a reference. */
export async function readProductionConstructionMainOptions(tx: TransactionDb, actor: BusinessSession) {
  if (!['construction-contract:read', 'project:list:read'].every(capability => actor.capabilities.includes(capability)))
    return financeFailure('forbidden', '无真实工程与施工主合同选择权限。')
  const facts = await readProductionConstructionContractFacts(tx, actor)
  const projects = new Map((await tx.select<{ id: string, name: string }>('SELECT id,name FROM projects WHERE deleted_at IS NULL')).map(row => [row.id, row.name]))
  const result = []
  for (const row of facts.contracts) {
    const current = await mainFact(tx, actor, row.id)
    if (current.eligible && current.projectId && projects.has(current.projectId))
      result.push({ id: row.id, projectId: current.projectId, basis: current.basis, name: row.name, no: row.no, projectName: projects.get(current.projectId)! })
  }
  return result
}
async function readLink(tx: TransactionDb, source: ConstructionScopeSource) {
  const row = (await tx.select<Row>('SELECT * FROM construction_scope_links WHERE id=?', [constructionScopeLinkId(source)]))[0]
  return row ? link(row) : null
}

async function applyScopeCommand(tx: TransactionDb, actor: BusinessSession, input: ConstructionScopeCommand, creating = false): Promise<ConstructionScopeResult> {
  const receipt = (await tx.select<{ result_json: string }>('SELECT result_json FROM construction_scope_receipts WHERE command_id=? AND workspace_id=? AND actor_id=?', [input.commandId, actor.workspaceId, actor.actorId]))[0]
  if (receipt)
    return JSON.parse(receipt.result_json)
  if ((await tx.select('SELECT command_id FROM construction_scope_resolutions WHERE command_id=?', [input.commandId])).length)
    return financeFailure('conflict', '该原关联编号已明确未应用并封存，不能迟到写入。')
  const current = await readLink(tx, input.source)
  if ((current?.version ?? null) !== input.baseVersion)
    return financeFailure('conflict', '施工合同关联已变化，请保留输入并重新核对当前关系。')
  const fact = await sourceFact(tx, actor, input.source, creating)
  if ((input.action === 'bind' && !fact.eligible) || !fact.basis || fact.projectId !== input.projectId || fact.basis !== input.sourceBasis)
    return financeFailure('conflict', '所选真实来源、项目或确认状态已变化，不能采用旧依据。')
  let targetBasis: string | null = null
  if (input.action === 'bind') {
    const main = await mainFact(tx, actor, input.mainId!)
    if (!main.eligible || main.projectId !== input.projectId || main.basis !== input.mainBasis)
      return financeFailure('conflict', '施工主合同已变化、归档或属于其他项目。')
    targetBasis = main.basis
  }
  else if (!current || current.mainId === null) {
    return financeFailure('validation-failed', '该来源没有当前关联可撤销。')
  }
  const now = new Date().toISOString()
  const version = current ? Number(current.version) + 1 : 1
  const next: ConstructionScopeLink = { domain: input.source.domain, sourceId: input.source.id, id: constructionScopeLinkId(input.source), projectId: input.projectId, mainId: input.mainId, version: String(version), sourceBasis: fact.basis, mainBasis: targetBasis, updatedAt: now, deletedAt: input.action === 'unbind' ? now : null }
  await tx.execute(`INSERT INTO construction_scope_links VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,main_id=excluded.main_id,version=excluded.version,source_basis=excluded.source_basis,main_basis=excluded.main_basis,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`, [next.id, next.domain, next.sourceId, next.projectId, next.mainId, version, next.sourceBasis, next.mainBasis, now, next.deletedAt])
  await tx.execute('INSERT INTO construction_scope_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [next.id, version, next.domain, input.source.id, next.projectId, next.mainId, next.sourceBasis, next.mainBasis, input.commandId, actor.actorId, now, next.deletedAt])
  const saved = { commandId: input.commandId, relation: next }
  await tx.execute('INSERT INTO construction_scope_receipts VALUES(?,?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, next.id, constructionScopeDigest(input), JSON.stringify(saved), now])
  await tx.execute('UPDATE construction_scope_revision SET revision=revision+1 WHERE singleton=1')
  return saved
}

export async function readProductionConstructionScope(tx: TransactionDb, actor: BusinessSession, source: ConstructionScopeSource): Promise<ConstructionScopeRead> {
  await assertProductionConstructionScope(tx, actor)
  if (!actor.capabilities.includes('construction-scope:read'))
    return financeFailure('forbidden', '无施工合同关联读取权限。')
  const fact = await sourceFact(tx, actor, source)
  const relation = await readLink(tx, source)
  let existingMain: EntityRefDTO | undefined
  if (relation?.mainId) {
    if (!actor.capabilities.includes('construction-contract:read')) {
      existingMain = { entity: 'contract', state: 'forbidden', id: null, label: null, reason: 'permission-denied' }
    }
    else {
      try {
        const main = await readProductionConstructionContractReference(tx, actor, relation.mainId, { includeDeleted: true })
        existingMain = { entity: 'contract', state: 'resolved', id: main.id, label: main.name, no: main.no }
      }
      catch (cause) {
        if (!cause || typeof cause !== 'object' || !('problem' in cause) || !cause.problem || typeof cause.problem !== 'object' || !('code' in cause.problem) || !['not-found', 'unavailable'].includes(String(cause.problem.code)))
          throw cause
        existingMain = { entity: 'contract', state: 'unavailable', id: null, label: null, reason: 'source-unavailable' }
      }
    }
  }
  const candidates = []
  const candidateState = !actor.capabilities.includes('project:list:read') || !actor.capabilities.includes('construction-contract:read') ? 'forbidden' : fact.eligible ? 'readable' : 'unavailable'
  if (fact.eligible && fact.projectId && candidateState === 'readable') {
    const mains = await readProductionConstructionContractFacts(tx, actor, { projectId: fact.projectId })
    for (const row of mains.contracts) {
      const current = await mainFact(tx, actor, row.id)
      if (current.eligible && current.projectId === fact.projectId)
        candidates.push({ id: row.id, name: current.name, no: current.no, projectId: fact.projectId, basis: current.basis })
    }
  }
  return { workspaceId: actor.workspaceId, actorId: actor.actorId, source, sourceName: fact.name, parentId: fact.parentId, projectId: fact.projectId, sourceBasis: fact.basis, eligible: fact.eligible, reason: candidateState === 'forbidden' ? '当前身份无施工主合同或项目候选读取权限；已有原关联仍保留。' : fact.reason, relation, ...(existingMain ? { existingMain } : {}), candidates, candidateState, capabilities: actor.capabilities, dataOrigin: 'real' }
}

/** Backup/cold read validates relationship evidence only; it never fabricates or repairs source facts. */
export async function validateProductionConstructionScopeState(tx: TransactionDb) {
  const metadata = (await tx.select<Row>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!metadata)
    return financeFailure('unavailable', '正式施工关联身份元数据缺失。')
  const rows = await tx.select<Row>('SELECT * FROM construction_scope_links ORDER BY id')
  const history = await tx.select<Row>('SELECT * FROM construction_scope_history ORDER BY link_id,version')
  const intents = await tx.select<Row>('SELECT * FROM construction_scope_intents ORDER BY command_id')
  const receipts = await tx.select<Row>('SELECT * FROM construction_scope_receipts ORDER BY command_id')
  const seals = await tx.select<Row>('SELECT * FROM construction_scope_resolutions ORDER BY command_id')
  const revision = (await tx.select<Row>('SELECT revision FROM construction_scope_revision WHERE singleton=1'))[0]
  if (!revision || revision.revision !== history.length)
    return financeFailure('unavailable', '施工合同关联历史与持久版本不一致。')
  const requests = new Map<string, ConstructionScopeCommand>()
  for (const intent of intents) {
    const input = command(JSON.parse(String(intent.request_json)))
    if (input.commandId !== intent.command_id || input.workspaceId !== metadata.workspace_id || input.actorId !== metadata.owner_id || intent.workspace_id !== input.workspaceId || intent.actor_id !== input.actorId || intent.link_id !== constructionScopeLinkId(input.source) || intent.action !== input.action || intent.fingerprint !== constructionScopeDigest(input))
      return financeFailure('unavailable', '施工合同关联原意图身份或完整依据损坏。')
    requests.set(input.commandId, input)
  }
  for (const row of rows) {
    const current = link(row)
    const versions = history.filter(entry => entry.link_id === current.id)
    if (versions.length !== Number(current.version) || versions.some((entry, index) => entry.version !== index + 1))
      return financeFailure('unavailable', '施工合同关联版本链不连续或历史缺失。')
    const last = versions.at(-1)!
    if (!isDeepStrictEqual(current, link({ ...last, id: last.link_id, updated_at: last.occurred_at })))
      return financeFailure('unavailable', '施工合同关联当前记录与最后原历史不一致。')
  }
  for (const entry of history) {
    const original = link({ ...entry, id: entry.link_id, updated_at: entry.occurred_at })
    const input = requests.get(String(entry.command_id))
    const receipt = receipts.find(row => row.command_id === entry.command_id)
    if (!input || !receipt || input.source.id !== original.sourceId || input.source.domain !== original.domain || input.projectId !== original.projectId || input.mainId !== original.mainId || input.sourceBasis !== original.sourceBasis || input.mainBasis !== original.mainBasis || input.baseVersion !== (Number(original.version) === 1 ? null : String(Number(original.version) - 1)) || entry.actor_id !== input.actorId
      || receipt.link_id !== original.id || receipt.workspace_id !== input.workspaceId || receipt.actor_id !== input.actorId || receipt.fingerprint !== constructionScopeDigest(input) || !isDeepStrictEqual(JSON.parse(String(receipt.result_json)), { commandId: input.commandId, relation: original })) {
      return financeFailure('unavailable', '施工合同关联原意图、历史与可靠回执不一致。')
    }
    const source = original.domain === 'original-expense'
      ? (await tx.select('SELECT id FROM expense_reimbursement_lines WHERE id=? AND original_expense_line_id IS NULL', [original.sourceId]))[0]
      : (await tx.select(`SELECT id FROM ${original.domain === 'material-contract' ? 'material_contract_records' : original.domain === 'subcontract-contract' ? 'subcontract_contract_records' : 'auxiliary_contract_records'} WHERE id=?${original.domain === 'material-contract' ? ' AND parent_id IS NULL' : original.domain === 'auxiliary-contract' ? ' AND json_extract(record_json,\'$.draft.kind\')=\'other_expense\'' : ''}`, [original.sourceId]))[0]
    if (!source)
      return financeFailure('unavailable', '施工合同关联所消费的原稳定来源已经缺失。')
    if (input.originalSourceCommand) {
      const parent = input.originalSourceCommand
      const table = parent.family === 'finance-reimbursement' ? 'finance_commands' : parent.family === 'material-contract' ? 'material_contract_commands' : parent.family === 'subcontract-contract' ? 'subcontract_contract_intents' : 'auxiliary_contract_intents'
      const row = (await tx.select<Row>(`SELECT * FROM ${table} WHERE command_id=? AND workspace_id=? AND actor_id=?`, [parent.commandId, input.workspaceId, input.actorId]))[0]
      const parentReceipt = ['subcontract-contract', 'auxiliary-contract'].includes(parent.family)
        ? (await tx.select<Row>(`SELECT * FROM ${parent.family === 'subcontract-contract' ? 'subcontract_contract_receipts' : 'auxiliary_contract_receipts'} WHERE command_id=? AND workspace_id=? AND actor_id=?`, [parent.commandId, input.workspaceId, input.actorId]))[0]
        : row
      if (!row || !parentReceipt || typeof row.request_json !== 'string' || typeof parentReceipt.result_json !== 'string')
        return financeFailure('unavailable', '施工归属缺少同一次原来源提交的可靠回执。')
      const request = JSON.parse(row.request_json)
      const result = JSON.parse(parentReceipt.result_json)
      if (request.commandId !== parent.commandId || request.workspaceId !== input.workspaceId || request.actorId !== input.actorId || result.commandId !== parent.commandId)
        return financeFailure('unavailable', '施工归属与原来源提交的身份或原编号不一致。')
      if (parent.family === 'finance-reimbursement') {
        if (row.kind !== 'reimbursement' || request.kind !== 'reimbursement' || request.draft?.projectId !== input.projectId || !Array.isArray(result.constructionScopeLinks)
          || !result.constructionScopeLinks.some((saved: unknown) => isDeepStrictEqual(saved, { commandId: input.commandId, relation: original }))) {
          return financeFailure('unavailable', '原费用复合回执未证明这条原施工归属。')
        }
        const parentHistory = (await tx.select<Row>('SELECT snapshot_json FROM finance_history WHERE kind=\'reimbursement\' AND id=? AND command_id=?', [result.id, parent.commandId]))[0]
        const frozen = parentHistory ? JSON.parse(String(parentHistory.snapshot_json)) : null
        if (frozen?.head?.project_id !== input.projectId || !Array.isArray(frozen?.relations?.expense_reimbursement_lines)
          || !frozen.relations.expense_reimbursement_lines.some((line: Row) => line.id === input.source.id && line.reimbursement_id === result.id && line.original_expense_line_id === null)) {
          return financeFailure('unavailable', '原费用冻结记录与施工归属消费的明细身份不一致。')
        }
      }
      else {
        const main = request.constructionMain
        const sourceId = request.draft?.isSupplement === true ? request.draft.originalContractId : result.id
        if (sourceId !== input.source.id || main?.id !== input.mainId || main?.projectId !== input.projectId || main?.basis !== input.mainBasis)
          return financeFailure('unavailable', '原合同提交未证明同一原合同、协议父链及原工程选择。')
      }
    }
  }
  if (receipts.length !== history.length || history.some(entry => !rows.some(row => row.id === entry.link_id)))
    return financeFailure('unavailable', '施工合同关联存在孤立历史或可靠回执。')
  for (const seal of seals) {
    const input = requests.get(String(seal.command_id))
    if (seal.workspace_id !== metadata.workspace_id || seal.actor_id !== metadata.owner_id || !['bind', 'unbind'].includes(String(seal.action)) || receipts.some(row => row.command_id === seal.command_id)
      || (input && (seal.link_id !== constructionScopeLinkId(input.source) || seal.action !== input.action))) {
      return financeFailure('unavailable', '施工合同关联原封存范围或应用结果矛盾。')
    }
  }
}

export { sourceCapability as constructionScopeSourceCapability, command as decodeConstructionScopeCommand, applyScopeCommand as persistProductionConstructionScopeCommand, readLink as readProductionConstructionScopeLink, mainFact as readProductionConstructionScopeMainFact, sourceFact as readProductionConstructionScopeSourceFact }
