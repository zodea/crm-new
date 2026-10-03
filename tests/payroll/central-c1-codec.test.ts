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

it.each(Array.from([{ workDate: '2026-02-30' }, { hours: -1 }, { hours: 24, overtimeHours: 1 }, { hours: NaN }, { hours: Infinity }, { recordId: 'forged' }]).map(input => ({ input })))('考勤与 C1 命令封闭动作/字段，正常小数不提前舍入，非数与非法日期不能入请求：输入组合 1 案例 %#', ({ input: change }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  expect(() => parsePayrollAttendanceCommand(encodePayrollAttendanceWire({ ...attendance, action: { ...attendance.action, record: { ...attendance.action.record, ...change } } }))).toThrow()
})

it.each(Array.from([{ kind: 'check-c1', payRatio: 0.8 }, { kind: 'release-c1', facts: [] }, { kind: 'delete-c1' }, { kind: 'check-a' }]).map(input => ({ input })))('考勤与 C1 命令封闭动作/字段，正常小数不提前舍入，非数与非法日期不能入请求：输入组合 2 案例 %#', ({ input: action }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  const config = { ...envelope, statementId: null, draftKey: null, configScope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 60.125 }] } }
  expect(parsePayrollC1Command(encodePayrollC1Wire(config))).toEqual(config)
  expect(() => parsePayrollC1Command(encodePayrollC1Wire({ ...config, statementId: 'wage', configScope: null, action }))).toThrow()
})
