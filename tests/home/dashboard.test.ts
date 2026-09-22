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
})
