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

  it('规范化多工种与活项，并按限定活项判断兼容范围', () => {
    const capability = effectiveMasterDataCapabilities(
      '泥水工',
      ['防水工', '泥水工', '  防水工 '],
      ['墙砖铺贴', '地砖铺贴', '墙砖铺贴'],
    )

    expect(capability).toEqual({
      trades: ['泥水工', '防水工'],
      itemNames: ['墙砖铺贴', '地砖铺贴'],
    })
    expect(capabilityAllowsItem(capability, '泥水工', '墙砖铺贴')).toBe(true)
    expect(capabilityAllowsItem(capability, '泥水工', '水泥砂浆找平')).toBe(false)
    expect(capabilityCoversItems(capability, '泥水工', ['墙砖铺贴', '地砖铺贴'])).toBe(true)
    expect(capabilityCoversItems(capability, '泥水工', ['墙砖铺贴', '水泥砂浆找平'])).toBe(false)
  })

  it('没有限定活项时表示可做能力工种下全部活项', () => {
    const capability = effectiveMasterDataCapabilities('木工', [], [])

    expect(capabilityAllowsItem(capability, '木工', '吊顶封板')).toBe(true)
    expect(capabilityCoversItems(capability, '木工', ['吊顶封板', '木地板安装'])).toBe(true)
  })
})
