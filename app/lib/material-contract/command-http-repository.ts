import type {
  MaterialContractCommandContextDTO,
  MaterialContractCommandRepository,
  MaterialContractCommandResolutionDTO,
  MaterialContractCommandResultDTO,
  MaterialContractFormReadDTO,
} from './command-contract'
import type { MaterialContractHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeConstructionMainSelection } from '../construction-scope/contract'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'
import { decodeOurSignatoryRecord } from '../our-signatory/http-repository'
import {
  decodeMaterialContractAttachment,
  decodeMaterialContractDraft,
  MaterialContractCommandValidationError,
} from './command-validation'
import { readMaterialContractHttp } from './http-repository'
import { materialContractProblem, MaterialContractRepositoryProblem } from './repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function options(value: unknown): boolean {
  return Array.isArray(value) && value.every(row => object(row)
    && typeof row.id === 'string' && typeof row.label === 'string')
}

function invalid(message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem('internal-error', message))
}

function context(value: unknown): MaterialContractCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')
    || !options(value.projects) || !options(value.suppliers)
    || !(value.suppliers as Record<string, unknown>[]).every(row =>
      (row.contactName === undefined || typeof row.contactName === 'string')
      && (row.contactPhone === undefined || typeof row.contactPhone === 'string'))) {
    return invalid('中央后台返回的材料采购合同业务会话无效')
  }
  if (value.originalContracts !== undefined) {
    if (!options(value.originalContracts) || !(value.originalContracts as Record<string, unknown>[]).every(row =>
      typeof row.no === 'string' && (row.projectId === null || typeof row.projectId === 'string')
      && (row.supplierId === null || typeof row.supplierId === 'string') && Array.isArray(row.lineItems))) {
      return invalid('中央后台返回的原材采合同选择无效')
    }
    for (const row of value.originalContracts as Record<string, unknown>[]) {
      decodeMaterialContractDraft({ lineItems: row.lineItems })
      if (row.ourSignatorySnapshot != null)
        decodeOurSignatorySnapshot(row.ourSignatorySnapshot)
      if (row.constructionMain != null)
        decodeConstructionMainSelection(row.constructionMain)
    }
  }
  if (value.ourSignatories !== undefined) {
    if (!Array.isArray(value.ourSignatories))
      return invalid('主体目录结构无效')
    value.ourSignatories.forEach(decodeOurSignatoryRecord)
  }
  if (value.constructionMains !== undefined) {
    if (!Array.isArray(value.constructionMains) || !value.constructionMains.every(row => object(row) && typeof row.name === 'string' && typeof row.no === 'string' && typeof row.projectName === 'string'))
      return invalid('工程施工主合同候选无效')
    for (const row of value.constructionMains) {
      try {
        decodeConstructionMainSelection({ id: row.id, projectId: row.projectId, basis: row.basis })
      }
      catch {
        return invalid('工程施工主合同身份或来源依据无效')
      }
    }
  }
  return value as unknown as MaterialContractCommandContextDTO
}

function result(value: unknown): MaterialContractCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(item => typeof item === 'string')
    || ['lineIds', 'deductionIds'].some(key => value[key] !== undefined && (!Array.isArray(value[key]) || !(value[key] as unknown[]).every(id => typeof id === 'string' && Boolean(id)) || new Set(value[key] as string[]).size !== (value[key] as unknown[]).length))
    || (value.warnings !== undefined && (!Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string')))) {
    return invalid('中央后台返回的材料采购合同命令结果无效')
  }
  return value as unknown as MaterialContractCommandResultDTO
}

function form(value: unknown, id: string): MaterialContractFormReadDTO {
  if (!object(value) || !Array.isArray(value.attachments) || typeof value.version !== 'string'
    || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的材料采购合同表单无效')
  }
  try {
    const draft = decodeMaterialContractDraft(value.draft)
    if (draft.id !== id)
      return invalid('中央后台返回的材料采购合同表单 ID 无效')
    return {
      draft: { ...draft, id },
      attachments: value.attachments.map(row => decodeMaterialContractAttachment(row, id)),
      version: value.version,
      updatedAt: value.updatedAt,
      ...(value.constructionMain === undefined ? {} : { constructionMain: value.constructionMain === null ? null : decodeConstructionMainSelection(value.constructionMain) }),
    }
  }
  catch (cause) {
    if (cause instanceof MaterialContractCommandValidationError)
      return invalid(`中央后台返回的材料采购合同表单无效：${cause.message}`)
    throw cause
  }
}

function resolution(value: unknown, commandId: string): MaterialContractCommandResolutionDTO {
  if (!object(value))
    return invalid('中央后台返回的原提交核对无效')
  if (value.outcome === 'not-applied' && value.commandId === commandId)
    return { outcome: 'not-applied', commandId }
  if (value.outcome === 'applied') {
    const applied = result(value.result)
    if (applied.commandId === commandId)
      return { outcome: 'applied', result: applied }
  }
  return invalid('中央后台返回的原提交身份不一致')
}

export function createHttpMaterialContractCommandRepository(
  options: { fetcher: MaterialContractHttpFetcher },
): MaterialContractCommandRepository {
  return {
    context: () => readMaterialContractHttp(
      () => options.fetcher('/api/read/material-contracts/form-context'),
      context,
    ),
    loadForm: id => readMaterialContractHttp(
      () => options.fetcher(`/api/read/material-contracts/${encodeURIComponent(id)}/form`),
      value => form(value, id),
    ),
    execute: request => readMaterialContractHttp(
      () => options.fetcher(request.id
        ? `/api/commands/material-contracts/${encodeURIComponent(request.id)}`
        : '/api/commands/material-contracts', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      result,
    ),
    resolve: commandId => readMaterialContractHttp(
      () => options.fetcher('/api/commands/material-contracts/resolve', { method: 'POST', body: { commandId } }),
      value => resolution(value, commandId),
    ),
  }
}
