import type { ExportFileOptions } from '../kit/export'
import type { PayrollC1FrozenDocument } from './central-c1-contract'
import * as XLSX from 'xlsx'
import { c1MonthDays, c1Number } from './c1-presentation'

export function c1FrozenAttendanceRows(document: PayrollC1FrozenDocument) {
  return document.members.map(member => ({ ...member, days: c1MonthDays(document.month).map((date) => {
    const record = document.attendance.find(fact => fact.workerId === member.workerId && fact.workDate === date)
    return { date, record, label: record ? `${c1Number(record.hours)} / ${c1Number(record.overtimeHours)}` : '' }
  }) }))
}
export function createPayrollC1Workbook(document: PayrollC1FrozenDocument): ExportFileOptions {
  const book = XLSX.utils.book_new()
  const salary: (string | number | null)[][] = [[`${document.projectName} C1 工资表`], ['月份', document.month, '负责人', document.leaderName, '班组', document.crewName], ['按本月考勤核算，月度 100%'], ['姓名', '项目', '小时', '元/小时', '核算金额', '签字并按手印'], ...document.lines.map(line => [line.workerName, line.itemName, line.quantity, line.unitPrice, line.amount, '']), [], ['核算应发', document.grossAmount, '实际发放', document.actualAmount], [], ['收款姓名', '角色', '实际收款', '签收'], ...document.allocations.map(row => [row.workerName, row.isLeader ? '负责人' : '成员', row.amount, '']), [], ['班组长：', '施工员：', '安全员：', '现场负责人：'], ['经办人', document.operatorName, '发放时间', document.releasedAt], ['备注', document.note]]
  const attendance: (string | number | null)[][] = [[`${document.projectName} ${document.month} 月度考勤表`], ['单元格：正常工时 / 加班工时；空格未登记，0 为真实零工时'], ['姓名', ...c1MonthDays(document.month).map(date => Number(date.slice(-2)))], ...c1FrozenAttendanceRows(document).map(member => [member.workerName, ...member.days.map(day => day.label)]), [], ['逐日施工记录'], ['姓名', '日期', '正常工时', '加班工时', '施工内容', '备注'], ...document.attendance.map(fact => [document.members.find(member => member.workerId === fact.workerId)?.workerName ?? null, fact.workDate, fact.hours, fact.overtimeHours, fact.workContent, fact.note]), [], ['班组长：', '施工员：', '安全员：', '现场负责人：']]
  for (const [name, rows] of [['工资表', salary], ['考勤表', attendance]] as const) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = name === '工资表' ? [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 24 }] : [{ wch: 20 }, ...c1MonthDays(document.month).map(() => ({ wch: 12 }))]
    XLSX.utils.book_append_sheet(book, sheet, name)
  }
  const data: ArrayBuffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
  return { data, defaultName: `${document.projectName}-${document.leaderName}-${document.month}-C1工资与考勤.xlsx`.replace(/[<>:"/\\|?*]/g, '-'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
