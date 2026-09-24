import type { ContractFormAttachment, ContractFormAttachmentChanges, ProjectContractFormDraft } from '../contract/forms'
import { decodeContractAttachment, decodeContractAttachmentChanges, decodeProjectContractDraft } from '../contract/command-validation'

export class ConstructionContractCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConstructionContractCommandValidationError'
  }
}

const options = {
  entityLabel: '施工合同',
  lineItemLabel: '施工合同明细',
  allowLineItems: false,
  allowSupplier: false,
  fail(message: string): never { throw new ConstructionContractCommandValidationError(message) },
}

export function decodeConstructionContractDraft(value: unknown): ProjectContractFormDraft {
  return decodeProjectContractDraft(value, options)
}

export function decodeConstructionContractAttachmentChanges(value: unknown): ContractFormAttachmentChanges {
  return decodeContractAttachmentChanges(value, options)
}

export function decodeConstructionContractAttachment(value: unknown, ownerId: string): ContractFormAttachment {
  return decodeContractAttachment(value, ownerId, options)
}
