import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuantityStageReporting from '../../app/components/quantity/QuantityStageReporting.vue'

const workspace = {
  projectId: 'p',
  matrixArchivedAt: null,
  stages: [{ id: 'first', code: 'A', name: '第一遍', trade: '油漆工', completionMode: 'unit' as const, sortOrder: 0 }, { id: 'second', code: 'B', name: '第二遍', trade: '油漆工', completionMode: 'unit' as const, sortOrder: 1 }],
  items: [{ id: 'putty', code: 'P', name: '腻子', trade: '油漆工', unit: '㎡' }],
  mappings: [{ id: 'a', stageId: 'first', itemId: 'putty', isReportingStage: true }, { id: 'b', stageId: 'second', itemId: 'putty', isReportingStage: false }],
}

describe('显式报量阶段选择', () => {
  it('选择先保留草稿，保存才提交；未指定保持明确空值，不自动选择排序末项', async () => {
    const wrapper = mount(QuantityStageReporting, { props: { workspace, selections: { putty: 'first' }, readonly: false } })
    await wrapper.get('select[aria-label="腻子的报量阶段"]').setValue('')
    expect(wrapper.emitted('select')!.at(-1)).toEqual(['putty', ''])
    expect(wrapper.emitted('save')).toBeUndefined()
    await wrapper.setProps({ selections: { putty: '' } })
    await wrapper.get('button[aria-label="保存腻子的报量阶段"]').trigger('click')
    expect(wrapper.emitted('save')!.at(-1)).toEqual(['putty', null])
    expect(wrapper.text()).toContain('当前：第一遍')
  })
})
