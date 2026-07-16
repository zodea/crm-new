import type { PaddleOcrCloudError } from '../../server/utils/paddleocr-cloud'
import { describe, expect, it, vi } from 'vitest'
import {
  PADDLE_OCR_DEFAULT_BASE_URL,
  PADDLE_OCR_MODEL,
  PaddleOcrCloudClient,
} from '../../server/utils/paddleocr-cloud'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('paddleOcrCloudClient', () => {
  it('按官方 3.7 协议提交 PaddleOCR-VL-1.6，轮询并归一化 JSONL 页面', async () => {
    const progress: number[] = []
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { jobId: 'job_108' } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          state: 'running',
          extractProgress: { totalPages: 2, extractedPages: 1 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          state: 'done',
          resultUrl: { jsonUrl: 'https://result.example/job_108.jsonl' },
        },
      }))
      .mockResolvedValueOnce(new Response([
        JSON.stringify({
          result: {
            dataInfo: { numPages: 2 },
            layoutParsingResults: [{
              markdown: { text: '# 第 1 页', images: {} },
              prunedResult: { parsing_res_list: [{ block_label: 'text' }] },
              inputImage: 'https://result.example/page-1.png',
            }],
          },
        }),
        JSON.stringify({
          result: {
            layoutParsingResults: [{
              markdown: { text: '|材料|数量|\n|---|---|\n|水泥|10|', images: {} },
              prunedResult: { parsing_res_list: [{ block_label: 'table' }] },
            }],
          },
        }),
      ].join('\n')))

    const client = new PaddleOcrCloudClient({
      accessToken: 'local-test-token',
      fetch: fetchMock,
      sleep: async () => {},
    })
    const result = await client.recognize({
      fileName: '送货单.pdf',
      contentType: 'application/pdf',
      data: new Uint8Array([1, 2, 3]),
      onProgress: value => progress.push(value),
    })

    expect(result).toMatchObject({
      engine: 'paddleocr-official-api',
      model: PADDLE_OCR_MODEL,
      jobId: 'job_108',
      markdownPages: ['# 第 1 页', '|材料|数量|\n|---|---|\n|水泥|10|'],
      dataInfo: { numPages: 2 },
    })
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]?.inputImageUrl).toBe('https://result.example/page-1.png')
    expect(progress).toEqual([0, 50, 100])

    const submitCall = fetchMock.mock.calls[0]
    expect(submitCall?.[0]).toBe(`${PADDLE_OCR_DEFAULT_BASE_URL}/api/v2/ocr/jobs`)
    expect(submitCall?.[1]?.method).toBe('POST')
    expect(new Headers(submitCall?.[1]?.headers).get('authorization')).toBe('Bearer local-test-token')
    const form = submitCall?.[1]?.body as FormData
    expect(form.get('model')).toBe('PaddleOCR-VL-1.6')
    expect(JSON.parse(String(form.get('optionalPayload')))).toEqual({
      useDocOrientationClassify: true,
      useDocUnwarping: true,
      useLayoutDetection: true,
      useChartRecognition: false,
      useSealRecognition: true,
      useOcrForImageBlock: true,
      formatBlockContent: true,
      restructurePages: false,
      returnMarkdownImages: false,
      visualize: false,
    })
    expect((form.get('file') as File).name).toBe('送货单.pdf')

    const resultCall = fetchMock.mock.calls[3]
    expect(resultCall?.[0]).toBe('https://result.example/job_108.jsonl')
    expect(new Headers(resultCall?.[1]?.headers).has('authorization')).toBe(false)
  })

  it('token 缺失时在发出网络请求前失败', async () => {
    expect(() => new PaddleOcrCloudClient({ accessToken: '' })).toThrowError(
      expect.objectContaining({ code: 'missing-token' }),
    )
  })

  it.each([
    [401, 'authentication', false],
    [403, 'authentication', false],
    [429, 'rate-limit', true],
    [503, 'service-unavailable', true],
  ] as const)('http %i 映射为稳定错误 %s', async (status, code, retryable) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ code: status, msg: 'upstream detail' }, status),
    )
    const client = new PaddleOcrCloudClient({ accessToken: 'test', fetch: fetchMock })

    await expect(client.recognize({
      fileName: 'invoice.png',
      contentType: 'image/png',
      data: new Uint8Array([1]),
    })).rejects.toMatchObject({ code, retryable })
  })

  it('任务失败时保留可操作错误但不泄露 Token', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { jobId: 'failed_job' } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { state: 'failed', errorMsg: '图片无法解析' },
      }))
    const client = new PaddleOcrCloudClient({
      accessToken: 'secret-must-not-leak',
      fetch: fetchMock,
      sleep: async () => {},
    })

    const error = await client.recognize({
      fileName: 'broken.jpg',
      contentType: 'image/jpeg',
      data: new Uint8Array([1]),
    }).catch(reason => reason) as PaddleOcrCloudError

    expect(error).toMatchObject({ code: 'job-failed', retryable: false })
    expect(error.message).toContain('图片无法解析')
    expect(error.message).not.toContain('secret-must-not-leak')
  })

  it('轮询超过总时限后停止', async () => {
    let now = 0
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { jobId: 'slow_job' } }))
      .mockImplementation(async () => jsonResponse({ code: 0, data: { state: 'running' } }))
    const client = new PaddleOcrCloudClient({
      accessToken: 'test',
      fetch: fetchMock,
      pollTimeoutMs: 5_000,
      now: () => now,
      sleep: async (ms) => { now += ms },
    })

    await expect(client.recognize({
      fileName: 'slow.pdf',
      contentType: 'application/pdf',
      data: new Uint8Array([1]),
    })).rejects.toMatchObject({ code: 'poll-timeout', retryable: true })
  })

  it('结果不是合法 JSONL/版面结果时明确失败', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { jobId: 'bad_result' } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { state: 'done', resultUrl: { jsonUrl: 'https://result.example/bad.jsonl' } },
      }))
      .mockResolvedValueOnce(new Response('{not-json}\n'))
    const client = new PaddleOcrCloudClient({
      accessToken: 'test',
      fetch: fetchMock,
      sleep: async () => {},
    })

    await expect(client.recognize({
      fileName: 'bad.pdf',
      contentType: 'application/pdf',
      data: new Uint8Array([1]),
    })).rejects.toMatchObject({ code: 'invalid-result', retryable: false })
  })
})
