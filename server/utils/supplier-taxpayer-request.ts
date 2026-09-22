import type { SupplierTaxpayerCommand, TaxpayerVerificationDraft } from '../../app/lib/supplier/taxpayer-verification'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { verifiedTaxpayerFields } from '../../app/lib/supplier/taxpayer-verification'

export function parseSupplierTaxpayerCommand(input: unknown, supplierId: string): SupplierTaxpayerCommand {
  const invalid = () => {
    throw credentialProblem('validation-failed', '人工税务核验请求格式或主体无效')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid()
  const value = input as Record<string, unknown>
  const keys = ['supplierId', 'origin', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseSupplierVersion', 'expectedTaxNo', 'draft']
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.filter(key => key !== 'draft').some(key => typeof value[key] !== 'string' || !(value[key] as string).trim() || (value[key] as string).length > 1000)
    || value.supplierId !== supplierId || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'supplier:write'
    || !value.draft || typeof value.draft !== 'object' || Array.isArray(value.draft)) {
    return invalid()
  }
  const draft = value.draft as Record<string, unknown>
  if (Object.keys(draft).some(key => !['status', 'taxpayerType', 'note'].includes(key)) || ['status', 'taxpayerType', 'note'].some(key => typeof draft[key] !== 'string'))
    return invalid()
  verifiedTaxpayerFields(draft as unknown as TaxpayerVerificationDraft, '2000-01-01T00:00:00.000Z')
  return structuredClone(value) as unknown as SupplierTaxpayerCommand
}
