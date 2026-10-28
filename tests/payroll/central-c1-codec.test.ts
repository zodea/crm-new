import { expect, it } from 'vitest'
import { encodePayrollAttendanceWire, parsePayrollAttendanceCommand } from '~/lib/payroll/central-attendance-codec'
import { encodePayrollC1Wire, parsePayrollC1Command } from '~/lib/payroll/central-c1-codec'

const envelope = { commandId: 'cmd', workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'read', requiredCapability: 'payroll:write', projectId: 'p' }
it('考勤与 C1 命令封闭动作/字段，正常小数不提前舍入，非数与非法日期不能入请求', () => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  const config = { ...envelope, statementId: null, draftKey: null, configScope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 60.125 }] } }
  expect(parsePayrollC1Command(encodePayrollC1Wire(config))).toEqual(config)
})

it.each([
  { label: '非真实日期', change: { workDate: '2026-02-30' }, reason: '考勤日期、工时或固定范围无效' },
  { label: '负工时', change: { hours: -1 }, reason: '考勤日期、工时或固定范围无效' },
  { label: '工时加加班超过 24 小时', change: { hours: 24, overtimeHours: 1 }, reason: '考勤日期、工时或固定范围无效' },
  { label: '工时非数', change: { hours: NaN }, reason: '金额须精确到分，工时与费率须为有限数值或明确空值' },
  { label: '工时无穷大', change: { hours: Infinity }, reason: '金额须精确到分，工时与费率须为有限数值或明确空值' },
  { label: '伪造记录身份', change: { recordId: 'forged' }, reason: '请求包含不支持的字段' },
])('考勤命令拒绝$label', ({ change, reason }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  expect(() => parsePayrollAttendanceCommand(encodePayrollAttendanceWire({ ...attendance, action: { ...attendance.action, record: { ...attendance.action.record, ...change } } }))).toThrow(reason)
})

it.each([
  { label: '核对动作夹带比例', action: { kind: 'check-c1', payRatio: 0.8 }, reason: '请求包含不支持的字段' },
  { label: '发放动作夹带事实', action: { kind: 'release-c1', facts: [] }, reason: '请求包含不支持的字段' },
  { label: '未开放的删除动作', action: { kind: 'delete-c1' }, reason: 'C1 动作无效' },
  { label: '串用 A 表动作', action: { kind: 'check-a' }, reason: 'C1 动作无效' },
])('c1 命令拒绝$label', ({ action, reason }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  const config = { ...envelope, statementId: null, draftKey: null, configScope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 60.125 }] } }
  expect(parsePayrollC1Command(encodePayrollC1Wire(config))).toEqual(config)
  expect(() => parsePayrollC1Command(encodePayrollC1Wire({ ...config, statementId: 'wage', configScope: null, action }))).toThrow(reason)
})
