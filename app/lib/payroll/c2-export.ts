import type { ExportFileOptions } from '../kit/export'
import type { PayrollC2FrozenDocument } from './central-c2-contract'
import * as XLSX from 'xlsx'

export function createPayrollC2Workbook(document: PayrollC2FrozenDocument): ExportFileOptions {
  const book = XLSX.utils.book_new()
  const salary: (string | number | null)[][] = [[`${document.projectName} C2 工资表`], ['月份', document.month, '负责人', document.leaderName, '班组', document.crewName], ['按本月已确认签工核算，月度 100%'], ['姓名', '项目', '工', '元/工', '核算金额', '签字并按手印'], ...document.lines.map(line => [line.workerName, line.itemName, line.quantity, line.unitPrice, line.amount, '']), [], ['核算应发', document.grossAmount, '实际发放', document.actualAmount], [], ['收款姓名', '角色', '实际收款', '签收'], ...document.allocations.map(row => [row.workerName, row.isLeader ? '负责人' : '成员', row.amount, '']), [], ['班组长：', '施工员：', '安全员：', '现场负责人：'], ['经办人', document.operatorName, '发放时间', document.releasedAt], ['备注', document.note]]
  const daywork: (string | number | null)[][] = [[`${document.projectName} ${document.month} 零星签工表`], ['负责人', document.leaderName, '每工标准', document.config.unitRate], ['计算规则', document.config.ruleText], ['姓名', '日期', '开始', '结束', '工', '施工内容', '证明人', '确认日期', '备注'], ...document.daywork.map(fact => [document.members.find(member => member.workerId === fact.workerId)?.workerName ?? null, fact.workDate, fact.startTime, fact.endTime, fact.laborUnits, fact.workContent, fact.witness, fact.confirmedOn, fact.note]), [], ['班组长：', '施工员：', '安全员：', '现场负责人：']]
  for (const [name, rows] of [['工资表', salary], ['签工表', daywork]] as const) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = name === '工资表' ? [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 24 }] : [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(book, sheet, name)
  }
  const data: ArrayBuffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
  return { data, defaultName: `${document.projectName}-${document.leaderName}-${document.month}-C2工资与签工.xlsx`.replace(/[<>:"/\\|?*]/g, '-'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
