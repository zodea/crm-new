import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuantityStageFields from '../../app/components/quantity/QuantityStageFields.vue'

const draft = { id: 'existing', code: 'PUTTY-01', name: '第一遍', trade: '油漆工', completionMode: 'unit' as const, sortOrder: 10, itemIds: ['putty'] }
const items = [{ id: 'putty', code: 'P', name: '腻子', trade: '油漆工', unit: '㎡' }, { id: 'tile', code: 'T', name: '墙砖', trade: '泥水工', unit: '㎡' }]

describe('阶段整页字段', () => {
  it('已有阶段保留稳定编码与口径，只允许显式选择同工种分项，字段变化由事件上交', async () => {
    const wrapper = mount(QuantityStageFields, { props: { draft, items, readonly: false } })
    expect(wrapper.get('input[aria-label="阶段编码"]').attributes()).toHaveProperty('readonly')
    expect(wrapper.get('input[aria-label="阶段工种"]').attributes()).toHaveProperty('readonly')
    expect(wrapper.get('select[aria-label="完成方式"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.find('input[aria-label="关联墙砖"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="阶段名称"]').setValue('首遍腻子')
    expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ name: '首遍腻子' }])
    await wrapper.get('input[aria-label="关联腻子"]').setValue(false)
    expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ itemIds: [] }])
    expect(draft.name).toBe('第一遍')
    expect(draft.itemIds).toEqual(['putty'])
  })
})
