/** Stable contract identity used by payment applications, independent of display labels. */
export const PAYMENT_CONTRACT_DOMAINS = ['construction', 'subcontract', 'material', 'auxiliary', 'company'] as const
export type PaymentContractDomain = typeof PAYMENT_CONTRACT_DOMAINS[number]

export interface PaymentContractReference {
  domain: PaymentContractDomain
  id: string
  version: string
}

/** Reject partial or ambiguous identities at the boundary; do not infer a domain from an ID. */
export function parsePaymentContractReference(value: unknown): PaymentContractReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).sort().join(',') !== 'domain,id,version'
    || !PAYMENT_CONTRACT_DOMAINS.includes(candidate.domain as PaymentContractDomain)
    || typeof candidate.id !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(candidate.id)
    || typeof candidate.version !== 'string' || !/^[1-9]\d*$/.test(candidate.version)) {
    return null
  }
  return { domain: candidate.domain as PaymentContractDomain, id: candidate.id, version: candidate.version }
}

/** Selection keys are presentation-only; the persisted reference remains structured. */
export function paymentContractSelectionKey(reference: PaymentContractReference): string {
  return `${reference.domain}_${reference.id}`
}
