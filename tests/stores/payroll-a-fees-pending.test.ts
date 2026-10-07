// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollAFeesStore } from '~/stores/payroll-a-fees'
import { feeConfigRead, feeDraft, feeFormRead, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

const repository = { aFeeConfig: vi.fn(), aForm: vi.fn(), executeFees: vi.fn() }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  repository.aFeeConfig.mockImplementation(async () => feeConfigRead('after'))
  repository.aForm.mockImplementation(async () => feeFormRead())
  repository.executeFees.mockImplementation(async command => ({ commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'after', outcome: 'saved', logIds: ['audit'], book: command.book, managementBookId: null, managementRevisionId: null, feeRevisionIds: ['saved-fee'], negativeLineRevisionIds: [], locatedExistingDraft: false }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository } }))
})
afterEach(() => vi.unstubAllGlobals())
it('费用原稿成功后仍等待可信同目标后读，空修订列表不能冒充保存完成', async () => {
  const store = usePayrollAFeesStore()
  const read = feeConfigRead()
  const draft = { ...feeDraft(), name: '明确关闭的补贴' }
  await store.saveFees(read, [draft], [])
  const original = store.getPending(read)!
  expect(original.state).toBe('awaiting-read')
  expect(() => store.acknowledge(original, read)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  const missing = await store.loadConfig({ origin: 'real' }, read.scope)
  expect(() => store.acknowledge(original, missing)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repository.aFeeConfig.mockResolvedValueOnce({ ...feeConfigRead('after'), fees: [{ ...draft, id: 'saved-fee', feeId: 'fee', projectId: 'project', crewId: 'crew', leaderWorkerId: 'worker', revision: 1, removed: false, operatorId: 'actor', createdAt: '2026-09-14' }] })
  const fresh = await store.loadConfig({ origin: 'real' }, read.scope)
  store.acknowledge(original, fresh)
  expect(store.getPending(read)).toBeNull()
})
it('unknown冷恢复使用原费用命令，禁止后来的输入覆盖同目标', async () => {
  let store = usePayrollAFeesStore()
  const read = feeConfigRead()
  repository.executeFees.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.saveFees(read, [feeDraft()], [])).rejects.toThrow('响应丢失')
  const original = store.getPending(read)!
  setActivePinia(createPinia())
  store = usePayrollAFeesStore()
  expect(store.getPending(read)).toEqual(original)
  expect(() => store.saveFees(feeConfigRead('newer'), [], [])).toThrow('请先核对本份费用的原提交结果')
  await store.recover(original)
  expect(repository.executeFees.mock.calls.at(-1)![0]).toEqual(original.command)
})
it('相同负责人另一管理簿的后读不能解除原管理行提交', async () => {
  const store = usePayrollAFeesStore()
  const read = feeFormRead()
  read.book = { bookPurpose: 'management', managementBookId: 'book-first' }
  read.draft.book = read.book
  repository.executeFees.mockImplementation(async command => ({ commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'after', outcome: 'saved', logIds: ['audit'], book: command.book, managementBookId: 'book-first', managementRevisionId: null, feeRevisionIds: [], negativeLineRevisionIds: [], locatedExistingDraft: false }))
  await store.saveNegativeLines(read, [negativeDraft()], [])
  const original = store.getPending(read)!
  repository.aForm.mockResolvedValueOnce({ ...read, book: { bookPurpose: 'management', managementBookId: 'book-second' } })
  const foreign = await store.loadForm({ origin: 'real' }, read.statementId!)
  expect(() => store.acknowledge(original, foreign)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  expect(store.getPending(read)?.state).toBe('awaiting-read')
})
it('移除负价以明确的移除修订后读完成，不要求原行继续存在于核算清单', async () => {
  const store = usePayrollAFeesStore()
  const read = feeFormRead()
  read.book = { bookPurpose: 'management', managementBookId: 'book-first' }
  read.draft.book = read.book
  repository.executeFees.mockImplementation(async command => ({ commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'after', outcome: 'saved', logIds: ['audit'], book: command.book, managementBookId: 'book-first', managementRevisionId: null, feeRevisionIds: [], negativeLineRevisionIds: ['removed-revision'], locatedExistingDraft: false }))
  await store.saveNegativeLines(read, [], [{ lineId: 'negative-line', baseRevisionId: 'negative-revision' }])
  const operation = store.getPending(read)!
  const missing = await store.loadForm({ origin: 'real' }, read.statementId!)
  expect(() => store.acknowledge(operation, missing)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  const { baseRevisionId: _base, ...values } = negativeDraft()
  repository.aForm.mockResolvedValueOnce({ ...read, negativeLineRevisions: [{ ...values, id: 'removed-revision', lineId: 'negative-line', statementId: read.statementId!, projectId: 'project', managementBookId: 'book-first', managementRevisionId: 'management-revision', revision: 2, signedAmountFen: -60000, removed: true, operatorId: 'actor', createdAt: '2026-09-14' }] })
  const fresh = await store.loadForm({ origin: 'real' }, read.statementId!)
  expect(fresh.fees!.negativeLines).toEqual([])
  store.acknowledge(operation, fresh)
  expect(store.getPending(read)).toBeNull()
})
