import type { ProblemDTO, ReadMetaDTO } from '../../types/read-model'

export interface OurSignatoryDraft {
  name: string
  taxNo: string | null
  registeredAddress: string | null
  legalRepresentative: string | null
  verificationNote: string
  status: 'active' | 'inactive'
}
export interface OurSignatorySnapshot {
  id: string
  version: string
  name: string
  taxNo: string | null
  registeredAddress: string | null
  legalRepresentative: string | null
  verificationNote: string
}
export interface OurSignatoryRecord {
  id: string
  draft: OurSignatoryDraft
  version: string
  createdAt: string
  updatedAt: string
  history: OurSignatoryHistory[]
}
export interface OurSignatoryHistory {
  id: string
  version: string
  draft: OurSignatoryDraft
  actorId: string | null
  commandId: string | null
  occurredAt: string
}
export interface OurSignatoryListDTO {
  records: OurSignatoryRecord[]
  meta: ReadMetaDTO
  asOf: string
  sourceVersion: string | null
  capabilities: string[]
}
export interface OurSignatoryCommandRequest {
  workspaceId: string
  actorId: string
  requiredCapability: 'our-signatory:write'
  commandId: string
  id?: string
  baseVersion: string | null
  draft: OurSignatoryDraft
}
export interface OurSignatoryCommandResult {
  commandId: string
  id: string
  version: string
  updatedAt: string
}
export type OurSignatoryResolution = {
  outcome: 'applied'
  result: OurSignatoryCommandResult
} | {
  outcome: 'not-applied'
  commandId: string
}
export class OurSignatoryRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO) {
    super(problem.message)
    this.name = 'OurSignatoryRepositoryProblem'
  }
}
export function signatoryProblem(code: ProblemDTO['code'], message: string, field?: string): never {
  throw new OurSignatoryRepositoryProblem({ code, message, retryable: code === 'unavailable', fieldErrors: field ? { [field]: [message] } : {}, traceId: null })
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = ['name', 'taxNo', 'registeredAddress', 'legalRepresentative', 'verificationNote', 'status']
export function decodeOurSignatoryDraft(value: unknown, options: {
  allowBlankName?: boolean
} = {}): OurSignatoryDraft {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)))
    return signatoryProblem('validation-failed', '我方主体资料结构无效')
  if (typeof value.name !== 'string' || (!options.allowBlankName && !value.name.trim()))
    return signatoryProblem('validation-failed', '请填写真实签约名称', 'name')
  if (typeof value.verificationNote !== 'string' || !['active', 'inactive'].includes(String(value.status))
    || ['taxNo', 'registeredAddress', 'legalRepresentative'].some(key => !(value[key] === null || typeof value[key] === 'string'))) {
    return signatoryProblem('validation-failed', '我方主体核实资料无效')
  }
  return { ...value, name: value.name.trim() } as unknown as OurSignatoryDraft
}
export function decodeOurSignatorySnapshot(value: unknown): OurSignatorySnapshot {
  if (!object(value) || Object.keys(value).length !== 7 || typeof value.id !== 'string' || !value.id.trim() || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version))
    return signatoryProblem('validation-failed', '合同采用的我方主体快照无效')
  const { id, version, ...details } = value
  const draft = decodeOurSignatoryDraft({ ...details, status: 'active' })
  return { id, version, name: draft.name, taxNo: draft.taxNo, registeredAddress: draft.registeredAddress, legalRepresentative: draft.legalRepresentative, verificationNote: draft.verificationNote }
}
export function signatorySnapshot(record: OurSignatoryRecord): OurSignatorySnapshot {
  const { status: _status, ...facts } = record.draft
  return { id: record.id, version: record.version, ...facts }
}
