import type { DeliveryFileContent, DeliverySourceUpload } from '../../app/lib/delivery-record/contract'
import { createHash } from 'node:crypto'
import { deliveryProblem } from '../../app/lib/delivery-record/contract'
import { decodeDeliveryOriginal } from '../../app/lib/delivery-record/source-validation'

export function validateDeliverySource(source: DeliverySourceUpload): { sha256: string, bytes: Uint8Array } {
  let bytes: Uint8Array
  try {
    bytes = decodeDeliveryOriginal(source)
  }
  catch {
    throw deliveryProblem('validation-failed', '送货原件类型、正文或长度校验失败')
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes }
}

export function readDeliveryAsset(asset: DeliveryFileContent): DeliveryFileContent {
  if (validateDeliverySource(asset).sha256 !== asset.sha256)
    throw deliveryProblem('conflict', '送货原件摘要不符，请重新对账')
  return structuredClone(asset)
}
