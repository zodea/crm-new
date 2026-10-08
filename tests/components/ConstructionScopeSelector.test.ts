import type { ConstructionScopeRead, ConstructionScopeResult } from '../../app/lib/construction-scope/contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ConstructionScopeSelector from '../../app/components/contract/ConstructionScopeSelector.vue'
import { commandRecoveryKey } from '../../app/lib/forms/command-recovery'

vi.mock('../../app/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: vi.fn(async () => true) }) }))
const source = { domain: 'original-expense' as const, id: 'original-expense-line' }
const read: ConstructionScopeRead = { workspaceId: 'scope-workspace', actorId: 'scope-owner', dataOrigin: 'real', source, sourceName: '实际检测费用', parentId: 'original-expense-head', projectId: 'scope-project', sourceBasis: 'a'.repeat(64), eligible: true, reason: null, relation: null, candidateState: 'readable', candidates: [{ id: 'main-a', name: '原施工甲', no: 'A', projectId: 'scope-project', basis: 'b'.repeat(64) }, { id: 'main-b', name: '原施工乙', no: 'B', projectId: 'scope-project', basis: 'c'.repeat(64) }], capabilities: ['construction-scope:read', 'construction-scope:write'] }
const Lookup = defineComponent({ props: ['modelValue', 'fetch', 'disabledReason'], emits: ['update:modelValue'], template: '<select :disabled="Boolean(disabledReason)" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">请选择</option><option value="main-a">原施工甲</option><option value="main-b">原施工乙</option></select>' })
const mountSelector = (repository: { read: ReturnType<typeof vi.fn>, execute: ReturnType<typeof vi.fn>, resolve: ReturnType<typeof vi.fn> }) => mount(ConstructionScopeSelector, { props: { source, repository }, global: { plugins: [createPinia()], stubs: { LookupSelect: Lookup } } })
const key = commandRecoveryKey({ ...read, family: 'construction-scope', targetId: `${source.domain}:${source.id}` })
function receipt(commandId: string): ConstructionScopeResult {
  return { commandId, relation: { id: 'cscope-immutable', domain: source.domain, sourceId: source.id, projectId: 'scope-project', mainId: 'main-b', version: '1', sourceBasis: read.sourceBasis!, mainBasis: 'c'.repeat(64), updatedAt: '2026-10-07T00:00:00.000Z', deletedAt: null } }
}
beforeEach(() => sessionStorage.clear())

it('草稿已有真实Main仍显示只读合同名及编号，无新候选不提升资格；撤权保原ID不泄名称', async () => {
  const relation = receipt('original-draft-source-command').relation
  const draft: ConstructionScopeRead = { ...read, capabilities: [...read.capabilities, 'construction-contract:read'], eligible: false, candidateState: 'unavailable', candidates: [], relation, existingMain: { entity: 'contract', state: 'resolved', id: relation.mainId!, label: '既有原施工合同', no: 'ORIGINAL-MAIN-B' } }
  const repository = { read: vi.fn().mockResolvedValue(draft), execute: vi.fn(), resolve: vi.fn() }
  const wrapper = mountSelector(repository)
  await flushPromises()
  expect(wrapper.get('[aria-label="已有施工主合同关联"]').text()).toContain('既有原施工合同 · ORIGINAL-MAIN-B')
  expect(wrapper.get('select').attributes('disabled')).toBeDefined()
  expect(repository.execute).not.toHaveBeenCalled()
  repository.read.mockResolvedValue({ ...draft, capabilities: read.capabilities, candidateState: 'forbidden', existingMain: { entity: 'contract', state: 'forbidden', id: null, label: null, reason: 'permission-denied' } })
  await wrapper.findAll('button').find(button => button.text() === '重新读取')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="已有施工主合同关联"]').text()).toContain(`无权读取合同资料 · 原编号 ${relation.mainId}`)
  expect(wrapper.text()).not.toContain('既有原施工合同')
  expect(wrapper.text()).not.toContain('ORIGINAL-MAIN-B')
  expect(repository.execute).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('已知保存回执后读取失败保原编号，重试只读取同目标，不重放execute/resolve也不丢晚输入', async () => {
  let saved: ConstructionScopeResult | null = null
  const repository = { read: vi.fn().mockResolvedValueOnce(read).mockRejectedValueOnce(new Error('保存后读失败')).mockImplementation(async () => ({ ...read, relation: saved!.relation })), execute: vi.fn(async (command) => {
    saved = receipt(command.commandId)
    return saved
  }), resolve: vi.fn() }
  const wrapper = mountSelector(repository)
  await flushPromises()
  await wrapper.get('select').setValue('main-b')
  await wrapper.findAll('button').find(button => button.text() === '保存关联')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('保存后读失败')
  expect(repository.execute).toHaveBeenCalledOnce()
  const marker = JSON.parse(sessionStorage.getItem(key)!)
  expect(Object.keys(marker).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
  expect(marker).toMatchObject({ targetId: `${source.domain}:${source.id}`, scopeId: 'original-expense-head' })
  expect(JSON.stringify(marker)).not.toContain('amount')
  await wrapper.findAll('button').find(button => button.text() === '核对原编号')!.trigger('click')
  await flushPromises()
  expect(repository.execute).toHaveBeenCalledOnce()
  expect(repository.resolve).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(wrapper.emitted('saved')?.[0]).toEqual([saved])
  wrapper.unmount()
})

it('未知响应刷新只resolve原行/head编号，回执后独立读取才能解除marker', async () => {
  let saved: ConstructionScopeResult | null = null
  const repository = { read: vi.fn(async () => ({ ...read, relation: saved?.relation ?? null })), execute: vi.fn(async (command) => {
    saved = receipt(command.commandId)
    throw new Error('response lost')
  }), resolve: vi.fn(async () => ({ outcome: 'applied', result: saved })) }
  const first = mountSelector(repository)
  await flushPromises()
  await first.get('select').setValue('main-b')
  await first.findAll('button').find(button => button.text() === '保存关联')!.trigger('click')
  await flushPromises()
  const marker = JSON.parse(sessionStorage.getItem(key)!)
  first.unmount()
  const second = mountSelector(repository)
  await flushPromises()
  expect(sessionStorage.getItem(key)).not.toBeNull()
  await second.findAll('button').find(button => button.text() === '核对原编号')!.trigger('click')
  await flushPromises()
  expect(repository.resolve).toHaveBeenCalledWith(marker)
  expect(repository.execute).toHaveBeenCalledOnce()
  expect(repository.read).toHaveBeenCalledTimes(3)
  expect(sessionStorage.getItem(key)).toBeNull()
  second.unmount()
})
