import type { CentralInvoiceRecord } from './central-contract'

/** 展示及导出使用相同的来源证据；缺证据时不能推断旧票类型。 */
export function centralInvoiceSourceLabel(record: Pick<CentralInvoiceRecord, 'sourceKind' | 'legacy'>): string {
  if (record.sourceKind === 'scan')
    return '扫描'
  if (record.sourceKind === 'excel')
    return 'Excel 导入'
  if (record.sourceKind === 'manual')
    return '手工录入'
  if (record.legacy?.source === 'scan')
    return '旧扫描'
  if (record.legacy?.source === 'excel')
    return '旧 Excel 导入'
  return '来源待核实'
}
