import { describe, expect, it, vi } from 'vitest'
import {
  resolveHomeProjectSwitch,
  summarizeHomeScheduleCoverage,
} from '~/lib/home/dashboard'

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

  it('项目加载成功才确认切换，失败回到原项目', async () => {
    const loaded = { id: 'project-new' }
    const loadSuccess = vi.fn(async () => loaded)
    await expect(resolveHomeProjectSwitch({
      requestedId: 'project-new',
      confirmedId: 'project-old',
      load: loadSuccess,
    })).resolves.toEqual({
      ok: true,
      selectedId: 'project-new',
      value: loaded,
    })

    const failure = new Error('database unavailable')
    const loadFailure = vi.fn(async () => {
      throw failure
    })
    await expect(resolveHomeProjectSwitch({
      requestedId: 'project-new',
      confirmedId: 'project-old',
      load: loadFailure,
    })).resolves.toEqual({
      ok: false,
      selectedId: 'project-old',
      failedId: 'project-new',
      error: failure,
    })
  })
})
