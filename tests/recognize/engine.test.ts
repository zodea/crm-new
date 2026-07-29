import { describe, expect, it, vi } from 'vitest'
import {
  OcrRecognitionError,
  recognizeDocument,
} from '~/lib/recognize/engine'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const OCR_RESULT = {
  engine: 'paddleocr-official-api',
  model: 'PaddleOCR-VL-1.6',
  jobId: 'job_client_1',
  pages: [{
    pageIndex: 0,
    markdown: '# 电子发票',
    prunedResult: { parsing_res_list: [] },
    layoutRegions: [],
  }],
  markdownPages: ['# 电子发票'],
  dataInfo: { numPages: 1 },
}

describe('recognizeDocument', () => {
  it('把实际文件作为 multipart 上传到同源 OCR 代理并归一化结果', async () => {
    const progress: number[] = []
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(OCR_RESULT))
    const file = new File([new Uint8Array([1, 2, 3, 4])], '电子发票.png', { type: 'image/png' })

    const result = await recognizeDocument(file, {
      fetch: fetchMock,
      onProgress: value => progress.push(value),
      runtimeOptions: {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useLayoutDetection: true,
        useChartRecognition: true,
        useSealRecognition: false,
        useOcrForImageBlock: true,
        formatBlockContent: false,
        requestTimeoutMs: 90_000,
        pollTimeoutMs: 480_000,
      },
    })

    expect(result).toEqual(OCR_RESULT)
    expect(progress).toEqual([5, 100])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/ocr/recognize')
    expect(init?.method).toBe('POST')
    const uploaded = (init?.body as FormData).get('file') as File
    expect(uploaded).toBe(file)
    expect(uploaded.name).toBe('电子发票.png')
    expect(uploaded.size).toBe(4)
    expect(JSON.parse(String((init?.body as FormData).get('options')))).toEqual({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useLayoutDetection: true,
      useChartRecognition: true,
      useSealRecognition: false,
      useOcrForImageBlock: true,
      formatBlockContent: false,
      requestTimeoutMs: 90_000,
      pollTimeoutMs: 480_000,
    })
    expect((init?.body as FormData).get('useDocOrientationClassify')).toBeNull()
  })

  it('保留服务端稳定错误码、可重试标记和用户可读信息', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      statusCode: 503,
      statusMessage: 'PaddleOCR recognition failed',
      data: {
        code: 'service-unavailable',
        message: 'PaddleOCR 服务暂时不可用，请稍后重试',
        retryable: true,
      },
    }, 503))

    const error = await recognizeDocument(new File(['x'], '送货单.pdf'), {
      fetch: fetchMock,
    }).catch(reason => reason) as OcrRecognitionError

    expect(error).toBeInstanceOf(OcrRecognitionError)
    expect(error).toMatchObject({
      code: 'service-unavailable',
      retryable: true,
      statusCode: 503,
      message: 'PaddleOCR 服务暂时不可用，请稍后重试',
    })
  })

  it('网络中断与畸形成功响应不会伪装成识别成功', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(recognizeDocument(new File(['x'], 'a.jpg'), {
      fetch: networkFetch,
    })).rejects.toMatchObject({ code: 'network', retryable: true })

    const malformedFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ ok: true }))
    await expect(recognizeDocument(new File(['x'], 'b.jpg'), {
      fetch: malformedFetch,
    })).rejects.toMatchObject({ code: 'invalid-response', retryable: false })
  })
})
