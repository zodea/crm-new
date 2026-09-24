import type { ContractFormAttachment, ContractFormAttachmentChanges, ProjectContractFormDraft } from '../contract/forms'
import { decodeContractAttachment, decodeContractAttachmentChanges, decodeProjectContractDraft } from '../contract/command-validation'

export class MaterialContractCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialContractCommandValidationError'
  }
}

const options = {
  entityLabel: '材料采购合同',
  lineItemLabel: '采购明细',
  allowLineItems: true,
  allowSupplier: true,
  fail(message: string): never { throw new MaterialContractCommandValidationError(message) },
}

export function decodeMaterialContractDraft(value: unknown): ProjectContractFormDraft {
  return decodeProjectContractDraft(value, options)
}

export function decodeMaterialContractAttachmentChanges(value: unknown): ContractFormAttachmentChanges {
  return decodeContractAttachmentChanges(value, options)
}

export function decodeMaterialContractAttachment(value: unknown, ownerId: string): ContractFormAttachment {
  return decodeContractAttachment(value, ownerId, options)
}
