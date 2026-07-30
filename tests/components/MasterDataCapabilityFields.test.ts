import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MasterDataCapabilityFields from '~/components/master-data/MasterDataCapabilityFields.vue'

describe('master data capability fields', () => {
  it('主工种固定保留，并可添加或移除兼任工种与活项', async () => {
    const { emitted } = render(MasterDataCapabilityFields, {
      props: {
        primaryTrade: '泥水工',
        trades: [],
        items: [],
      },
    })

    expect(screen.getByText('泥水工')).not.toBeNull()
    expect(screen.getByText('主工种')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '移除工种能力泥水工' })).toBeNull()

    await fireEvent.update(screen.getByLabelText('兼任工种'), '防水工')
    await fireEvent.click(screen.getByRole('button', { name: '添加工种' }))
    expect(emitted()['update:trades']?.at(-1)).toEqual([['防水工']])

    await fireEvent.update(screen.getByLabelText('限定可做活项（可选）'), '墙砖铺贴，地砖铺贴')
    await fireEvent.click(screen.getByRole('button', { name: '添加活项' }))
    expect(emitted()['update:items']?.at(-1)).toEqual([['墙砖铺贴', '地砖铺贴']])
  })
})
