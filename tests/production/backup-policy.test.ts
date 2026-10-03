import { describe, expect, it } from 'vitest'
import { backupProtection, backupShouldRun, retainedBackupIds } from '../../server/utils/production-backup-policy'

describe('备份保护与调度使用实际数据时点', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')
  it.each([
    { case: '{ configured: true, capturedAt: \'2026-09-21T11:59:59Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-21T11:59:59Z', lastFailure: null }, argument2: now, expected: 'expired' },
    { case: '{ configured: true, capturedAt: \'2026-09-21T12:00:01Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-21T12:00:01Z', lastFailure: null }, argument2: now, expected: 'protected' },
    { case: '{ configured: true, capturedAt: \'2026-09-23T12:00:00Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-23T12:00:00Z', lastFailure: null }, argument2: now, expected: 'clock-invalid' },
    { case: '{ configured: true, capturedAt: \'2026-09-22T11:00:00Z\', lastFailure: \'介质不可用\' } / now', input: { configured: true, capturedAt: '2026-09-22T11:00:00Z', lastFailure: '介质不可用' }, argument2: now, expected: 'failed' },
  ])('复制旧包不会刷新保护时点，超过24小时和未来时间不能显示已保护 / backupProtection：$case', ({ input, argument2, expected }) => {
    expect(backupProtection(input, argument2)).toBe(expected)
  })
  it.each([
    { case: '{ configured: true, running: false, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 } / now', input: { configured: true, running: false, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 }, argument2: now, expected: true },
    { case: '{ configured: true, running: false, lastCapturedAt: \'2026-09-22T01:00:00Z\', lastAttemptAt: \'2026-09-22T01:00:00Z\', intervalHo', input: { configured: true, running: false, lastCapturedAt: '2026-09-22T01:00:00Z', lastAttemptAt: '2026-09-22T01:00:00Z', intervalHours: 12 }, argument2: now, expected: false },
    { case: '{ configured: true, running: false, lastCapturedAt: \'2026-09-21T23:00:00Z\', lastAttemptAt: \'2026-09-21T23:00:00Z\', intervalHo', input: { configured: true, running: false, lastCapturedAt: '2026-09-21T23:00:00Z', lastAttemptAt: '2026-09-21T23:00:00Z', intervalHours: 12 }, argument2: now, expected: true },
    { case: '{ configured: true, running: false, lastCapturedAt: null, lastAttemptAt: \'2026-09-22T11:59:00Z\', intervalHours: 12 } / now', input: { configured: true, running: false, lastCapturedAt: null, lastAttemptAt: '2026-09-22T11:59:00Z', intervalHours: 12 }, argument2: now, expected: false },
    { case: '{ configured: true, running: true, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 } / now', input: { configured: true, running: true, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 }, argument2: now, expected: false },
  ])('每12小时备份，首次或睡眠错过时补跑，失败重试不形成忙循环 / backupShouldRun：$case', ({ input, argument2, expected }) => {
    expect(backupShouldRun(input, argument2)).toBe(expected)
  })
  it('按上海日/月保留已校验包，始终留下最后一份，不把日份数误当运行次数', () => {
    const packages = [
      { id: 'newest', capturedAt: '2026-09-22T10:00:00Z' },
      { id: 'same-day', capturedAt: '2026-09-22T01:00:00Z' },
      { id: 'previous-day', capturedAt: '2026-09-21T01:00:00Z' },
      { id: 'previous-month', capturedAt: '2026-08-31T01:00:00Z' },
      { id: 'older-month', capturedAt: '2026-07-30T01:00:00Z' },
    ]
    expect([...retainedBackupIds(packages, 2, 2)].sort()).toEqual(['newest', 'previous-day', 'previous-month'])
    expect([...retainedBackupIds(packages, 0, 0)]).toEqual(['newest'])
  })
})
