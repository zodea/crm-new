import type { CommandRecoveryDescriptor } from '../forms/command-recovery'
import type { ConstructionScopeCommand, ConstructionScopeLink, ConstructionScopeRead, ConstructionScopeRepository, ConstructionScopeResult, ConstructionScopeSource, ConstructionScopeSpendingRead } from './contract'
import { isEntityRefDTO } from '../../types/read-model'
import { decodeConstructionScopeSource } from './contract'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function invalid(): never {
  throw new Error('施工合同关联响应缺少可信身份或版本，请保留原编号并重新读取。')
}

export function decodeConstructionScopeSpending(value: unknown): ConstructionScopeSpendingRead {
  const finite = (input: unknown) => typeof input === 'number' && Number.isFinite(input)
  const money = (input: unknown) => input === null || finite(input)
  if (!object(value) || value.dataOrigin !== 'real' || !['workspaceId', 'actorId', 'projectId'].every(key => typeof value[key] === 'string' && value[key]) || !(value.mainId === null || typeof value.mainId === 'string') || !Array.isArray(value.rows) || !Array.isArray(value.unassigned) || !Array.isArray(value.sources) || !object(value.metrics) || !object(value.projectPayroll))
    return invalid()
  for (const metric of ['committed', 'incurred', 'paid']) {
    const row = value.metrics[metric]
    if (!object(row) || !finite(row.knownAmount) || !money(row.amount) || typeof row.complete !== 'boolean' || (row.complete ? row.amount !== row.knownAmount : row.amount !== null))
      return invalid()
  }
  for (const [kind, rows] of [['rows', value.rows], ['unassigned', value.unassigned]] as const) {
    const seen = new Set<string>()
    for (const row of rows) {
      if (!object(row) || !['identity', 'sourceId', 'name', 'projectId'].every(key => typeof row[key] === 'string') || typeof row.identity !== 'string' || !row.identity || seen.has(row.identity) || row.projectId !== value.projectId || !['committed', 'incurred', 'paid'].includes(String(row.metric)) || !money(row.amount) || !(row.mainId === null || typeof row.mainId === 'string') || !(row.reason === null || typeof row.reason === 'string') || (kind === 'unassigned' ? row.mainId !== null : value.mainId !== null && row.mainId !== value.mainId))
        return invalid()
      seen.add(row.identity)
    }
  }
  if (value.sources.some(row => !object(row) || typeof row.key !== 'string' || !['readable', 'forbidden', 'unavailable'].includes(String(row.state)) || !(row.reason === null || typeof row.reason === 'string')) || value.projectPayroll.scope !== 'project' || !money(value.projectPayroll.knownPaidAmount) || typeof value.projectPayroll.complete !== 'boolean')
    return invalid()
  return value as unknown as ConstructionScopeSpendingRead
}
function relation(value: unknown): ConstructionScopeLink {
  if (!object(value) || !['id', 'sourceId', 'domain', 'projectId', 'version', 'sourceBasis', 'updatedAt'].every(key => typeof value[key] === 'string') || !/^[1-9]\d*$/.test(String(value.version)) || !digest(value.sourceBasis)
    || !(value.mainId === null ? value.mainBasis === null && typeof value.deletedAt === 'string' : typeof value.mainId === 'string' && digest(value.mainBasis) && value.deletedAt === null)) {
    return invalid()
  }
  decodeConstructionScopeSource({ domain: value.domain, id: value.sourceId })
  return value as unknown as ConstructionScopeLink
}
function result(value: unknown, commandId: string, source?: ConstructionScopeSource): ConstructionScopeResult {
  if (!object(value) || value.commandId !== commandId)
    return invalid()
  const row = relation(value.relation)
  if (source && (row.domain !== source.domain || row.sourceId !== source.id))
    return invalid()
  return { commandId, relation: row }
}
export function createConstructionScopeRepository(request: (url: string, options?: { method?: 'POST', body?: unknown, query?: Record<string, string> }) => Promise<unknown>): ConstructionScopeRepository {
  return {
    async read(source) {
      const value = await request('/api/read/construction-scope', { query: { domain: source.domain, id: source.id } })
      if (!object(value) || value.dataOrigin !== 'real' || !['workspaceId', 'actorId', 'parentId', 'sourceName'].every(key => typeof value[key] === 'string' && value[key]) || !object(value.source) || value.source.domain !== source.domain || value.source.id !== source.id
        || !(value.projectId === null || typeof value.projectId === 'string') || !(value.sourceBasis === null || digest(value.sourceBasis)) || typeof value.eligible !== 'boolean' || !(value.reason === null || typeof value.reason === 'string') || !['readable', 'forbidden', 'unavailable'].includes(String(value.candidateState)) || !Array.isArray(value.candidates) || !Array.isArray(value.capabilities) || value.capabilities.some(cap => typeof cap !== 'string')) {
        return invalid()
      }
      if (value.relation !== null) {
        const row = relation(value.relation)
        if (row.domain !== source.domain || row.sourceId !== source.id)
          return invalid()
      }
      if (value.existingMain !== undefined) {
        if (!object(value.relation) || typeof value.relation.mainId !== 'string' || !isEntityRefDTO(value.existingMain, 'contract') || value.existingMain.state === 'missing'
          || (value.existingMain.state === 'resolved' && (value.existingMain.id !== value.relation.mainId || !value.capabilities.includes('construction-contract:read')))) {
          return invalid()
        }
      }
      for (const row of value.candidates) {
        if (!object(row) || !['id', 'name', 'no', 'projectId'].every(key => typeof row[key] === 'string') || !digest(row.basis) || row.projectId !== value.projectId)
          return invalid()
      }
      return value as unknown as ConstructionScopeRead
    },
    async execute(command: ConstructionScopeCommand) { return result(await request('/api/commands/construction-scope', { method: 'POST', body: command }), command.commandId, command.source) },
    async resolve(descriptor: CommandRecoveryDescriptor) {
      const value = await request('/api/commands/construction-scope/resolve', { method: 'POST', body: descriptor })
      if (!object(value))
        return invalid()
      if (value.outcome === 'not-applied' && value.commandId === descriptor.commandId)
        return { outcome: 'not-applied', commandId: descriptor.commandId }
      if (value.outcome === 'applied')
        return { outcome: 'applied', result: result(value.result, descriptor.commandId) }
      return invalid()
    },
  }
}
