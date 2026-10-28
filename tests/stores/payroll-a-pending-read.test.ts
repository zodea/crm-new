// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollAStore } from '~/stores/payroll-a'
import { payrollUiForm } from '../helpers/payroll-a-ui-fixture'

const repo = { aForm: vi.fn(), aConfig: vi.fn(), aOutput: vi.fn(), execute: vi.fn() }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  repo.aForm.mockImplementation(async () => payrollUiForm('checked'))
  repo.execute.mockImplementation(async command => ({ commandId: command.commandId, statementId: command.statementId, projectId: command.projectId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'after', logIds: ['audit'], outcome: 'checked' }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
})
afterEach(() => vi.unstubAllGlobals())
it('a 成功回执仍保留原键，原键重取同目标纯读后才完成', async () => {
  const store = usePayrollAStore()
  const before = await store.loadAForm({ origin: 'real' }, { statementId: 'wage-a' })
  await store.checkA(before)
  const pending = store.getAPending(before)
  expect(pending?.state).toBe('awaiting-read')
  expect(() => store.acknowledgeA(pending!, before)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  const current = await store.loadAForm({ origin: 'real' }, { statementId: 'wage-a' })
  store.acknowledgeA(pending!, current)
  expect(store.getAPending(before)).toBeNull()
})
it('a 预览与撤权后的读不能解除原回执，冷恢复保原正文', async () => {
  let store = usePayrollAStore()
  const before = payrollUiForm('checked')
  await store.checkA(before)
  const pending = store.getAPending(before)!
  setActivePinia(createPinia())
  store = usePayrollAStore()
  await store.recoverA(store.getAPending(before)!)
  expect(repo.execute.mock.calls.at(-1)![0]).toEqual(pending.command)
  const preview = await store.loadAForm({ origin: 'real' }, { statementId: 'wage-a', draft: before.draft })
  expect(() => store.acknowledgeA(pending, preview)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repo.aForm.mockResolvedValueOnce({ ...before, context: { ...before.context, readonly: true, capabilities: ['payroll:read'] } })
  const forbidden = await store.loadAForm({ origin: 'real' }, { statementId: 'wage-a' })
  expect(() => store.acknowledgeA(pending, forbidden)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  expect(store.getAPending(before)?.state).toBe('awaiting-read')
})
