import type { PayrollHollowCommand, PayrollHollowConfigRead } from '~/lib/payroll/central-hollow-deduction-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollHollowConfigSection from '~/components/payroll/PayrollHollowConfigSection.vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const config = { scope: { formatFamily: 'A' as const, projectId: 'project', crewId: null, leaderWorkerId: 'worker', book: { bookPurpose: 'ordinary' as const, managementBookId: null } }, month: '2026-09' }
const context = { workspaceId: 'workspace', actorId: 'actor', origin: 'real' as const, sourceVersion: 'v1', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }
const execute = vi.fn()
const confirm = vi.fn()
const success = vi.fn()
let read: PayrollHollowConfigRead
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  confirm.mockResolvedValue(true)
  read = { context: structuredClone(context), query: structuredClone(config), policies: [{ itemId: 'wall', itemName: '墙砖', enabled: false, unitAmount: 30, source: 'default', revisionId: null, sourceVersion: 'v1' }], revisions: [], eligibility: { canSave: true, reasons: [] }, reasons: [] }
  execute.mockImplementation(async (command: PayrollHollowCommand) => {
    if (command.action.kind !== 'save-hollow-policies')
      throw new Error('不是配置命令')
    const policy = command.action.policies[0]!
    read.revisions = [{ id: 'revision', policyId: 'policy', itemId: policy.itemId, enabled: policy.enabled, unitAmount: policy.unitAmount, effectiveMonth: policy.effectiveMonth, scope: config.scope, previousRevisionId: policy.baseRevisionId, commandId: command.commandId, createdBy: 'actor', createdAt: '2026-09-15T00:00:00Z' }]
    read.policies[0] = { ...read.policies[0]!, enabled: policy.enabled, unitAmount: policy.unitAmount, revisionId: 'revision', source: 'configured', sourceVersion: 'v2' }
    read.context.sourceVersion = 'v2'
    return { commandId: command.commandId, projectId: 'project', statementId: null, startId: null, policyRevisionIds: ['revision'], sourceVersion: 'v2', outcome: 'saved', logIds: ['log'] }
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: { hollowConfig: async () => structuredClone(read), executeHollow: execute }, projectCommands: { context: async () => structuredClone(read.context) } } }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
const page = () => mount(PayrollHollowConfigSection, { props: { config, origin: 'real' }, attachTo: document.body })
const button = (wrapper: ReturnType<typeof page>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!

it('原默认30不伪空，明确零未知提交冷恢复保原键与开关并聚焦核对面板', async () => {
  let wrapper = page()
  await flushPromises()
  expect((wrapper.get('input[aria-label="空鼓单处金额"]').element as HTMLInputElement).value).toBe('30')
  await wrapper.get('input[aria-label="空鼓单处金额"]').setValue('0')
  execute.mockRejectedValueOnce(new Error('配置回复丢失'))
  await button(wrapper, '保存空鼓分项配置').trigger('click')
  await flushPromises()
  const original = structuredClone(execute.mock.calls[0]![0])
  expect(original.action.policies).toEqual([expect.objectContaining({ enabled: false, unitAmount: 0 })])
  expect(document.activeElement?.getAttribute('aria-label')).toBe('工资提交核对')
  expect(await (wrapper.vm as unknown as { mayLeave: () => Promise<boolean> }).mayLeave()).toBe(false)
  wrapper.unmount()
  setActivePinia(createPinia())
  wrapper = page()
  await flushPromises()
  expect((wrapper.get('input[aria-label="空鼓单处金额"]').element as HTMLInputElement).value).toBe('0')
  expect(wrapper.get('select').attributes('disabled')).toBeDefined()
  await button(wrapper, '核对原提交').trigger('click')
  await flushPromises()
  expect(execute.mock.calls[1]![0]).toEqual(original)
  expect(success).toHaveBeenCalledWith('空鼓分项配置已保存并核对。')
  expect(wrapper.find('[aria-label="工资提交核对"]').exists()).toBe(false)
  wrapper.unmount()
})

it('未保存空单价和开关在连续两次冷返回都保留，须明确采用当前修订', async () => {
  let wrapper = page()
  await flushPromises()
  await wrapper.get('select').setValue('true')
  await wrapper.get('input[aria-label="空鼓单处金额"]').setValue('')
  wrapper.unmount()
  for (let index = 0; index < 2; index++) {
    setActivePinia(createPinia())
    wrapper = page()
    await flushPromises()
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('true')
    expect((wrapper.get('input[aria-label="空鼓单处金额"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('本次单处金额未填写，不会按零或默认 30 元计算。')
    expect(button(wrapper, '保存空鼓分项配置').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  }
  expect(execute).not.toHaveBeenCalled()
})
