import type { ProblemDTO } from '../../types/read-model'
import type { QuantityBatchReadQuery, QuantityCommand, QuantityCommandResult, QuantityReadQuery, QuantityUnitReadQuery } from './central-contract'
import type { QuantityHollowCommand, QuantityHollowCommandResult } from './central-hollow-contract'
import type { QuantityPhotoIdentity } from './central-photo'
import { isProblemCodeDTO } from '../../types/read-model'
import { decodeQuantityBoq, decodeQuantityVariance } from './central-boq-decoder'
import { decodeQuantityCommand } from './central-command-decoder'
import { quantityProblem, QuantityRepositoryProblem } from './central-contract'
import { decodeQuantityRegion, decodeQuantityStages, decodeQuantityTemplates, quantityObject, quantityStrings } from './central-decoder'
import { decodeQuantityHollow } from './central-hollow-codec'
import { decodeQuantityPhoto } from './central-photo-decoder'
import { decodeQuantityAssignments, decodeQuantityBatchPlan, decodeQuantityCompletion, decodeQuantityWorkspace } from './central-workspace-decoder'

export type QuantityFetcher = (url: string, options?: {
  method?: 'POST'
  query?: Record<string, unknown>
  body?: QuantityCommand
  signal?: AbortSignal
}) => Promise<unknown>

export function quantityProblemFromUnknown(cause: unknown): QuantityRepositoryProblem {
  if (cause instanceof QuantityRepositoryProblem)
    return cause
  if (quantityObject(cause)) {
    const response = quantityObject(cause.response) ? cause.response : null
    const raw = response?._data ?? cause.data
    const value = quantityObject(raw) && quantityObject(raw.data) ? raw.data : raw
    if (quantityObject(value) && isProblemCodeDTO(value.code) && typeof value.message === 'string'
      && typeof value.retryable === 'boolean' && quantityObject(value.fieldErrors)
      && Object.values(value.fieldErrors).every(quantityStrings)
      && (value.traceId === null || typeof value.traceId === 'string')) {
      return new QuantityRepositoryProblem(value as unknown as ProblemDTO)
    }
  }
  return quantityProblem('unavailable', '工程量中央服务暂时不可用，请重试')
}

export function createQuantityRepository(fetcher: QuantityFetcher) {
  async function request<T>(url: string, options: Parameters<QuantityFetcher>[1], decode: (value: unknown) => T | Promise<T>): Promise<T> {
    try {
      options?.signal?.throwIfAborted()
      const response = await fetcher(url, options)
      options?.signal?.throwIfAborted()
      const value = await decode(response)
      options?.signal?.throwIfAborted()
      return value
    }
    catch (cause) {
      options?.signal?.throwIfAborted()
      if (cause instanceof Error && cause.name === 'AbortError')
        throw cause
      throw quantityProblemFromUnknown(cause)
    }
  }
  function execute(command: QuantityHollowCommand): Promise<QuantityHollowCommandResult>
  function execute(command: QuantityCommand): Promise<QuantityCommandResult>
  function execute(command: QuantityCommand): Promise<QuantityCommandResult> {
    const body = structuredClone(command)
    return request('/api/commands/quantity', { method: 'POST', body }, value => decodeQuantityCommand(value, body))
  }
  return {
    hollow: (query: QuantityUnitReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/hollow', { query: scope, signal: options.signal }, value => decodeQuantityHollow(value, scope))
    },
    variance: (query: QuantityReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/variance', { query: scope, signal: options.signal }, value => decodeQuantityVariance(value, scope))
    },
    boq: (query: QuantityReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/boq', { query: scope, signal: options.signal }, value => decodeQuantityBoq(value, scope))
    },
    workspace: (query: QuantityReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/workspace', { query: scope, signal: options.signal }, value => decodeQuantityWorkspace(value, scope))
    },
    assignments: (query: QuantityReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/assignments', { query: scope, signal: options.signal }, value => decodeQuantityAssignments(value, scope))
    },
    completion: (query: QuantityUnitReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/completion', { query: scope, signal: options.signal }, value => decodeQuantityCompletion(value, scope))
    },
    batchPlan: (query: QuantityBatchReadQuery, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...structuredClone(query) }
      return request('/api/read/quantity/batch-plan', { query: scope, signal: options.signal }, value => decodeQuantityBatchPlan(value, scope))
    },
    photo: (query: QuantityReadQuery & QuantityPhotoIdentity, options: { signal?: AbortSignal } = {}) => {
      const scope = { ...query }
      return request('/api/read/quantity/photo', { query: scope, signal: options.signal }, value => decodeQuantityPhoto(value, scope))
    },
    stages: (query: QuantityReadQuery) => {
      const scope = { ...query }
      return request('/api/read/quantity/stages', { query: scope }, value => decodeQuantityStages(value, scope))
    },
    region: (query: QuantityReadQuery) => {
      const scope = { ...query }
      return request('/api/read/quantity/region', { query: scope }, value => decodeQuantityRegion(value, scope))
    },
    templates: (query: QuantityReadQuery) => {
      const scope = { ...query }
      return request('/api/read/quantity/templates', { query: scope }, value => decodeQuantityTemplates(value, scope))
    },
    execute,
  }
}

export type QuantityRepository = ReturnType<typeof createQuantityRepository>
