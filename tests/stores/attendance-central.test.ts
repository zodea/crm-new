// @vitest-environment jsdom
import type { PayrollAttendanceCommand, PayrollAttendanceMatrixRead } from '~/lib/payroll/central-attendance-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAttendanceCentralStore } from '~/stores/attendance-central'
import { c1AttendanceFact } from '../helpers/payroll-c1-ui'

const repo = { attendanceMatrix: vi.fn(), executeAttendance: vi.fn() }
const read = (projectId = 'p'): PayrollAttendanceMatrixRead => ({ context: { workspaceId: 'work', actorId: 'actor', origin: 'real', sourceVersion: 'original', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }, scope: { projectId, month: '2026-08', crewId: null }, options: { projects: [], crews: [] }, workers: [], records: [], locks: [], diagnostics: [], evidence: [] })
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  repo.executeAttendance.mockImplementation(async (c: PayrollAttendanceCommand) => ({ commandId: c.commandId, projectId: c.projectId, recordId: 'attendance', workerId: c.action.record.workerId, workDate: c.action.record.workDate, outcome: 'saved', sourceVersion: 'next', logIds: [] }))
  repo.attendanceMatrix.mockImplementation(async (_q, scope) => ({ ...read(scope.projectId), scope, records: [c1AttendanceFact({ id: 'attendance', crewId: 'crew' })] }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('同一个原单元格按项目/人/日保稿恢复，切班组不丢原键，另一日或项目不串写', async () => {
  const store = useAttendanceCentralStore()
  const record = { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '原内容', note: '' }
  repo.executeAttendance.mockRejectedValueOnce(new Error('断线'))
  await expect(store.saveRecord(read(), record)).rejects.toThrow('断线')
  record.hours = 8
  const original = store.getAttendancePending(read(), 'w', record.workDate)!
  expect(original.command.action.record.hours).toBe(7.51)
  expect(store.getAttendancePending(read('other'), 'w', record.workDate)).toBeNull()
  expect(store.getAttendancePending(read(), 'w', '2026-08-02')).toBeNull()
  expect(store.getAttendancePending({ ...read(), scope: { ...read().scope, crewId: 'crew' } }, 'w', record.workDate)?.command).toEqual(original.command)
  setActivePinia(createPinia())
  const restored = useAttendanceCentralStore()
  await restored.recoverAttendance(restored.getAttendancePending(read(), 'w', record.workDate)!)
  expect(repo.executeAttendance.mock.calls.at(-1)![0]).toEqual(original.command)
  expect(restored.getAttendancePending(read(), 'w', record.workDate)?.state).toBe('awaiting-read')
  const refreshed = await restored.loadMatrix({ origin: 'real' }, read().scope)
  restored.acknowledgeAttendance(original, refreshed)
  expect(restored.getAttendancePending(read(), 'w', record.workDate)).toBeNull()
})
it('考勤原操作只在原范围冷读并核对回执物理记录后解除，其他班组/日期/无记录均不解除', async () => {
  const store = useAttendanceCentralStore()
  const matrix = read()
  const record = { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '原施工内容', note: '' }
  const old = await store.loadMatrix({ origin: 'real' }, matrix.scope)
  await store.saveRecord(matrix, record)
  const pending = store.getAttendancePending(matrix, 'w', record.workDate)!
  expect(() => store.acknowledgeAttendance(pending, old)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  const otherCrew = await store.loadMatrix({ origin: 'real' }, { ...matrix.scope, crewId: 'crew' })
  expect(() => store.acknowledgeAttendance(pending, otherCrew)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repo.attendanceMatrix.mockResolvedValueOnce({ ...matrix, records: [c1AttendanceFact({ id: 'attendance', workDate: '2026-08-02' })] })
  const otherDay = await store.loadMatrix({ origin: 'real' }, matrix.scope)
  expect(() => store.acknowledgeAttendance(pending, otherDay)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repo.attendanceMatrix.mockResolvedValueOnce(matrix)
  const missing = await store.loadMatrix({ origin: 'real' }, matrix.scope)
  expect(() => store.acknowledgeAttendance(pending, missing)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  const refreshed = await store.loadMatrix({ origin: 'real' }, matrix.scope)
  expect(store.getAttendancePending(matrix, 'w', record.workDate)?.command).toEqual(pending.command)
  store.acknowledgeAttendance(pending, refreshed)
  expect(store.getAttendancePending(matrix, 'w', record.workDate)).toBeNull()
})
