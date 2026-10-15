import type { ContractFormAttachmentDraft } from '../../app/lib/contract/forms'
import { materialContractProblem, MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { contractOriginalBytes, contractOriginalDigest } from './contract-original'

export const materialOriginalDigest = contractOriginalDigest

export function materialOriginalBytes(file: ContractFormAttachmentDraft, required = false): Uint8Array | null {
  return contractOriginalBytes(file, { required, fail(message): never {
    throw new MaterialContractRepositoryProblem(materialContractProblem('validation-failed', message))
  } })
}
