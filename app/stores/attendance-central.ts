import type { PayrollAttendanceCommand, PayrollAttendanceMatrixRead, PayrollAttendanceRecordDraft, PayrollAttendanceScope } from '~/lib/payroll/central-attendance-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { decodePayrollAttendanceResult, encodePayrollAttendanceWire, parsePayrollAttendanceCommand } from '~/lib/payroll/central-attendance-codec'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

export const useAttendanceCentralStore = defineStore('attendance-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const key = (workspaceId: string, actorId: string, origin: string, projectId: string, workerId: string, workDate: string) => payrollCanonical([workspaceId, actorId, origin, 'attendance', projectId, workerId, workDate])
  const keyFor = (c: PayrollAttendanceCommand) => key(c.workspaceId, c.actorId, c.origin, c.projectId, c.action.record.workerId, c.action.record.workDate)
  const pending = usePayrollPending('payroll-attendance-central-pending-v1', keyFor, (c: PayrollAttendanceCommand) => {
    parsePayrollAttendanceCommand(encodePayrollAttendanceWire(c))
  }, c => repository().executeAttendance(c), decodePayrollAttendanceResult)
  function saveRecord(read: PayrollAttendanceMatrixRead, record: PayrollAttendanceRecordDraft) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前考勤资料只能阅读')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    return pending.submit({ commandId: generateId('attendance-command'), workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', projectId: read.scope.projectId, scope: read.scope, action: { kind: 'upsert-attendance', record } })
  }
  function acknowledgeAttendance(original: { command: PayrollAttendanceCommand }, refreshed: PayrollAttendanceMatrixRead) {
    const command = original.command
    pending.acknowledge(original, [refreshed], result => refreshed.context.workspaceId === command.workspaceId && refreshed.context.actorId === command.actorId && refreshed.context.origin === command.origin && !refreshed.context.readonly && refreshed.context.capabilities.includes('payroll:write') && payrollCanonical(refreshed.scope) === payrollCanonical(command.scope) && refreshed.records.some(record => record.id === result.recordId && record.projectId === command.projectId && record.workerId === result.workerId && record.workDate === result.workDate))
  }
  return {
    loadMatrix: (query: PayrollQuery, scope: PayrollAttendanceScope) => pending.read(() => repository().attendanceMatrix(query, scope)),
    saveRecord,
    getAttendancePending: (read: PayrollAttendanceMatrixRead, workerId: string, workDate: string) => pending.get(key(read.context.workspaceId, read.context.actorId, read.context.origin, read.scope.projectId, workerId, workDate)),
    recoverAttendance: pending.recover,
    acknowledgeAttendance,
  }
})
