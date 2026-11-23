import type { H3Event } from 'h3'
import { Buffer } from 'node:buffer'
import { getRequestWebStream } from 'h3'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { INVOICE_WORKBOOK_MAX_BYTES } from '../../app/lib/invoice/workbook-limits'

const MAX_BODY_BYTES = Math.ceil(INVOICE_WORKBOOK_MAX_BYTES / 3) * 4 + 2 * 1024 * 1024

/** 包含 Base64 及来源快照的 JSON 封套，按实际流量计数，不能仅依赖 Content-Length。 */
export async function readInvoiceWorkbookRequest(event: H3Event): Promise<unknown> {
  const header = event.headers.get('content-length')
  if (header && (!/^\d+$/.test(header) || Number(header) > MAX_BODY_BYTES))
    throw new CentralInvoiceProblem('validation-failed', '工作簿请求过大，请拆分后重试。')
  const stream = getRequestWebStream(event)
  if (!stream)
    throw new CentralInvoiceProblem('validation-failed', '缺少工作簿请求。')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done)
        break
      total += part.value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new CentralInvoiceProblem('validation-failed', '工作簿请求过大，请拆分后重试。')
      }
      chunks.push(part.value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  }
  catch (cause) {
    if (cause instanceof CentralInvoiceProblem)
      throw cause
    throw new CentralInvoiceProblem('validation-failed', '工作簿请求格式无效。')
  }
  finally { reader.releaseLock() }
}
