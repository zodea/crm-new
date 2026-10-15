import type { SupplierCommandResultDTO } from './command-contract'
import type { SupplierCredentialCommandResult } from './credential-contract'
import type { SupplierHttpFetcher } from './http-repository'
import type { SupplierTaxpayerResult } from './taxpayer-verification'
import { isISODateTimeDTO } from '../../types/read-model'
import { credentialProblem } from './credential-contract'
import { readSupplierHttp } from './http-repository'
import { TAXPAYER_TYPES, TAXPAYER_VERIFICATION_LABELS } from './taxpayer-verification'

export type SupplierPersistentResult = SupplierCommandResultDTO | SupplierCredentialCommandResult | SupplierTaxpayerResult
export type SupplierCommandResolution = { commandId: string, outcome: 'not-applied', result: null } | { commandId: string, outcome: 'applied', result: SupplierPersistentResult }
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw credentialProblem('unavailable', '原分供方提交的身份或回执无效，请保留原编号重新核对。')
}
export function createSupplierProductionRepository(fetcher: SupplierHttpFetcher) {
  return {
    resolve: (commandId: string) => readSupplierHttp(() => fetcher('/api/commands/supplier-resolve', { method: 'POST', body: { commandId } }), (value): SupplierCommandResolution => {
      if (!object(value) || value.commandId !== commandId)
        return invalid()
      if (value.outcome === 'not-applied' && value.result === null)
        return { commandId, outcome: 'not-applied', result: null }
      if (value.outcome !== 'applied' || !object(value.result) || value.result.commandId !== commandId)
        return invalid()
      const result = value.result
      if ('id' in result) {
        if (typeof result.id !== 'string' || !result.id || typeof result.version !== 'string' || !result.version
          || !isISODateTimeDTO(result.updatedAt) || !Array.isArray(result.attachmentIds) || result.attachmentIds.length) {
          return invalid()
        }
      }
      else {
        if (!['supplierId', 'supplierVersion', 'credentialVersion'].every(key => typeof result[key] === 'string' && result[key])
          || !['credentialId', 'auditId', 'deletionToken'].every(key => result[key] === null || typeof result[key] === 'string')) {
          return invalid()
        }
        if ('verification' in result) {
          const proof = result.verification
          if (!object(proof) || !TAXPAYER_TYPES.includes(proof.taxpayerType as never) || !Object.hasOwn(TAXPAYER_VERIFICATION_LABELS, String(proof.taxpayerVerificationStatus))
            || typeof proof.taxpayerVerificationSource !== 'string' || typeof proof.taxpayerVerificationNote !== 'string' || !isISODateTimeDTO(proof.taxpayerVerifiedAt)) {
            return invalid()
          }
        }
      }
      return { commandId, outcome: 'applied', result: structuredClone(result) as unknown as SupplierPersistentResult }
    }),
  }
}
export type SupplierProductionRepository = ReturnType<typeof createSupplierProductionRepository>
