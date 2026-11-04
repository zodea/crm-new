import { describe, expect, it } from 'vitest'
import { summarizeHomeScheduleCoverage } from '~/lib/home/dashboard'

describe('首页驾驶舱状态规则', () => {
  it('只把真实缺失事实标为 partial-data，不用 0 冒充完整数据', () => {
    const coverage = summarizeHomeScheduleCoverage({
      groups: [
        { tasks: [] },
        {
          tasks: [
            { hasQty: true, applicableUnits: 0 },
            { hasQty: true, applicableUnits: 4 },
            { hasQty: false, applicableUnits: null },
          ],
        },
      ],
    })

    expect(coverage).toEqual({
      isPartial: true,
      title: '部分排程数据尚未就绪',
      description: '1 个楼栋分组尚未配置工序；1 道工程量联动工序尚无适用户完成事实。已显示可用进度，缺失部分不按 0 推断。',
    })
  })

  it('所有分组和工程量来源完整时不显示 partial-data', () => {
    expect(summarizeHomeScheduleCoverage({
      groups: [{
        tasks: [
          { hasQty: true, applicableUnits: 4 },
          { hasQty: false, applicableUnits: null },
        ],
      }],
    })).toEqual({
      isPartial: false,
      title: '',
      description: '',
    })
  })

  it.each([
    {
      case: '只有空分组时只提示缺工序',
      groups: [{ tasks: [] }, { tasks: [] }],
      expected: {
        isPartial: true,
        title: '部分排程数据尚未就绪',
        description: '2 个楼栋分组尚未配置工序。已显示可用进度，缺失部分不按 0 推断。',
      },
    },
    {
      case: '工程量联动工序来源为空时只提示缺完成事实',
      groups: [{ tasks: [{ hasQty: true, applicableUnits: null }] }],
      expected: {
        isPartial: true,
        title: '部分排程数据尚未就绪',
        description: '1 道工程量联动工序尚无适用户完成事实。已显示可用进度，缺失部分不按 0 推断。',
      },
    },
    {
      case: '联动工序有一个适用户，不联动工序没有适用户时仍为完整',
      groups: [{ tasks: [{ hasQty: true, applicableUnits: 1 }, { hasQty: false, applicableUnits: 0 }, { hasQty: false, applicableUnits: null }] }],
      expected: { isPartial: false, title: '', description: '' },
    },
    {
      case: '跨分组分别统计多个缺失项，忽略完整和不联动工序',
      groups: [
        { tasks: [] },
        { tasks: [{ hasQty: true, applicableUnits: 0 }, { hasQty: true, applicableUnits: 1 }] },
        { tasks: [{ hasQty: true, applicableUnits: null }, { hasQty: false, applicableUnits: null }] },
        { tasks: [] },
      ],
      expected: {
        isPartial: true,
        title: '部分排程数据尚未就绪',
        description: '2 个楼栋分组尚未配置工序；2 道工程量联动工序尚无适用户完成事实。已显示可用进度，缺失部分不按 0 推断。',
      },
    },
  ])('$case', ({ groups, expected }) => {
    expect(summarizeHomeScheduleCoverage({ groups })).toEqual(expected)
  })
})
