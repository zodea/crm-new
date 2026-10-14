import { Buffer } from 'node:buffer'
import { defineEventHandler, getQuery, setHeader } from 'h3'
import { boqFail } from '../../../utils/production-boq-record'
import { boqClosed, boqStableId } from '../../../utils/production-boq-request'
import { productionBoqRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const query = boqClosed(getQuery(event), ['projectId', 'contractId', 'origin', 'ownerKind', 'ownerId', 'fileId'])
    if (query.origin !== 'real' || !['projectId', 'contractId', 'ownerId', 'fileId'].every(key => boqStableId(query[key])) || !['boq-file', 'owner-change'].includes(String(query.ownerKind)))
      return boqFail('validation-failed', '原件读取须指定明确真实项目、主合同、原记录和附件')
    const runtime = productionBoqRuntime(event)
    if (!runtime)
      return boqFail('unavailable', '正式施工清单原件 owner 尚未接通')
    const original = await runtime.file({ projectId: String(query.projectId), contractId: String(query.contractId), origin: 'real', ownerKind: query.ownerKind as 'boq-file' | 'owner-change', ownerId: String(query.ownerId), fileId: String(query.fileId) })
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    const { bytes, ...identity } = original
    return { ...identity, fileSize: bytes.length, payloadBase64: Buffer.from(bytes).toString('base64') }
  }
  catch (cause) { throwQuantityError(cause) }
})
