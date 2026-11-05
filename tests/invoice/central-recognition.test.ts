import { expect, it, vi } from 'vitest'
import { invoiceCandidateForCommand } from '~/lib/invoice/central-recognition'
import { recognizeInvoiceLocally } from '~/lib/invoice/recognize'

it('中央识别命令保留票面内容，不携带本次识别的定位和源帧', async () => {
  const readDocument = vi.fn().mockResolvedValue({ pages: ['发票号码：87654321'], unrecognizedPageIndexes: [], geometryPages: [{ pageIndex: 0, width: 300, height: 200, source: 'image', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }] })
  const candidate = await recognizeInvoiceLocally({ file: new File(['image'], 'synthetic.png'), basePath: '/' }, { readDocument })
  expect(candidate.fieldRegions?.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: expect.closeTo(1 / 30), y: 0.05, width: expect.closeTo(190 / 300), height: expect.closeTo(0.1) } })
  expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width: 300, height: 200, source: 'image' }])
  const command = invoiceCandidateForCommand(candidate)
  expect(command).toMatchObject({ fields: { invoiceNumber: '87654321' }, source: 'local', textPages: ['发票号码：87654321'], unrecognizedPageIndexes: [] })
  expect(command).not.toHaveProperty('fieldRegions')
  expect(command).not.toHaveProperty('regionFrames')
})
