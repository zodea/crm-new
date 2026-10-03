import { describe, expect, it } from 'vitest'
import {
  capabilityAllowsItem,
  capabilityCoversItems,
  effectiveMasterDataCapabilities,
  parseCapabilityColumn,
} from '~/lib/master-data/capabilities'

describe('班组/工人可承接能力', () => {
  it('存量没有能力列时自动把主工种作为有效能力', () => {
    expect(effectiveMasterDataCapabilities('泥水工', [], [])).toEqual({
      trades: ['泥水工'],
      itemNames: [],
    })
    expect(parseCapabilityColumn('not-json')).toEqual([])
  })

  describe('规范化多工种与活项，并按限定活项判断兼容范围', () => {
    const capability = effectiveMasterDataCapabilities(
      '泥水工',
      ['防水工', '泥水工', '  防水工 '],
      ['墙砖铺贴', '地砖铺贴', '墙砖铺贴'],
    )
    it('关联事实保持原契约', () => {
      expect(capability).toEqual({
        trades: ['泥水工', '防水工'],
        itemNames: ['墙砖铺贴', '地砖铺贴'],
      })
    })

    it.each([
      { case: 'capability / \'泥水工\' / \'墙砖铺贴\'', input: capability, argument2: '泥水工', argument3: '墙砖铺贴', expected: true },
      { case: 'capability / \'泥水工\' / \'水泥砂浆找平\'', input: capability, argument2: '泥水工', argument3: '水泥砂浆找平', expected: false },
    ])('capabilityAllowsItem：$case', ({ input, argument2, argument3, expected }) => {
      expect(capabilityAllowsItem(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })

    it.each([
      { case: 'capability / \'泥水工\' / [\'墙砖铺贴\', \'地砖铺贴\']', input: capability, argument2: '泥水工', argument3: ['墙砖铺贴', '地砖铺贴'], expected: true },
      { case: 'capability / \'泥水工\' / [\'墙砖铺贴\', \'水泥砂浆找平\']', input: capability, argument2: '泥水工', argument3: ['墙砖铺贴', '水泥砂浆找平'], expected: false },
    ])('capabilityCoversItems：$case', ({ input, argument2, argument3, expected }) => {
      expect(capabilityCoversItems(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })
  })

  it('没有限定活项时表示可做能力工种下全部活项', () => {
    const capability = effectiveMasterDataCapabilities('木工', [], [])

    expect(capabilityAllowsItem(capability, '木工', '吊顶封板')).toBe(true)
    expect(capabilityCoversItems(capability, '木工', ['吊顶封板', '木地板安装'])).toBe(true)
  })
})
