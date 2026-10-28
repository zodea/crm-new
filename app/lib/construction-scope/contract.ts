import type { EntityRefDTO } from '../../types/read-model'
import type { CommandRecoveryDescriptor, CommandResolution } from '../forms/command-recovery'

export const CONSTRUCTION_SCOPE_DOMAINS = ['material-contract', 'original-expense', 'subcontract-contract', 'auxiliary-contract'] as const
export type ConstructionScopeDomain = typeof CONSTRUCTION_SCOPE_DOMAINS[number]
export interface ConstructionScopeSource { domain: ConstructionScopeDomain, id: string }
export interface ConstructionScopeActor { workspaceId: string, actorId: string }
export interface ConstructionMainSelection { id: string, projectId: string, basis: string }
export interface ConstructionMainOption extends ConstructionMainSelection { name: string, no: string, projectName: string }
export function decodeConstructionMainSelection(value: unknown): ConstructionMainSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('工程名称必须选择真实施工主合同')
  const row = value as Record<string, unknown>
  const id = (value: unknown) => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
  if (Object.keys(row).sort().join(',') !== 'basis,id,projectId' || !id(row.id) || !id(row.projectId) || typeof row.basis !== 'string' || !/^[a-f0-9]{64}$/.test(row.basis))
    throw new Error('工程名称的稳定身份、项目或采用依据无效')
  return { id: String(row.id), projectId: String(row.projectId), basis: row.basis }
}
export interface ConstructionScopeLink {
  domain: ConstructionScopeDomain
  sourceId: string
  id: string
  projectId: string
  mainId: string | null
  version: string
  sourceBasis: string
  mainBasis: string | null
  updatedAt: string
  deletedAt: string | null
}
export interface ConstructionScopeMain { id: string, name: string, no: string, projectId: string, basis: string }
export interface ConstructionScopeRead extends ConstructionScopeActor {
  source: ConstructionScopeSource
  sourceName: string
  parentId: string
  projectId: string | null
  sourceBasis: string | null
  eligible: boolean
  reason: string | null
  relation: ConstructionScopeLink | null
  existingMain?: EntityRefDTO
  candidates: ConstructionScopeMain[]
  candidateState: 'readable' | 'forbidden' | 'unavailable'
  capabilities: readonly string[]
  dataOrigin: 'real'
}
export interface ConstructionScopeCommand extends ConstructionScopeActor {
  commandId: string
  requiredCapability: 'construction-scope:write'
  source: ConstructionScopeSource
  projectId: string
  action: 'bind' | 'unbind'
  mainId: string | null
  baseVersion: string | null
  sourceBasis: string
  mainBasis: string | null
  originalSourceCommand?: { family: 'material-contract' | 'finance-reimbursement' | 'subcontract-contract' | 'auxiliary-contract', commandId: string }
}
export interface ConstructionScopeResult { commandId: string, relation: ConstructionScopeLink }
export interface ConstructionScopeRepository {
  read: (source: ConstructionScopeSource) => Promise<ConstructionScopeRead>
  execute: (command: ConstructionScopeCommand) => Promise<ConstructionScopeResult>
  resolve: (descriptor: CommandRecoveryDescriptor) => Promise<CommandResolution<ConstructionScopeResult>>
}
export interface ConstructionScopeSpendingRow {
  identity: string
  sourceId: string
  name: string
  metric: 'committed' | 'incurred' | 'paid'
  projectId: string
  mainId: string | null
  mainLabel?: string | null
  amount: number | null
  reason: string | null
}
export interface ConstructionScopeSpendingRead extends ConstructionScopeActor {
  dataOrigin: 'real'
  projectId: string
  mainId: string | null
  rows: ConstructionScopeSpendingRow[]
  unassigned: ConstructionScopeSpendingRow[]
  metrics: Record<ConstructionScopeSpendingRow['metric'], { knownAmount: number, amount: number | null, complete: boolean }>
  sources: Array<{ key: string, state: 'readable' | 'forbidden' | 'unavailable', reason: string | null }>
  projectPayroll: { scope: 'project', knownPaidAmount: number | null, complete: boolean }
}
export const constructionScopeSourceKey = (source: ConstructionScopeSource) => `${source.domain}:${source.id}`

export function decodeConstructionScopeSource(value: unknown): ConstructionScopeSource {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'domain,id')
    throw new Error('施工合同关联来源无效')
  const row = value as Record<string, unknown>
  if (!CONSTRUCTION_SCOPE_DOMAINS.includes(row.domain as ConstructionScopeDomain) || typeof row.id !== 'string' || !row.id || row.id.length > 250 || /[\s/\\?#]/.test(row.id) || [...row.id].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error('施工合同关联来源类型或稳定编号无效')
  return { domain: row.domain as ConstructionScopeDomain, id: row.id }
}
