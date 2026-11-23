import { describe, expect, it } from 'vitest'
import { boundedInvoiceXlsx } from '../../server/utils/production-invoice-workbook-limits'
import { crc32, descriptorFixture, storedOutputEntries } from '../helpers/invoice-workbook-descriptor-fixture'

describe('中央服务端 ZIP data descriptor', () => {
  it.each(['unsigned', 'signed', 'unsigned-signature-crc', 'signed-signature-crc'] as const)('接受合法 %s descriptor 并保留实际内容', async (mode) => {
    const fixture = descriptorFixture(mode)
    const original = Uint8Array.from(fixture.archive)
    if (mode === 'unsigned-signature-crc' || mode === 'signed-signature-crc')
      expect(crc32(fixture.content)).toBe(0x08074B50)
    const output = await boundedInvoiceXlsx(fixture.archive)
    expect(storedOutputEntries(output)).toEqual([
      { name: 'first.txt', content: [...fixture.content] },
      { name: 'second.txt', content: [122] },
    ])
    expect(fixture.archive).toEqual(original)
  })

  it.each(['wrong-crc', 'wrong-compressed', 'wrong-expanded', 'missing', 'truncated', 'overlap', 'nonzero-local', 'wide-without-zip64'] as const)(
    '拒绝无法证明的 %s descriptor',
    async (mode) => {
      const fixture = descriptorFixture(mode)
      const original = Uint8Array.from(fixture.archive)
      await expect(boundedInvoiceXlsx(fixture.archive)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      expect(fixture.archive).toEqual(original)
    },
  )

  it.each(['zip64-marked', 'zip64-extra'] as const)('带 ZIP64 标记 %s 的短条目须明确拒绝，不能按普通 32 位解释', async (mode) => {
    await expect(boundedInvoiceXlsx(descriptorFixture(mode).archive)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('ZIP64') } })
  })
})
