import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import { decodeOurSignatorySnapshot } from '../../app/lib/our-signatory/contract'

/** Adopt the original contract's exact proven snapshot; legacy party text is never directory identity. */
export function contractMigratedSignatory(entity: CoreMigrationServerEntityDTO, fail: (message: string) => never) {
  const fields = entity.attributes
  const legacyPartyA = typeof fields.legacyPartyA === 'string' ? fields.legacyPartyA : null
  const id = typeof fields.ourSignatoryId === 'string' && fields.ourSignatoryId ? fields.ourSignatoryId : null
  const raw = fields.ourSignatorySnapshotJson
  let value: unknown = null
  try {
    value = raw === undefined || raw === null || raw === '' ? null : JSON.parse(String(raw))
  }
  catch {
    return fail('迁入合同采用的签约主体快照损坏，不能推断或覆盖原资料')
  }
  if (value === null) {
    if (id !== null)
      return fail('迁入合同签约主体编号缺少当时采用快照，不能自动补当前目录')
    return { legacyPartyA, ourSignatoryId: null, ourSignatoryVersion: null, ourSignatorySnapshot: null }
  }
  try {
    const snapshot = decodeOurSignatorySnapshot(value)
    if (snapshot.id !== id)
      return fail('迁入合同签约主体编号与当时采用快照不一致')
    return { legacyPartyA, ourSignatoryId: snapshot.id, ourSignatoryVersion: snapshot.version, ourSignatorySnapshot: snapshot }
  }
  catch {
    return fail('迁入合同签约主体快照或身份损坏，不能改变历史采用事实')
  }
}
