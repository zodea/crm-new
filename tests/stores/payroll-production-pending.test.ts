// @vitest-environment jsdom
import type { PayrollC1Command, PayrollC1FormRead } from '../../app/lib/payroll/central-c1-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollC1Store } from '../../app/stores/payroll-c1'
import { useProductionAccessStore } from '../../app/stores/production-access'

const read = (): PayrollC1FormRead => ({ context: { workspaceId: 'formal-workspace', actorId: 'formal-owner', origin: 'real', sourceVersion: 'head-and-consumed-basis', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }, statementId: 'formal-c1', draftKey: null, status: 'checked', needsRecheck: false, draft: { projectId: 'formal-project', crewId: 'formal-crew', leaderWorkerId: 'formal-worker', memberWorkerIds: ['formal-worker'], month: '2026-08', note: '' }, options: { projects: [], crews: [], workers: [] }, members: [], facts: [], sources: [], rates: [], lines: [], totals: { grossAmount: { value: 10, knownValue: 10, state: 'known', reasons: [] } }, blockers: [], eligibility: { canSaveDraft: false, canCheck: true, canRelease: true, canOutput: false, reasons: [] } })
const repository = { c1Form: vi.fn(), executeC1: vi.fn(), resolveCommand: vi.fn() }
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  repository.c1Form.mockImplementation(async () => read())
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository, productionAccess: { status: async () => ({ mode: 'production', authenticated: true, purpose: 'verification', ownerId: 'formal-owner' }) } } }))
})
afterEach(() => vi.unstubAllGlobals())

it('正式未知工资仅持久最小原编号，冷页从受控resolve核结果，不持久成员分配或成功回执正文', async () => {
  await useProductionAccessStore().check()
  const store = usePayrollC1Store()
  const form = await store.loadC1Form({ origin: 'real' }, { statementId: 'formal-c1' })
  repository.executeC1.mockRejectedValueOnce(new Error('response-lost-after-commit'))
  await expect(store.releaseC1(form, { actualAmount: 10, allocations: [{ workerId: 'formal-worker', amount: 10 }] })).rejects.toThrow('response-lost')
  const original = repository.executeC1.mock.calls[0]![0] as PayrollC1Command
  const encoded = sessionStorage.getItem('payroll-c1-central-pending-v1')!
  const descriptors = Object.values(JSON.parse(encoded))
  expect(descriptors.map(value => Object.keys(value as object).sort())).toEqual([['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId']])
  expect(encoded).not.toMatch(/actualAmount|allocations|memberWorkerIds|result|sourceVersion/)
  setActivePinia(createPinia())
  await useProductionAccessStore().check()
  const result = { commandId: original.commandId, projectId: original.projectId, statementId: original.statementId, rateRevisionIds: [], sourceVersion: 'saved-source', outcome: 'released', logIds: [] }
  repository.resolveCommand.mockResolvedValue({ outcome: 'applied', command: original, result })
  const restored = usePayrollC1Store()
  await restored.loadC1Form({ origin: 'real' }, { statementId: 'formal-c1' })
  expect(repository.executeC1).toHaveBeenCalledTimes(1)
  expect(repository.resolveCommand).toHaveBeenCalledWith(expect.objectContaining({ commandId: original.commandId, action: 'release-c1', targetId: 'formal-c1' }))
  expect(restored.getC1Pending(form)).toMatchObject({ command: original, state: 'awaiting-read' })
  expect(sessionStorage.getItem('payroll-c1-central-pending-v1')).toBe(encoded)
  const pending = restored.getC1Pending(form)!
  expect(await restored.recoverC1(pending)).toEqual(result)
  expect(repository.executeC1).toHaveBeenCalledTimes(1)
  repository.c1Form.mockImplementation(async () => ({ ...read(), status: 'released' }))
  const refreshed = await restored.loadC1Form({ origin: 'real' }, { statementId: 'formal-c1' })
  expect(() => restored.acknowledgeC1(pending, refreshed)).toThrow('完整读取')
  expect(sessionStorage.getItem('payroll-c1-central-pending-v1')).toBe(encoded)
  expect(restored.getC1Pending({ ...form, context: { ...form.context, actorId: 'other-owner' } })).toBeNull()
})

it('最小原编号的动作或目标不一致时停止恢复并保留原记录，不用伪结果清除保护', async () => {
  await useProductionAccessStore().check()
  const form = read()
  const key = JSON.stringify([form.context.workspaceId, form.context.actorId, form.context.origin, 'C1', form.statementId])
  const descriptor = { workspaceId: form.context.workspaceId, actorId: form.context.actorId, family: 'payroll', commandId: 'formal-original-command', targetId: form.statementId, action: 'release-c1', scopeId: encodeURIComponent(key) }
  const encoded = JSON.stringify({ [key]: descriptor })
  sessionStorage.setItem('payroll-c1-central-pending-v1', encoded)
  repository.resolveCommand.mockResolvedValue({ outcome: 'applied', command: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: 'original', projectId: 'formal-project', statementId: 'wrong-formal-c1', draftKey: null, configScope: null, action: { kind: 'release-c1', release: { actualAmount: 10, allocations: [{ workerId: 'formal-worker', amount: 10 }] } } }, result: {} })
  await expect(usePayrollC1Store().loadC1Form({ origin: 'real' }, { statementId: 'formal-c1' })).rejects.toThrow('目标不匹配')
  expect(sessionStorage.getItem('payroll-c1-central-pending-v1')).toBe(encoded)
  expect(repository.executeC1).not.toHaveBeenCalled()
})

it('只读另一原目标时不借该读恢复、封存或清除现有编号', async () => {
  await useProductionAccessStore().check()
  const form = read()
  const key = JSON.stringify([form.context.workspaceId, form.context.actorId, form.context.origin, 'C1', form.statementId])
  const descriptor = { workspaceId: form.context.workspaceId, actorId: form.context.actorId, family: 'payroll', commandId: 'unread-original-command', targetId: form.statementId, action: 'release-c1', scopeId: encodeURIComponent(key) }
  const encoded = JSON.stringify({ [key]: descriptor })
  sessionStorage.setItem('payroll-c1-central-pending-v1', encoded)
  repository.c1Form.mockImplementation(async () => ({ ...read(), statementId: 'another-c1' }))
  await usePayrollC1Store().loadC1Form({ origin: 'real' }, { statementId: 'another-c1' })
  expect(repository.resolveCommand).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('payroll-c1-central-pending-v1')).toBe(encoded)
})
