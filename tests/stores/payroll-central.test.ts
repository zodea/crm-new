import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAttendanceStore } from '~/stores/attendance'
import { usePayrollStore } from '~/stores/payroll'
import { usePayrollStatementDetailStore } from '~/stores/payroll-statement-detail'
import { useSignedDayworkStore } from '~/stores/signed-daywork'

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), sources: vi.fn(), getDb: vi.fn(), transaction: vi.fn(), includeDemo: false }))
vi.mock('~/lib/db/connection', () => ({ getDb: mocks.getDb, withTransaction: mocks.transaction }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: mocks.includeDemo }) }))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.includeDemo = false
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: { list: mocks.list, detail: mocks.detail, sources: mocks.sources } } }))
})
afterEach(() => vi.unstubAllGlobals())
it('正式读取四入口只经 Repository，任一失败都不回退本地库', async () => {
  mocks.list.mockRejectedValue(new Error('中央暂不可用'))
  await expect(usePayrollStore().loadRead({ origin: 'real' })).rejects.toThrow('中央暂不可用')
  mocks.detail.mockResolvedValue({ statement: { id: 'same-id' } })
  await expect(usePayrollStatementDetailStore().loadRead({ origin: 'real', projectId: 'p' }, 'same-id')).resolves.toEqual({ statement: { id: 'same-id' } })
  mocks.sources.mockResolvedValue({ projectId: 'p', attendance: [], daywork: [] })
  await useAttendanceStore().loadRead({ origin: 'real', projectId: 'p' })
  await useSignedDayworkStore().loadRead({ origin: 'real', projectId: 'p' })
  expect(mocks.getDb).not.toHaveBeenCalled()
  expect(mocks.sources).toHaveBeenCalledTimes(2)
})
it('未授权 demo 不读库，调用者不能以 includeDemo 参数覆盖当前可见性', async () => {
  await expect(usePayrollStore().loadRead({ origin: 'demo', includeDemo: true })).rejects.toThrow('不能回退')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.getDb).not.toHaveBeenCalled()
  mocks.includeDemo = true
  mocks.list.mockRejectedValue(new Error('演示无权'))
  await expect(usePayrollStore().loadRead({ origin: 'demo' })).rejects.toThrow('演示无权')
  expect(mocks.getDb).not.toHaveBeenCalled()
})
