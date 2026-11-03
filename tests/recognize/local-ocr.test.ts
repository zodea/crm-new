import { expect, it, vi } from 'vitest'
import { localOcrOptions } from '~/lib/recognize/local-ocr'

it('使用同源模型与单线程离线运行文件，拒绝其他地址和写请求', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic'))
  const options = localOcrOptions('https://192.168.1.20:3443', '/crm/', fetcher)
  expect(options).toMatchObject({
    textDetectionModelName: 'PP-OCRv6_small_det',
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textDetectionModelAsset: { url: 'https://192.168.1.20:3443/crm/local-ocr/models/PP-OCRv6_small_det_onnx_infer.tar' },
    textRecognitionModelAsset: { url: 'https://192.168.1.20:3443/crm/local-ocr/models/PP-OCRv6_small_rec_onnx_infer.tar' },
    ortOptions: { backend: 'wasm', numThreads: 1, wasmPaths: 'https://192.168.1.20:3443/crm/local-ocr/runtime/' },
  })
  await options.fetch!(options.textDetectionModelAsset!.url)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledWith(options.textDetectionModelAsset!.url, { credentials: 'same-origin', redirect: 'error' })
  expect(() => options.fetch!('https://example.com/model.tar')).toThrow('拒绝非本机模型请求')
  expect(() => options.fetch!(options.textDetectionModelAsset!.url, { method: 'POST' })).toThrow('拒绝非本机模型请求')
  expect(() => localOcrOptions('https://192.168.1.20:3443', 'https://example.com/')).toThrow('不属于当前站点')
  expect(() => localOcrOptions('https://192.168.1.20:3443', '/crm')).toThrow('基础路径无效')
  expect(() => localOcrOptions('https://192.168.1.20:3443', '/crm/?other=1')).toThrow('基础路径无效')
})
