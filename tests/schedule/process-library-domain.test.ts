import { describe, expect, it } from 'vitest'
import { normalizeProcessLibraryDraft } from '~/lib/schedule/process-library-domain'

describe('标准工序库前置关系校验', () => {
  it('拒绝不存在、同位或晚于当前工序的前置关系', () => {
    expect(() => normalizeProcessLibraryDraft({
      sourceLibraryId: null,
      code: 'invalid-order',
      name: '错误顺序',
      description: '',
      tasks: [
        {
          key: 'first',
          name: '第一道',
          trade: '泥水工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: 'second',
        },
        {
          key: 'second',
          name: '第二道',
          trade: '木工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: null,
        },
      ],
    })).toThrow('前置工序必须排在当前工序之前')
  })

  it('即使标记置灰也拒绝以自身作为前置工序', () => {
    expect(() => normalizeProcessLibraryDraft({
      sourceLibraryId: null,
      code: 'self-predecessor',
      name: '自依赖反例',
      description: '',
      tasks: [{
        key: 'self',
        name: '自身工序',
        trade: '',
        color: '#64748b',
        durationDays: 2,
        stageCode: '',
        itemCodes: [],
        predecessorKey: 'self',
        predecessorDisabled: true,
      }],
    })).toThrow('不能以前置关系引用自身')
  })
})
