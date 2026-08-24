import type { ContractFormAttachment, ContractFormAttachmentChanges, ProjectContractFormDraft } from '../contract/forms'
import { decodeContractAttachment, decodeContractAttachmentChanges, decodeProjectContractDraft } from '../contract/command-validation'

export class SubcontractContractCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubcontractContractCommandValidationError'
  }
}

const options = {
  entityLabel: '分包合同',
  lineItemLabel: '分包合同明细',
  allowLineItems: false,
  allowSupplier: true,
  fail(message: string): never { throw new SubcontractContractCommandValidationError(message) },
}

export function decodeSubcontractContractDraft(value: unknown): ProjectContractFormDraft {
  return decodeProjectContractDraft(value, options)
}

export function decodeSubcontractContractAttachmentChanges(value: unknown): ContractFormAttachmentChanges {
  return decodeContractAttachmentChanges(value, options)
}

export function decodeSubcontractContractAttachment(value: unknown, ownerId: string): ContractFormAttachment {
  return decodeContractAttachment(value, ownerId, options)
}
