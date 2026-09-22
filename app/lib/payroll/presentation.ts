import type { WageStatement } from './statements'

export function wageSourceLabel(statement: Pick<WageStatement, 'formatFamily' | 'quantitySource'>): string {
  if (statement.formatFamily === 'B')
    return '历史合同清单'
  if (statement.formatFamily === 'C1')
    return '真实考勤'
  if (statement.formatFamily === 'C2')
    return '已确认签工'
  return statement.quantitySource === 'field' ? '现场复核量' : '暂估量'
}

export function wageQuantityLabel(formatFamily: WageStatement['formatFamily']): string {
  return formatFamily === 'C1' ? '考勤数量' : formatFamily === 'C2' ? '签工工数' : '工程量'
}

export function wageCheckLabel(formatFamily: WageStatement['formatFamily']): string {
  return formatFamily === 'C1' ? '考勤' : formatFamily === 'C2' ? '签工' : '现场量'
}
