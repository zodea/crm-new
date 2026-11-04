import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { prepareLegacyInvoicePlan } from './production-invoice-migration-plan'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'

/** 预检和发布共用原件字节、类型及中央编号占用校验；只读，不改原库。 */
export async function verifyLegacyInvoiceOriginal(tx: TransactionDb, files: ReturnType<typeof prepareLegacyInvoicePlan>['entries'][number]['sourceFiles']) {
  const bodies = files.filter(file => file.bodyState === 'embedded')
  if (bodies.length > 1)
    throw new CentralInvoiceProblem('validation-failed', '旧发票迁入：单张旧发票存在多份正文，须先支持逐份保全及读取；完整原库保持不变。')
  const file = bodies[0]
  if (!file)
    return null
  const raw = file.row
  const encoded = file.payload?.content
  const name = raw.file_name
  if (typeof encoded !== 'string' || typeof name !== 'string' || !name.trim() || typeof raw.id !== 'string')
    throw new CentralInvoiceProblem('validation-failed', '旧发票迁入：旧原件缺少完整名称、正文或身份；完整原库保持不变。')
  const bytes = Buffer.from(encoded, 'base64')
  const lower = name.toLowerCase()
  const pdf = lower.endsWith('.pdf') && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
  const png = lower.endsWith('.png') && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpg = /\.jpe?g$/.test(lower) && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== encoded || (!pdf && !png && !jpg))
    throw new CentralInvoiceProblem('validation-failed', '旧发票迁入：旧原件格式、大小或正文无法核实；完整原库保持不变。')
  if ((await tx.select('SELECT id FROM file_refs WHERE id=?', [raw.id])).length)
    throw new CentralInvoiceProblem('conflict', '旧原件编号已被其他事实占用，整批不能覆盖。')
  return { id: raw.id, name, bytes, mime: pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex') }
}
