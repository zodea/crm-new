import { expect, it, vi } from 'vitest'
import { PaddleOcrCloudClient } from '../../server/utils/paddleocr-cloud'

it.each(['submit', 'poll', 'result'] as const)('%s 响应头已返回但正文卡住时仍须超时中止', async (blocked) => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  let signal: AbortSignal | undefined
  const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    const phase = init?.method === 'POST' ? 'submit' : url.includes('/jobs/') ? 'poll' : 'result'
    if (phase === blocked) {
      signal = init?.signal ?? undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
          signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
        },
      })
      return new Response(body, { status: 200 })
    }
    return phase === 'submit'
      ? response({ code: 0, data: { jobId: 'synthetic-job' } })
      : response({ code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://result.example/synthetic.jsonl' } } })
  })
  const client = new PaddleOcrCloudClient({ accessToken: 'synthetic-token', requestTimeoutMs: 25, fetch: fetchMock, sleep: async () => {} })
  const result = client.recognize({ fileName: '合成.png', contentType: 'image/png', data: new Uint8Array([1]) }).catch(error => error)
  try {
    await vi.waitFor(() => expect(signal).toBeDefined(), { timeout: 500, interval: 5 })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(signal!.aborted).toBe(true)
    expect(await result).toMatchObject({ code: 'request-timeout', retryable: true })
  }
  finally {
    if (signal && !signal.aborted)
      stream?.error(new DOMException('test cleanup', 'AbortError'))
    await result
  }
})
