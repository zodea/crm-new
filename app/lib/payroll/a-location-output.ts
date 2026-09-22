import type { PayrollAFrozenDocument, PayrollAQuantityFact } from './central-a-contract'
import { hasPayrollAFeesDocument } from './central-a-fees-contract'

export interface PayrollAFrozenLocationGroup {
  key: string
  buildingId: string
  buildingName: string
  itemId: string
  itemName: string
  unit: string | null
  floors: string
  records: Array<PayrollAQuantityFact & { lineId: string }>
}

function compare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

/** 只有完整的明确层号标签可压缩；夹层、房号、数字片段等一律保留原文。 */
function explicitFloor(value: string): { ordinal: number, suffix: string } | null {
  const match = /^(-?[1-9]\d{0,3}|0)([楼层F])$/.exec(value)
  return match ? { ordinal: Number(match[1]), suffix: match[2]! } : null
}

function floorRange(records: readonly PayrollAQuantityFact[]): string {
  const names = new Map<string, Set<string>>()
  for (const fact of records) {
    const entry = names.get(fact.floorId) ?? new Set<string>()
    entry.add(fact.floorName?.trim() || '未记录楼层')
    names.set(fact.floorId, entry)
  }
  const values = [...names.entries()].sort(([left], [right]) => compare(left, right)).map(([, labels]) => [...labels].join(' / '))
  const parsed = values.map(explicitFloor)
  if (parsed.includes(null) || new Set(parsed.map(value => value!.suffix)).size !== 1 || new Set(parsed.map(value => value!.ordinal)).size !== parsed.length)
    return values.join('、')
  const ordinals = parsed.map(value => value!.ordinal).sort((left, right) => left - right)
  const ranges: string[] = []
  for (let index = 0; index < ordinals.length; index++) {
    const start = ordinals[index]!
    let end = start
    while (index + 1 < ordinals.length && ordinals[index + 1] === end + 1)
      end = ordinals[++index]!
    ranges.push(start === end ? String(start) : `${start}–${end}`)
  }
  return `${ranges.join('、')}${parsed[0]?.suffix ?? ''}`
}

function names(values: Array<string | null>, unknown: string): string {
  return [...new Set(values.map(value => value?.trim() || unknown))].join(' / ')
}

/** 只投影已有冻结位置。原工资行、计量和金额不拆分、不重算。 */
export function payrollALocationOutput(document: PayrollAFrozenDocument): {
  groups: PayrollAFrozenLocationGroup[]
  lineNotes: Record<string, string>
  diagnostics: string[]
} {
  const grouped = new Map<string, PayrollAFrozenLocationGroup>()
  const lineNotes: Record<string, string> = {}
  const diagnostics = new Set<string>()
  const lines = hasPayrollAFeesDocument(document) && document.book.bookPurpose === 'management'
    ? document.fees.lines.map(line => ({ id: `fee:${line.feeId}`, facts: line.components.map(component => component.fact) }))
    : document.lines
  for (const line of lines) {
    if (!line.facts.length) {
      lineNotes[line.id] = '原冻结位置缺失'
      diagnostics.add('部分工资行缺少原冻结位置，保留原金额，不能用当前工程量补成旧范围。')
    }
    for (const fact of line.facts) {
      const key = JSON.stringify([fact.buildingId, fact.itemId, fact.unit])
      const group = grouped.get(key) ?? { key, buildingId: fact.buildingId, buildingName: '', itemId: fact.itemId, itemName: '', unit: fact.unit, floors: '', records: [] }
      group.records.push({ ...fact, lineId: line.id })
      grouped.set(key, group)
      if (!fact.buildingName || !fact.floorName || !fact.unitName || !fact.roomName || !fact.itemName || !fact.unit)
        diagnostics.add('部分原位置、分项或计量单位未记录，保留缺口，不按名称合并或补值。')
      if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(fact.completedAt))
        diagnostics.add('部分原完成日期未记录或无法核实。')
    }
  }
  const groups = [...grouped.values()].sort((left, right) => compare(left.key, right.key))
  for (const group of groups) {
    group.buildingName = names(group.records.map(fact => fact.buildingName), '未记录楼栋')
    group.itemName = names(group.records.map(fact => fact.itemName), '未记录分项')
    group.floors = floorRange(group.records)
    group.records.sort((left, right) => {
      const leftFloor = explicitFloor(left.floorName ?? '')
      const rightFloor = explicitFloor(right.floorName ?? '')
      const order = leftFloor && rightFloor ? leftFloor.ordinal - rightFloor.ordinal : 0
      return order || compare(JSON.stringify([left.floorId, left.unitId, left.roomId, left.ownershipKey, left.lineId]), JSON.stringify([right.floorId, right.unitId, right.roomId, right.ownershipKey, right.lineId]))
    })
  }
  for (const line of lines) {
    const descriptions = groups.filter(group => group.records.some(fact => fact.lineId === line.id)).map((group) => {
      const facts = group.records.filter(fact => fact.lineId === line.id)
      return `${names(facts.map(fact => fact.buildingName), '未记录楼栋')} / ${names(facts.map(fact => fact.itemName), '未记录分项')} / ${floorRange(facts)}`
    })
    if (descriptions.length)
      lineNotes[line.id] = descriptions.join('；')
  }
  if (groups.length)
    diagnostics.add('范围仅列原完成责任；原件未记录部分铺贴或整层收尾结论，不能据此认定整层全部完成。')
  return { groups, lineNotes, diagnostics: [...diagnostics] }
}

function safeLabel(value: string, limit: number): string {
  const printable = Array.from(value, character => character.charCodeAt(0) < 32 ? '-' : character).join('')
  let result = ''
  for (const character of printable.replace(/[<>:"/\\|?*]+/g, '-').trim()) {
    if (result.length + character.length > limit)
      break
    result += character
  }
  return result.replace(/[.\s]+$/g, '') || '未记录'
}

/** FNV-1a 128仅作文件名消歧；不用于权限、原件摘要或内容完整性证明。 */
function fileIdentity(value: string): string {
  let hash = BigInt('0x6c62272e07bb014262b821756295c58d')
  const prime = BigInt('0x1000000000000000000013b')
  for (const byte of new TextEncoder().encode(value))
    hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * prime)
  return hash.toString(16).padStart(32, '0')
}

export function payrollAFrozenFileName(document: PayrollAFrozenDocument): string {
  const locations = payrollALocationOutput(document)
  const buildings = names(locations.groups.map(group => group.buildingName), '位置未记录') || '位置未记录'
  const items = names(locations.groups.map(group => group.itemName), '分项未记录') || '分项未记录'
  const period = { monthly: '月度', settlement: '结算', retention: '尾款' }[document.periodKind]
  const labels = [safeLabel(document.projectName, 26), safeLabel(buildings, 16), safeLabel(items, 16), safeLabel(document.month, 10), period, safeLabel(document.leaderName, 18)]
  const title = hasPayrollAFeesDocument(document) && document.book.bookPurpose === 'management' ? '管理费进度款' : '工资'
  return `${title}-${labels.join('-')}-${fileIdentity(document.id)}.xlsx`
}
