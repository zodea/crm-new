import type { QuotationLine, QuotationRead } from './contract'

export interface QuotationPriceFact {
  key: string
  quotationId: string
  lineId: string
  version: string
  partyName: string
  supplierId: string | null
  scope: string
  projectId: string | null
  quotationDate: string | null
  savedAt: string
  line: QuotationLine
  fileIds: string[]
}
/** Every price point belongs to an actual frozen quote revision and original line. Unknown party names are never supplier IDs. */
export function quotationPriceFacts(read: QuotationRead): QuotationPriceFact[] {
  return read.records.flatMap(record => record.history.flatMap((history) => {
    const relation = record.relations?.find(row => row.version === history.version)
    return history.draft.lines.map(line => ({ key: `${record.id}:${history.version}:${line.id}`, quotationId: record.id, lineId: line.id, version: history.version, partyName: history.draft.partyName, supplierId: relation?.supplierId ?? history.draft.supplierId, scope: history.draft.scope, projectId: relation?.projectId ?? history.draft.projectId, quotationDate: history.draft.quotationDate, savedAt: history.occurredAt, line: { ...line }, fileIds: history.files.filter(file => file.deletedAt === null).map(file => file.id) }))
  }))
}
