import type { QuantityReadQuery, QuantityReadResult } from './central-contract'
import type { QuantityPhotoContent, QuantityPhotoIdentity } from './central-photo'
import { invalidQuantityResponse, quantityReadEnvelope } from './central-decoder'
import { validateQuantityPhoto } from './central-photo'

export async function decodeQuantityPhoto(value: unknown, query: QuantityReadQuery & QuantityPhotoIdentity): Promise<QuantityReadResult<QuantityPhotoContent>> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (data.unitId !== query.unitId || data.completionId !== query.completionId || data.photoId !== query.photoId
    || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) {
    invalidQuantityResponse()
  }
  const bytes = validateQuantityPhoto(data as unknown as QuantityPhotoContent, 'internal-error')
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (sha256 !== data.sha256)
    invalidQuantityResponse()
  return value as unknown as QuantityReadResult<QuantityPhotoContent>
}
